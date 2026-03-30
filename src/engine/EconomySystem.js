/**
 * EconomySystem - Full tycoon economy with revenue streams, expenses,
 * dynamic pricing, loans, and investment tracking.
 */

// ---------------------------------------------------------------------------
// Base prices (CAD)
// ---------------------------------------------------------------------------

const BASE_PRICES = {
  liftTicketAdult: 89,
  liftTicketChild: 49,
  liftTicketSenior: 69,
  seasonPass: 1_499,
  hotelRoomNight: 280,
  restaurantMeal: 32,
  barDrink: 14,
  shopPurchase: 65,
  rentalPackage: 75,
  condoNight: 450,
  parkingDaily: 25,
  lessonGroup: 120,
  lessonPrivate: 450,
};

// Expense rates (per game-day unless noted)
const BASE_EXPENSES = {
  staffWagesDaily: 85_000,        // ~400 staff across resort
  liftMaintenanceDaily: 12_000,
  snowmakingHourly: 2_500,        // only when active
  groomingNightly: 8_000,
  utilitiesDaily: 6_000,
  marketingDaily: 3_500,
  insuranceDaily: 4_200,
  propertyTaxDaily: 2_800,
};

// Day-of-week pricing multipliers (Mon=1 .. Sun=7)
const DAY_MULTIPLIERS = [1.0, 1.0, 1.0, 1.0, 1.15, 1.35, 1.25]; // index 0=Mon

// Holiday dates get a flat premium
const HOLIDAY_MULTIPLIER = 1.50;
const HOLIDAYS = [
  '12-25', '12-26', '12-31', '01-01', '01-02',  // Christmas / New Year
  '02-17',                                        // Family Day (BC)
  '03-17',                                        // Spring break peak
];

const LOAN_INTEREST_RATE_ANNUAL = 0.065; // 6.5 %
const MAX_LOAN_AMOUNT = 100_000_000;

export class EconomySystem {
  constructor() {
    this._balance = 50_000_000;

    // Accumulated financials for current period
    this._revenue = this._emptyRevenue();
    this._expenses = this._emptyExpenses();

    // Monthly snapshots for reports
    this._monthlyRevenue = this._emptyRevenue();
    this._monthlyExpenses = this._emptyExpenses();

    // Loans
    this._loans = [];           // { principal, remainingBalance, interestRate, monthlyPayment, monthsLeft }

    // Investments
    this._investments = [];     // { name, cost, monthlyReturn, installedDate }

    // Pricing multiplier the player sets (0.5 = half price, 2.0 = double)
    this._playerPriceMultiplier = 1.0;

    // Accumulator to process daily expenses once per game-day
    this._lastExpenseDay = -1;

    // Tracks per-minute fractional accumulation
    this._minuteAccum = 0;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  update(gameState, dt) {
    const date = gameState.date;
    const hour = date.getHours();
    const dayOfYear = this._dayOfYear(date);

    this._minuteAccum += dt;

    // --- Revenue ticks (per-minute granularity) ---
    const guestCount = gameState.guests.current;
    const satisfaction = gameState.guests.satisfaction / 100; // 0-1
    const priceMult = this._getDynamicMultiplier(date);

    // Revenue is modeled per-guest-per-hour, so scale by dt/60
    const hourFraction = dt / 60;

    if (guestCount > 0 && hour >= 8 && hour <= 16) {
      // Lift ticket revenue (amortised across operating hours — 8 hrs)
      const ticketRevPerGuest = BASE_PRICES.liftTicketAdult * priceMult * this._playerPriceMultiplier / 8;
      const ticketRev = ticketRevPerGuest * guestCount * hourFraction;
      this._addRevenue('liftTickets', ticketRev);
    }

    // Restaurants: peak 11-13
    if (guestCount > 0 && hour >= 11 && hour <= 13) {
      const diners = guestCount * 0.35; // 35% eat in a 2-hr window
      const mealRev = diners * BASE_PRICES.restaurantMeal * priceMult * this._playerPriceMultiplier * hourFraction / 2;
      this._addRevenue('restaurants', mealRev);
    }

    // Bar / apres-ski: 15-20
    if (guestCount > 0 && hour >= 15 && hour <= 20) {
      const drinkers = guestCount * 0.25;
      const barRev = drinkers * BASE_PRICES.barDrink * priceMult * this._playerPriceMultiplier * hourFraction / 5;
      this._addRevenue('bars', barRev);
    }

    // Shop purchases spread through the day
    if (guestCount > 0 && hour >= 9 && hour <= 17) {
      const shoppers = guestCount * 0.08;
      const shopRev = shoppers * BASE_PRICES.shopPurchase * priceMult * this._playerPriceMultiplier * hourFraction / 8;
      this._addRevenue('shops', shopRev);
    }

    // Rentals — morning only
    if (guestCount > 0 && hour >= 7 && hour <= 10) {
      const renters = guestCount * 0.20;
      const rentalRev = renters * BASE_PRICES.rentalPackage * priceMult * this._playerPriceMultiplier * hourFraction / 3;
      this._addRevenue('rentals', rentalRev);
    }

    // Lessons — morning and afternoon blocks
    if (guestCount > 0 && (hour === 9 || hour === 13)) {
      const students = guestCount * 0.05;
      const lessonRev = students * BASE_PRICES.lessonGroup * priceMult * this._playerPriceMultiplier * hourFraction;
      this._addRevenue('lessons', lessonRev);
    }

    // Hotel / condo revenue processed once per day at midnight
    if (hour === 0 && this._lastExpenseDay !== dayOfYear) {
      const occupancy = Math.min(1, (gameState.rating / 5) * satisfaction);
      const hotelRooms = 600;   // resort capacity
      const condoUnits = 200;
      this._addRevenue('hotels', hotelRooms * occupancy * BASE_PRICES.hotelRoomNight * priceMult * this._playerPriceMultiplier);
      this._addRevenue('condos', condoUnits * occupancy * 0.7 * BASE_PRICES.condoNight * priceMult * this._playerPriceMultiplier);
      this._addRevenue('parking', guestCount * 0.6 * BASE_PRICES.parkingDaily * priceMult * this._playerPriceMultiplier);
    }

    // --- Expenses (once per game-day) ---
    if (this._lastExpenseDay !== dayOfYear) {
      this._processDailyExpenses(gameState);
      this._processLoanPayments(date);
      this._processInvestmentReturns(date);
      this._lastExpenseDay = dayOfYear;
    }

    // Snowmaking hourly cost
    if (gameState.resort.snowmaking) {
      const snowCost = BASE_EXPENSES.snowmakingHourly * hourFraction;
      this._addExpense('snowmaking', snowCost);
    }

    // Update balance
    this._balance = this._balance
      + this._sumObject(this._revenue) - this._sumObject(this._expenses);
    // Reset accumulators (they represent the delta this tick)
    this._accumulateMonthly();
    this._revenue = this._emptyRevenue();
    this._expenses = this._emptyExpenses();
  }

  getBalance() {
    return Math.round(this._balance * 100) / 100;
  }

  setBalance(amount) {
    this._balance = amount;
  }

  processTransaction(type, amount) {
    if (type === 'revenue') {
      this._balance += amount;
    } else if (type === 'expense') {
      this._balance -= amount;
    }
    return this._balance;
  }

  getDailyReport() {
    return {
      revenue: { ...this._monthlyRevenue },
      expenses: { ...this._monthlyExpenses },
      balance: this.getBalance(),
    };
  }

  getMonthlyReport() {
    const rev = { ...this._monthlyRevenue };
    const exp = { ...this._monthlyExpenses };
    const totalRev = this._sumObject(rev);
    const totalExp = this._sumObject(exp);
    const report = {
      revenue: rev,
      totalRevenue: totalRev,
      expenses: exp,
      totalExpenses: totalExp,
      netIncome: totalRev - totalExp,
      balance: this.getBalance(),
      loans: this._loans.map(l => ({ ...l })),
    };
    // Reset monthly accumulators
    this._monthlyRevenue = this._emptyRevenue();
    this._monthlyExpenses = this._emptyExpenses();
    return report;
  }

  /**
   * Returns a 0-1 score indicating how fair current pricing feels to guests.
   * Below 1.0 player multiplier = generous (score ~1), above 1.5 = gouging (score drops).
   */
  getPricingFairnessScore() {
    const m = this._playerPriceMultiplier;
    if (m <= 1.0) return 1.0;
    if (m >= 2.0) return 0.2;
    // Linear interpolation 1.0->1.0, 2.0->0.2
    return 1.0 - (m - 1.0) * 0.8;
  }

  setPlayerPriceMultiplier(mult) {
    this._playerPriceMultiplier = Math.max(0.5, Math.min(2.0, mult));
  }

  // ---------------------------------------------------------------------------
  // Loans
  // ---------------------------------------------------------------------------

  takeLoan(principal) {
    const totalLoaned = this._loans.reduce((s, l) => s + l.remainingBalance, 0);
    if (totalLoaned + principal > MAX_LOAN_AMOUNT) return false;

    const months = 60; // 5-year term
    const monthlyRate = LOAN_INTEREST_RATE_ANNUAL / 12;
    const payment = principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));

    this._loans.push({
      principal,
      remainingBalance: principal,
      interestRate: LOAN_INTEREST_RATE_ANNUAL,
      monthlyPayment: payment,
      monthsLeft: months,
    });

    this._balance += principal;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Investments
  // ---------------------------------------------------------------------------

  addInvestment(name, cost, monthlyReturn) {
    if (this._balance < cost) return false;
    this._balance -= cost;
    this._investments.push({ name, cost, monthlyReturn, installedDate: new Date() });
    return true;
  }

  // ---------------------------------------------------------------------------
  // Currency formatting
  // ---------------------------------------------------------------------------

  static formatCurrency(amount) {
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(2)}`;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  _getDynamicMultiplier(date) {
    let mult = 1.0;

    // Day of week (JS: 0=Sun, convert to Mon=0)
    const jsDay = date.getDay();
    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;
    mult *= DAY_MULTIPLIERS[dayIndex];

    // Holiday check
    const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (HOLIDAYS.includes(mmdd)) mult *= HOLIDAY_MULTIPLIER;

    return mult;
  }

  _processDailyExpenses(gameState) {
    this._addExpense('staffWages', BASE_EXPENSES.staffWagesDaily);
    this._addExpense('liftMaintenance', BASE_EXPENSES.liftMaintenanceDaily);
    this._addExpense('grooming', BASE_EXPENSES.groomingNightly);
    this._addExpense('utilities', BASE_EXPENSES.utilitiesDaily);
    this._addExpense('marketing', BASE_EXPENSES.marketingDaily);
    this._addExpense('insurance', BASE_EXPENSES.insuranceDaily);
    this._addExpense('propertyTax', BASE_EXPENSES.propertyTaxDaily);
  }

  _processLoanPayments(date) {
    for (let i = this._loans.length - 1; i >= 0; i--) {
      const loan = this._loans[i];
      if (date.getDate() === 1 && loan.monthsLeft > 0) {
        this._addExpense('loanPayments', loan.monthlyPayment);
        loan.remainingBalance -= loan.monthlyPayment - (loan.remainingBalance * loan.interestRate / 12);
        loan.monthsLeft--;
        if (loan.monthsLeft <= 0) this._loans.splice(i, 1);
      }
    }
  }

  _processInvestmentReturns(date) {
    if (date.getDate() === 1) {
      for (const inv of this._investments) {
        this._addRevenue('investments', inv.monthlyReturn);
      }
    }
  }

  _addRevenue(category, amount) {
    if (this._revenue[category] !== undefined) {
      this._revenue[category] += amount;
    }
  }

  _addExpense(category, amount) {
    if (this._expenses[category] !== undefined) {
      this._expenses[category] += amount;
    }
  }

  _accumulateMonthly() {
    for (const k of Object.keys(this._revenue)) {
      this._monthlyRevenue[k] = (this._monthlyRevenue[k] || 0) + this._revenue[k];
    }
    for (const k of Object.keys(this._expenses)) {
      this._monthlyExpenses[k] = (this._monthlyExpenses[k] || 0) + this._expenses[k];
    }
  }

  _emptyRevenue() {
    return {
      liftTickets: 0,
      passes: 0,
      hotels: 0,
      restaurants: 0,
      bars: 0,
      shops: 0,
      rentals: 0,
      condos: 0,
      parking: 0,
      lessons: 0,
      investments: 0,
    };
  }

  _emptyExpenses() {
    return {
      staffWages: 0,
      liftMaintenance: 0,
      snowmaking: 0,
      grooming: 0,
      utilities: 0,
      marketing: 0,
      insurance: 0,
      propertyTax: 0,
      loanPayments: 0,
    };
  }

  _sumObject(obj) {
    return Object.values(obj).reduce((a, b) => a + b, 0);
  }

  _dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    return Math.floor(diff / 86400000);
  }
}
