/**
 * GuestSystem - Guest AI simulation for Skiville.
 *
 * Models guest arrival patterns, behavior through the day, satisfaction
 * scoring, lift queue wait times, and word-of-mouth reputation effects.
 */

const PEAK_DAILY_CAPACITY = 30_000;

// ---------------------------------------------------------------------------
// Guest type definitions
// ---------------------------------------------------------------------------

const GUEST_TYPES = {
  family: {
    weight: 0.25,
    preferredDifficulty: ['green', 'blue'],
    spendingMultiplier: 1.3,       // families spend more overall (kids gear, lessons)
    satisfactionWeights: {
      liftWait: 0.20,
      snowConditions: 0.15,
      grooming: 0.20,
      weather: 0.10,
      crowding: 0.15,
      facilityQuality: 0.10,
      pricingFairness: 0.10,
    },
    arrivalBias: 0,                // arrives at normal time
    departureBias: -60,            // leaves a bit earlier
  },
  expert: {
    weight: 0.20,
    preferredDifficulty: ['black', 'double-black'],
    spendingMultiplier: 1.1,
    satisfactionWeights: {
      liftWait: 0.25,
      snowConditions: 0.30,
      grooming: 0.05,
      weather: 0.10,
      crowding: 0.15,
      facilityQuality: 0.05,
      pricingFairness: 0.10,
    },
    arrivalBias: -30,              // first on the mountain
    departureBias: 0,
  },
  beginner: {
    weight: 0.18,
    preferredDifficulty: ['green'],
    spendingMultiplier: 1.4,       // rentals + lessons
    satisfactionWeights: {
      liftWait: 0.15,
      snowConditions: 0.10,
      grooming: 0.25,
      weather: 0.15,
      crowding: 0.10,
      facilityQuality: 0.15,
      pricingFairness: 0.10,
    },
    arrivalBias: 30,
    departureBias: -30,
  },
  teenager: {
    weight: 0.12,
    preferredDifficulty: ['blue', 'black'],
    spendingMultiplier: 0.7,
    satisfactionWeights: {
      liftWait: 0.30,
      snowConditions: 0.20,
      grooming: 0.05,
      weather: 0.05,
      crowding: 0.10,
      facilityQuality: 0.10,
      pricingFairness: 0.20,
    },
    arrivalBias: 60,               // sleep in
    departureBias: 60,             // stay for apres
  },
  senior: {
    weight: 0.10,
    preferredDifficulty: ['green', 'blue'],
    spendingMultiplier: 1.0,
    satisfactionWeights: {
      liftWait: 0.20,
      snowConditions: 0.15,
      grooming: 0.20,
      weather: 0.15,
      crowding: 0.15,
      facilityQuality: 0.10,
      pricingFairness: 0.05,
    },
    arrivalBias: 0,
    departureBias: -90,
  },
  tourist: {
    weight: 0.15,
    preferredDifficulty: ['green', 'blue'],
    spendingMultiplier: 1.6,       // big spenders
    satisfactionWeights: {
      liftWait: 0.15,
      snowConditions: 0.15,
      grooming: 0.10,
      weather: 0.10,
      crowding: 0.10,
      facilityQuality: 0.20,
      pricingFairness: 0.20,
    },
    arrivalBias: 30,
    departureBias: 0,
  },
};

// ---------------------------------------------------------------------------
// Arrival curves — fraction of daily total arriving per hour (0-23)
// ---------------------------------------------------------------------------

// Weekday curve (total sums to ~1.0)
const WEEKDAY_ARRIVAL = [
  0, 0, 0, 0, 0, 0,               // 0-5: nobody
  0.02, 0.08, 0.18, 0.22,         // 6-9: ramp up
  0.15, 0.10, 0.05, 0.04,         // 10-13: tapering
  0.06, 0.05, 0.03, 0.02,         // 14-17: afternoon stragglers
  0, 0, 0, 0, 0, 0,               // 18-23: no new arrivals
];

// Weekend / holiday curve — earlier and heavier
const WEEKEND_ARRIVAL = [
  0, 0, 0, 0, 0, 0.01,
  0.04, 0.12, 0.22, 0.20,
  0.12, 0.08, 0.04, 0.03,
  0.05, 0.04, 0.03, 0.02,
  0, 0, 0, 0, 0, 0,
];

// Departure curve — fraction of remaining guests leaving per hour
const DEPARTURE_RATE = [
  0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0.02,
  0.05, 0.08, 0.10, 0.20,         // 12-15
  0.35, 0.50, 0.70, 0.85,         // 16-19
  0.95, 1.0, 1.0, 1.0,            // 20-23: everyone gone
];

// ---------------------------------------------------------------------------
// Time-of-day activity distribution
// ---------------------------------------------------------------------------

const ACTIVITY_PHASES = {
  // hour ranges and what fraction of on-mountain guests are doing what
  morning:    { hours: [8, 11],  skiing: 0.80, eating: 0.05, shopping: 0.05, queuing: 0.10 },
  lunch:      { hours: [11, 13], skiing: 0.35, eating: 0.40, shopping: 0.10, queuing: 0.15 },
  afternoon:  { hours: [13, 15], skiing: 0.75, eating: 0.05, shopping: 0.05, queuing: 0.15 },
  apresSki:   { hours: [15, 20], skiing: 0.15, eating: 0.25, shopping: 0.20, queuing: 0.05, drinking: 0.35 },
};

export class GuestSystem {
  constructor() {
    this._currentGuests = 0;
    this._totalToday = 0;
    this._guestsByType = {};
    for (const type of Object.keys(GUEST_TYPES)) {
      this._guestsByType[type] = 0;
    }

    this._satisfaction = 75;         // running weighted average
    this._satisfactionSamples = [];  // rolling window

    this._liftQueues = [];           // [{ liftId, queueLength, waitMinutes }]
    this._waitTimes = [];

    // Word-of-mouth reputation modifier (starts neutral)
    this._reputationMod = 1.0;      // 0.5 = terrible rep, 1.5 = amazing

    this._lastProcessedHour = -1;
    this._lastProcessedDay = -1;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  update(gameState, dt) {
    const date = gameState.date;
    const hour = date.getHours();
    const dayOfYear = this._dayOfYear(date);

    // Reset daily counters at new day
    if (dayOfYear !== this._lastProcessedDay) {
      this._endOfDay();
      this._lastProcessedDay = dayOfYear;
      this._totalToday = 0;
      this._currentGuests = 0;
      for (const type of Object.keys(GUEST_TYPES)) {
        this._guestsByType[type] = 0;
      }
    }

    // Process arrivals and departures once per game-hour
    if (hour !== this._lastProcessedHour) {
      this._processArrivals(gameState, hour);
      this._processDepartures(hour);
      this._lastProcessedHour = hour;
    }

    // Update satisfaction continuously
    this._updateSatisfaction(gameState, dt);

    // Update lift queues
    this._updateLiftQueues(gameState, hour);

    // Sync guest count to state
    gameState.guests.totalToday = this._totalToday;
  }

  getGuestCount() {
    return Math.round(this._currentGuests);
  }

  getAverageSatisfaction() {
    return Math.round(this._satisfaction * 10) / 10;
  }

  getWaitTimes() {
    return this._waitTimes;
  }

  getLiftQueues() {
    return this._liftQueues;
  }

  // ---------------------------------------------------------------------------
  // Arrivals
  // ---------------------------------------------------------------------------

  _processArrivals(gameState, hour) {
    const isWeekend = this._isWeekendOrHoliday(gameState.date);
    const curve = isWeekend ? WEEKEND_ARRIVAL : WEEKDAY_ARRIVAL;
    const fraction = curve[hour] || 0;
    if (fraction <= 0) return;

    // Base daily visitors scaled by season, weather, rating, and reputation
    const baseDailyTarget = this._calcDailyTarget(gameState);
    const arrivingNow = Math.round(baseDailyTarget * fraction);

    // Distribute across guest types
    for (const [type, config] of Object.entries(GUEST_TYPES)) {
      const typeCount = Math.round(arrivingNow * config.weight);
      this._guestsByType[type] += typeCount;
      this._currentGuests += typeCount;
      this._totalToday += typeCount;
    }
  }

  _calcDailyTarget(gameState) {
    let target = PEAK_DAILY_CAPACITY;

    // Season factor
    const season = gameState.season;
    const seasonFactors = {
      'early-winter': 0.65,
      'peak-winter': 1.0,
      'spring': 0.45,
      'summer': 0.05,    // mountain biking etc
      'fall': 0.02,
    };
    target *= (seasonFactors[season] || 0.5);

    // Weather factor — bad weather reduces visitors
    const weatherFactors = {
      'clear': 1.0,
      'partly-cloudy': 0.95,
      'overcast': 0.85,
      'light-snow': 0.90,       // powder chasers come!
      'heavy-snow': 0.70,
      'blizzard': 0.25,
      'freezing-rain': 0.15,
    };
    target *= (weatherFactors[gameState.weather.state] || 0.8);

    // Rating factor (1-5 stars)
    target *= 0.4 + (gameState.rating / 5) * 0.6;

    // Snow depth — very low snow kills attendance
    const depth = gameState.resort.snowDepthCm;
    if (depth < 20) target *= 0.1;
    else if (depth < 50) target *= 0.5;
    else if (depth < 100) target *= 0.85;
    // else: full

    // Weekend boost
    if (this._isWeekendOrHoliday(gameState.date)) {
      target *= 1.4;
    }

    // Reputation / word-of-mouth
    target *= this._reputationMod;

    return Math.min(PEAK_DAILY_CAPACITY, Math.round(target));
  }

  // ---------------------------------------------------------------------------
  // Departures
  // ---------------------------------------------------------------------------

  _processDepartures(hour) {
    const rate = DEPARTURE_RATE[hour] || 0;
    if (rate <= 0) return;

    const leaving = Math.round(this._currentGuests * rate);
    this._currentGuests = Math.max(0, this._currentGuests - leaving);

    // Proportionally remove from each type
    const total = Object.values(this._guestsByType).reduce((a, b) => a + b, 1);
    for (const type of Object.keys(GUEST_TYPES)) {
      const frac = this._guestsByType[type] / total;
      this._guestsByType[type] = Math.max(0, this._guestsByType[type] - Math.round(leaving * frac));
    }
  }

  // ---------------------------------------------------------------------------
  // Satisfaction
  // ---------------------------------------------------------------------------

  _updateSatisfaction(gameState, dt) {
    if (this._currentGuests <= 0) return;

    const weather = gameState.weather;
    const resort = gameState.resort;

    // Compute factor scores (each 0-1)
    const avgWait = this._waitTimes.length > 0
      ? this._waitTimes.reduce((s, w) => s + w.minutes, 0) / this._waitTimes.length
      : 0;
    const liftWaitScore = Math.max(0, 1 - avgWait / 25);      // 25 min = 0

    const snowScore = this._snowConditionScore(weather, resort.snowDepthCm);
    const groomingScore = resort.groomingQuality;              // 0-1

    const weatherComfort = {
      'clear': 1.0, 'partly-cloudy': 0.9, 'overcast': 0.7,
      'light-snow': 0.75, 'heavy-snow': 0.5, 'blizzard': 0.2, 'freezing-rain': 0.15,
    };
    const weatherScore = weatherComfort[weather.state] || 0.5;

    const crowdingRatio = this._currentGuests / PEAK_DAILY_CAPACITY;
    const crowdingScore = Math.max(0, 1 - crowdingRatio * 1.2); // over 83% = 0

    const facilityScore = 0.7; // placeholder — driven by buildings once built
    const pricingScore = this._pricingFairnessFromState(gameState);

    const scores = {
      liftWait: liftWaitScore,
      snowConditions: snowScore,
      grooming: groomingScore,
      weather: weatherScore,
      crowding: crowdingScore,
      facilityQuality: facilityScore,
      pricingFairness: pricingScore,
    };

    // Weighted average across all guest types present
    let totalWeightedSat = 0;
    let totalGuests = 0;
    for (const [type, config] of Object.entries(GUEST_TYPES)) {
      const count = this._guestsByType[type];
      if (count <= 0) continue;
      let typeSat = 0;
      for (const [factor, weight] of Object.entries(config.satisfactionWeights)) {
        typeSat += (scores[factor] || 0.5) * weight;
      }
      totalWeightedSat += typeSat * count;
      totalGuests += count;
    }

    if (totalGuests > 0) {
      const instantSat = (totalWeightedSat / totalGuests) * 100;
      // Exponential moving average
      const alpha = Math.min(1, dt / 120);  // ~2 hour smoothing
      this._satisfaction += (instantSat - this._satisfaction) * alpha;
      this._satisfaction = clamp(this._satisfaction, 0, 100);
    }
  }

  _snowConditionScore(weather, depthCm) {
    let score = 0;
    if (depthCm < 30) score = 0.2;
    else if (depthCm < 80) score = 0.5;
    else if (depthCm < 150) score = 0.8;
    else score = 1.0;

    // Quality bonus
    const quality = weather.snowQuality;
    if (quality === 'champagne-powder') score = Math.min(1, score + 0.2);
    else if (quality === 'powder') score = Math.min(1, score + 0.1);
    else if (quality === 'icy') score = Math.max(0, score - 0.3);

    return clamp(score, 0, 1);
  }

  _pricingFairnessFromState(gameState) {
    // Simple proxy — would be informed by EconomySystem in full integration
    return 0.8;
  }

  // ---------------------------------------------------------------------------
  // Lift queues & wait times
  // ---------------------------------------------------------------------------

  _updateLiftQueues(gameState, hour) {
    const lifts = gameState.resort.lifts;
    if (!lifts || lifts.length === 0) {
      // Default simulation with virtual lifts when none are built yet
      this._simulateDefaultQueues(gameState, hour);
      return;
    }

    this._liftQueues = [];
    this._waitTimes = [];

    const activity = this._getActivityPhase(hour);
    const skiingFraction = activity ? activity.skiing : 0;
    const queuingFraction = activity ? activity.queuing : 0;
    const guestsOnMountain = this._currentGuests * (skiingFraction + queuingFraction);

    for (const lift of lifts) {
      // Distribute guests roughly evenly, with popularity weighting
      const liftShare = guestsOnMountain / lifts.length;
      const queueLength = Math.round(liftShare * (queuingFraction / (skiingFraction + queuingFraction + 0.01)));
      const capacityPerMinute = (lift.capacity || 2400) / 60; // e.g. 2400 pph
      const waitMinutes = capacityPerMinute > 0 ? queueLength / capacityPerMinute : 0;

      // Wind closures
      const closed = gameState.weather.liftClosure ||
        (gameState.weather.liftWindHold && (lift.exposure === 'alpine' || lift.exposure === 'high'));

      this._liftQueues.push({
        liftId: lift.id,
        liftName: lift.name,
        queueLength: closed ? 0 : queueLength,
        closed,
      });

      this._waitTimes.push({
        liftId: lift.id,
        liftName: lift.name,
        minutes: closed ? 0 : Math.round(waitMinutes * 10) / 10,
      });
    }
  }

  _simulateDefaultQueues(gameState, hour) {
    // Before any lifts are placed, simulate 5 virtual lifts for the economy/satisfaction model
    const virtualLifts = [
      { id: 'v1', name: 'Village Gondola', capacityPPH: 2800 },
      { id: 'v2', name: 'Creekside Gondola', capacityPPH: 2400 },
      { id: 'v3', name: 'Peak Express', capacityPPH: 2000 },
      { id: 'v4', name: 'Harmony Express', capacityPPH: 2200 },
      { id: 'v5', name: 'Crystal Ridge', capacityPPH: 1800 },
    ];

    this._liftQueues = [];
    this._waitTimes = [];

    const activity = this._getActivityPhase(hour);
    const skiingFraction = activity ? activity.skiing : 0;
    const queuingFraction = activity ? activity.queuing : 0;
    const totalActive = skiingFraction + queuingFraction;
    if (totalActive <= 0) return;

    const guestsOnMountain = this._currentGuests * totalActive;

    for (const vl of virtualLifts) {
      const liftShare = guestsOnMountain / virtualLifts.length;
      const queueLength = Math.round(liftShare * (queuingFraction / totalActive));
      const capPerMin = vl.capacityPPH / 60;
      const waitMin = capPerMin > 0 ? queueLength / capPerMin : 0;

      const closed = gameState.weather.liftClosure;

      this._liftQueues.push({
        liftId: vl.id,
        liftName: vl.name,
        queueLength: closed ? 0 : queueLength,
        closed: !!closed,
      });

      this._waitTimes.push({
        liftId: vl.id,
        liftName: vl.name,
        minutes: closed ? 0 : Math.round(waitMin * 10) / 10,
      });
    }
  }

  _getActivityPhase(hour) {
    for (const phase of Object.values(ACTIVITY_PHASES)) {
      if (hour >= phase.hours[0] && hour < phase.hours[1]) return phase;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // End of day — word-of-mouth / reputation
  // ---------------------------------------------------------------------------

  _endOfDay() {
    // Adjust reputation based on today's satisfaction
    if (this._totalToday > 0) {
      const satNorm = this._satisfaction / 100; // 0-1
      // If satisfaction > 0.7, reputation grows; below 0.5, it shrinks
      const delta = (satNorm - 0.6) * 0.02;    // small daily nudge
      this._reputationMod = clamp(this._reputationMod + delta, 0.5, 1.5);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  _isWeekendOrHoliday(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return true;
    const mmdd = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const holidays = ['12-25', '12-26', '12-31', '01-01', '01-02', '02-17', '03-17'];
    return holidays.includes(mmdd);
  }

  _dayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    return Math.floor((date - start) / 86400000);
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
