/**
 * FinanceTracker - Historical financial snapshots, reporting, projections,
 * and ROI analysis for Skiville.
 *
 * Intended to sit alongside EconomySystem: the EconomySystem drives live
 * balances and per-tick accumulation; FinanceTracker records end-of-period
 * summaries and answers questions like "where is our money coming from?"
 * and "will we break even on this gondola?"
 */

// ---------------------------------------------------------------------------
// Display labels for each breakdown category
// ---------------------------------------------------------------------------

const REVENUE_LABELS = {
  liftTickets:  'Lift Tickets',
  seasonPasses: 'Season Passes',
  foodBeverage: 'Food & Beverage',
  retail:       'Retail',
  rentals:      'Rentals',
  lodging:      'Lodging',
  parking:      'Parking',
  lessons:      'Lessons',
  events:       'Events',
  activities:   'Activities',
  realEstate:   'Real Estate',
};

const EXPENSE_LABELS = {
  staffWages:      'Staff Wages',
  liftMaintenance: 'Lift Maint.',
  snowmaking:      'Snowmaking',
  grooming:        'Grooming',
  utilities:       'Utilities',
  marketing:       'Marketing',
  loanPayments:    'Loan Payments',
  insurance:       'Insurance',
  construction:    'Construction',
};

// Bar colours cycled through for revenue breakdown rows
const REVENUE_COLOURS = [
  'progress-green',
  'progress-blue',
  'progress-green',
  'progress-orange',
  'progress-blue',
  'progress-green',
  'progress-orange',
  'progress-blue',
  'progress-green',
  'progress-blue',
  'progress-orange',
];

// ---------------------------------------------------------------------------
// Month name helper (index 0-11)
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---------------------------------------------------------------------------
// FinanceTracker
// ---------------------------------------------------------------------------

export class FinanceTracker {
  constructor() {
    /** @type {Array<{date:Date, revenue:number, expenses:number, net:number, guestCount:number, occupancy:number}>} */
    this.dailyHistory = [];

    /** @type {Array<{month:number, year:number, revenue:number, expenses:number, net:number, avgGuests:number, avgRating:number}>} */
    this.monthlyHistory = [];

    this.revenueBreakdown = this._emptyRevenueBreakdown();
    this.expenseBreakdown = this._emptyExpenseBreakdown();

    // Accumulators used when building the monthly snapshot from daily data
    this._pendingDailyForMonth = [];
  }

  // ---------------------------------------------------------------------------
  // Snapshot recording
  // ---------------------------------------------------------------------------

  /**
   * Call at the end of each game day.
   * Reads totals from gameState and appends to dailyHistory (capped at 30).
   *
   * @param {object} gameState - canonical game state from GameEngine
   */
  recordDailySnapshot(gameState) {
    const f = gameState.financials || {};
    const daily = f.daily || {};

    const revenue  = daily.revenue  || 0;
    const expenses = daily.expenses || 0;
    const guests   = gameState.guests?.current || 0;

    // Approximate occupancy from rating/satisfaction
    const satisfaction = (gameState.guests?.satisfaction || 75) / 100;
    const ratingFraction = (gameState.rating || 3) / 5;
    const occupancy = Math.min(1, ratingFraction * satisfaction);

    const snapshot = {
      date:       new Date(gameState.date),
      revenue,
      expenses,
      net:        revenue - expenses,
      guestCount: guests,
      occupancy,
    };

    this.dailyHistory.push(snapshot);
    if (this.dailyHistory.length > 30) this.dailyHistory.shift();

    // Keep a rolling buffer so recordMonthlySnapshot can aggregate
    this._pendingDailyForMonth.push(snapshot);
  }

  /**
   * Call at the end of each game month.
   * Aggregates buffered daily snapshots into a monthly summary (capped at 12).
   *
   * @param {object} gameState - canonical game state from GameEngine
   */
  recordMonthlySnapshot(gameState) {
    const date   = gameState.date || new Date();
    const month  = date.getMonth();       // 0-11
    const year   = date.getFullYear();

    const days = this._pendingDailyForMonth;

    // Use buffered daily data when available; fall back to gameState financials
    let totalRevenue  = 0;
    let totalExpenses = 0;
    let totalGuests   = 0;

    if (days.length > 0) {
      for (const d of days) {
        totalRevenue  += d.revenue;
        totalExpenses += d.expenses;
        totalGuests   += d.guestCount;
      }
    } else {
      const mf = (gameState.financials || {}).monthly || {};
      totalRevenue  = mf.revenue  || 0;
      totalExpenses = mf.expenses || 0;
      totalGuests   = gameState.guests?.current || 0;
    }

    const avgGuests = days.length > 0 ? totalGuests / days.length : totalGuests;

    this.monthlyHistory.push({
      month,
      year,
      revenue:   totalRevenue,
      expenses:  totalExpenses,
      net:       totalRevenue - totalExpenses,
      avgGuests: Math.round(avgGuests),
      avgRating: gameState.rating || 3,
    });

    if (this.monthlyHistory.length > 12) this.monthlyHistory.shift();

    // Clear the daily accumulator for next month
    this._pendingDailyForMonth = [];
  }

  // ---------------------------------------------------------------------------
  // Breakdown updates
  // ---------------------------------------------------------------------------

  /**
   * Accumulate an amount into the named revenue category.
   * Unknown categories are silently ignored.
   *
   * @param {string} category
   * @param {number} amount
   */
  updateRevenueBreakdown(category, amount) {
    if (Object.prototype.hasOwnProperty.call(this.revenueBreakdown, category)) {
      this.revenueBreakdown[category] += amount;
    }
  }

  /**
   * Accumulate an amount into the named expense category.
   *
   * @param {string} category
   * @param {number} amount
   */
  updateExpenseBreakdown(category, amount) {
    if (Object.prototype.hasOwnProperty.call(this.expenseBreakdown, category)) {
      this.expenseBreakdown[category] += amount;
    }
  }

  /** Reset both breakdowns to zero (call at the start of each reporting period). */
  resetPeriodBreakdowns() {
    this.revenueBreakdown = this._emptyRevenueBreakdown();
    this.expenseBreakdown = this._emptyExpenseBreakdown();
  }

  // ---------------------------------------------------------------------------
  // Simple accessors
  // ---------------------------------------------------------------------------

  getDailyHistory()    { return this.dailyHistory; }
  getMonthlyHistory()  { return this.monthlyHistory; }
  getRevenueBreakdown(){ return { ...this.revenueBreakdown }; }
  getExpenseBreakdown(){ return { ...this.expenseBreakdown }; }

  // ---------------------------------------------------------------------------
  // Projections
  // ---------------------------------------------------------------------------

  /**
   * Linear projection based on the trend across the last 3 monthly snapshots.
   * If fewer than 2 months exist the most recent values are used with zero slope.
   *
   * @param {number} months - how many future months to project
   * @returns {Array<{month:number, year:number, projectedRevenue:number, projectedExpenses:number, projectedNet:number}>}
   */
  getProjection(months = 3) {
    const history = this.monthlyHistory;
    const len     = history.length;

    // Determine baseline and slope from up to the last 3 real months
    const sample  = history.slice(Math.max(0, len - 3));
    const sLen    = sample.length;

    let baseRevenue  = 0;
    let baseExpenses = 0;
    let slopeRevenue  = 0;
    let slopeExpenses = 0;

    if (sLen === 0) {
      // No data at all — return zeros
      baseRevenue  = 0;
      baseExpenses = 0;
    } else if (sLen === 1) {
      baseRevenue  = sample[0].revenue;
      baseExpenses = sample[0].expenses;
    } else {
      // Least-squares linear regression over the sample
      const n = sLen;
      let sumX = 0, sumY_r = 0, sumY_e = 0, sumXY_r = 0, sumXY_e = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        sumX    += i;
        sumY_r  += sample[i].revenue;
        sumY_e  += sample[i].expenses;
        sumXY_r += i * sample[i].revenue;
        sumXY_e += i * sample[i].expenses;
        sumX2   += i * i;
      }
      const denom = n * sumX2 - sumX * sumX;
      if (denom !== 0) {
        slopeRevenue   = (n * sumXY_r - sumX * sumY_r)  / denom;
        slopeExpenses  = (n * sumXY_e - sumX * sumY_e)  / denom;
      }
      // Base = projected value at index n (i.e. one step beyond the last sample)
      baseRevenue  = (sumY_r  + slopeRevenue  * (n - sumX / n)) / n;
      baseExpenses = (sumY_e  + slopeExpenses * (n - sumX / n)) / n;
    }

    // Start from the last known month/year, or today if no history
    let refDate;
    if (len > 0) {
      const last = history[len - 1];
      refDate = new Date(last.year, last.month, 1);
    } else {
      refDate = new Date();
    }

    const result = [];
    for (let i = 1; i <= months; i++) {
      const projDate = new Date(refDate.getFullYear(), refDate.getMonth() + i, 1);
      const projRevenue  = Math.max(0, baseRevenue  + slopeRevenue  * i);
      const projExpenses = Math.max(0, baseExpenses + slopeExpenses * i);
      result.push({
        month:             projDate.getMonth(),
        year:              projDate.getFullYear(),
        projectedRevenue:  projRevenue,
        projectedExpenses: projExpenses,
        projectedNet:      projRevenue - projExpenses,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // ROI analysis
  // ---------------------------------------------------------------------------

  /**
   * Calculate return-on-investment metrics for a capital upgrade.
   *
   * @param {number} upgradeCost           - one-time capital outlay
   * @param {number} monthlyRevenueIncrease - incremental monthly revenue the upgrade generates
   * @returns {{ paybackMonths: number, yearlyROI: number, fiveYearNet: number }}
   */
  calculateROI(upgradeCost, monthlyRevenueIncrease) {
    const paybackMonths = monthlyRevenueIncrease > 0
      ? upgradeCost / monthlyRevenueIncrease
      : Infinity;

    const yearlyROI = upgradeCost > 0
      ? ((monthlyRevenueIncrease * 12) / upgradeCost) * 100
      : 0;

    const fiveYearNet = (monthlyRevenueIncrease * 60) - upgradeCost;

    return {
      paybackMonths: Math.round(paybackMonths * 10) / 10,
      yearlyROI:     Math.round(yearlyROI * 10) / 10,
      fiveYearNet:   Math.round(fiveYearNet),
    };
  }

  // ---------------------------------------------------------------------------
  // Summary helpers
  // ---------------------------------------------------------------------------

  /** Returns the revenue category key with the highest accumulated value. */
  getTopRevenueSource() {
    return this._maxKey(this.revenueBreakdown);
  }

  /** Returns the expense category key with the highest accumulated value. */
  getTopExpenseSource() {
    return this._maxKey(this.expenseBreakdown);
  }

  /**
   * Current profit margin as a percentage (revenue basis).
   * Returns 0 when there is no revenue data.
   */
  getProfitMargin() {
    const totalRevenue  = this._sum(this.revenueBreakdown);
    const totalExpenses = this._sum(this.expenseBreakdown);
    if (totalRevenue === 0) return 0;
    return Math.round(((totalRevenue - totalExpenses) / totalRevenue) * 1000) / 10;
  }

  // ---------------------------------------------------------------------------
  // HTML chart rendering
  // ---------------------------------------------------------------------------

  /**
   * Generates a self-contained HTML string with CSS-based charts.
   * Designed to be injected into the finance panel.
   *
   * @param {string} containerId - id for the wrapping element (unused in output
   *                               but kept for caller convenience / future hooks)
   * @returns {string} HTML markup
   */
  renderFinanceCharts(containerId) {
    const sections = [
      this._renderRevExpSection(),
      this._renderRevenueBreakdownSection(),
      this._renderExpenseBreakdownSection(),
      this._renderMonthlyTrendSection(),
      this._renderProjectionSection(),
    ];

    return `<div id="${containerId || 'finance-charts'}">${sections.join('')}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Chart section builders (private)
  // ---------------------------------------------------------------------------

  _renderRevExpSection() {
    const totalRev  = this._sum(this.revenueBreakdown);
    const totalExp  = this._sum(this.expenseBreakdown);
    const net       = totalRev - totalExp;
    const maxBar    = Math.max(totalRev, totalExp, 1);
    const netClass  = net >= 0 ? 'stat-positive' : 'stat-negative';
    const margin    = this.getProfitMargin();
    const marginClass = margin >= 0 ? 'stat-positive' : 'stat-negative';

    return `
<div class="panel-section">
  <div class="panel-section-title">Revenue vs Expenses</div>
  <div class="chart-container">
    ${this._bar('Revenue',  totalRev,  maxBar, 'progress-green', 'stat-positive')}
    ${this._bar('Expenses', totalExp,  maxBar, 'progress-red',   'stat-negative')}
  </div>
  <div class="stat-row">
    <span class="stat-label">Net</span>
    <span class="stat-value ${netClass}">${this._formatMoney(net)}</span>
  </div>
  <div class="stat-row">
    <span class="stat-label">Profit Margin</span>
    <span class="stat-value ${marginClass}">${margin.toFixed(1)}%</span>
  </div>
</div>`;
  }

  _renderRevenueBreakdownSection() {
    const breakdown = this.revenueBreakdown;
    const max = Math.max(...Object.values(breakdown), 1);
    const colourKeys = Object.keys(breakdown);

    const bars = colourKeys.map((key, i) => {
      const val    = breakdown[key] || 0;
      const label  = REVENUE_LABELS[key] || key;
      const colour = REVENUE_COLOURS[i % REVENUE_COLOURS.length];
      return this._bar(label, val, max, colour, 'stat-positive');
    }).join('');

    return `
<div class="panel-section">
  <div class="panel-section-title">Revenue Breakdown</div>
  <div class="chart-container">
    ${bars || '<p style="font-size:11px;opacity:0.5">No data recorded yet.</p>'}
  </div>
</div>`;
  }

  _renderExpenseBreakdownSection() {
    const breakdown = this.expenseBreakdown;
    const max = Math.max(...Object.values(breakdown), 1);

    const bars = Object.keys(breakdown).map(key => {
      const val   = breakdown[key] || 0;
      const label = EXPENSE_LABELS[key] || key;
      return this._bar(label, val, max, 'progress-red', 'stat-negative');
    }).join('');

    return `
<div class="panel-section">
  <div class="panel-section-title">Expense Breakdown</div>
  <div class="chart-container">
    ${bars || '<p style="font-size:11px;opacity:0.5">No data recorded yet.</p>'}
  </div>
</div>`;
  }

  _renderMonthlyTrendSection() {
    const slice = this.monthlyHistory.slice(-6);
    if (slice.length === 0) {
      return `
<div class="panel-section">
  <div class="panel-section-title">Monthly Trend (Last 6 Months)</div>
  <p style="font-size:11px;opacity:0.5;padding:8px 0">No monthly data recorded yet.</p>
</div>`;
    }

    const maxVal = Math.max(...slice.map(m => Math.max(m.revenue, m.expenses)), 1);

    const bars = slice.map(m => {
      const label = `${MONTH_NAMES[m.month]} ${m.year}`;
      const revBar = this._bar(`${label} Rev`, m.revenue,  maxVal, 'progress-green',  'stat-positive');
      const expBar = this._bar(`${label} Exp`, m.expenses, maxVal, 'progress-orange', 'stat-negative');
      return revBar + expBar;
    }).join('');

    return `
<div class="panel-section">
  <div class="panel-section-title">Monthly Trend (Last 6 Months)</div>
  <div class="chart-container">
    ${bars}
  </div>
</div>`;
  }

  _renderProjectionSection() {
    const projections = this.getProjection(3);
    const maxVal = Math.max(
      ...projections.map(p => Math.max(p.projectedRevenue, p.projectedExpenses)),
      1,
    );

    const bars = projections.map(p => {
      const label = `${MONTH_NAMES[p.month]} ${p.year}`;
      const netClass = p.projectedNet >= 0 ? 'stat-positive' : 'stat-negative';
      const revBar = this._bar(`${label} Rev`, p.projectedRevenue,  maxVal, 'progress-blue',   'stat-positive');
      const expBar = this._bar(`${label} Exp`, p.projectedExpenses, maxVal, 'progress-orange', 'stat-negative');
      const netRow = `
  <div class="stat-row" style="margin-bottom:8px">
    <span class="stat-label">${label} Net</span>
    <span class="stat-value ${netClass}">${this._formatMoney(p.projectedNet)}</span>
  </div>`;
      return revBar + expBar + netRow;
    }).join('');

    const hasTrend = this.monthlyHistory.length >= 2;
    const noteHtml = hasTrend
      ? ''
      : `<p style="font-size:10px;opacity:0.45;margin-bottom:6px">Projections improve after 2+ months of data.</p>`;

    return `
<div class="panel-section">
  <div class="panel-section-title">3-Month Projection</div>
  ${noteHtml}
  <div class="chart-container">
    ${bars}
  </div>
</div>`;
  }

  // ---------------------------------------------------------------------------
  // Bar HTML helper
  // ---------------------------------------------------------------------------

  /**
   * Renders a single chart-bar row.
   *
   * @param {string} label
   * @param {number} value
   * @param {number} maxValue     - used to compute fill percentage
   * @param {string} colourClass  - e.g. 'progress-green'
   * @param {string} valueClass   - e.g. 'stat-positive'
   */
  _bar(label, value, maxValue, colourClass, valueClass) {
    const pct = maxValue > 0 ? Math.min(100, (value / maxValue) * 100) : 0;
    return `
  <div class="chart-bar">
    <span class="chart-bar-label">${label}</span>
    <div class="chart-bar-track">
      <div class="chart-bar-fill ${colourClass}" style="width:${pct.toFixed(1)}%"></div>
    </div>
    <span class="chart-bar-value ${valueClass}">${this._formatMoney(value)}</span>
  </div>`;
  }

  // ---------------------------------------------------------------------------
  // Money formatting
  // ---------------------------------------------------------------------------

  /**
   * Compact currency formatter.
   *   ≥ $1 000 000  →  $1.2M
   *   ≥ $1 000      →  $500K
   *   otherwise     →  $1,234
   *
   * Negative values are prefixed with a minus sign.
   *
   * @param {number} n
   * @returns {string}
   */
  _formatMoney(n) {
    const sign = n < 0 ? '-' : '';
    const abs  = Math.abs(n);

    if (abs >= 1_000_000) {
      return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000) {
      return `${sign}$${(abs / 1_000).toFixed(0)}K`;
    }
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
  }

  // ---------------------------------------------------------------------------
  // Private utilities
  // ---------------------------------------------------------------------------

  _sum(obj) {
    return Object.values(obj).reduce((a, b) => a + b, 0);
  }

  _maxKey(obj) {
    let best = null;
    let bestVal = -Infinity;
    for (const [k, v] of Object.entries(obj)) {
      if (v > bestVal) { bestVal = v; best = k; }
    }
    return best;
  }

  _emptyRevenueBreakdown() {
    return {
      liftTickets:  0,
      seasonPasses: 0,
      foodBeverage: 0,
      retail:       0,
      rentals:      0,
      lodging:      0,
      parking:      0,
      lessons:      0,
      events:       0,
      activities:   0,
      realEstate:   0,
    };
  }

  _emptyExpenseBreakdown() {
    return {
      staffWages:      0,
      liftMaintenance: 0,
      snowmaking:      0,
      grooming:        0,
      utilities:       0,
      marketing:       0,
      loanPayments:    0,
      insurance:       0,
      construction:    0,
    };
  }
}
