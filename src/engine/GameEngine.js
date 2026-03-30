import { WeatherSystem } from './WeatherSystem.js';
import { EconomySystem } from './EconomySystem.js';
import { GuestSystem } from './GuestSystem.js';

const SPEED_MULTIPLIERS = {
  1: 1,    // 1 game minute per real second
  2: 2,    // 2 game minutes per real second
  3: 5,    // 5 game minutes per real second
};

const AUTO_SAVE_INTERVAL_MINUTES = 5;
const INITIAL_BUDGET = 50_000_000;
const GAME_START_DATE = new Date(2024, 11, 1, 6, 0, 0); // Dec 1, 2024, 6:00 AM

const SEASONS = {
  EARLY_WINTER: 'early-winter',   // Dec - Jan
  PEAK_WINTER: 'peak-winter',     // Feb - Mar
  SPRING: 'spring',               // Apr - May
  SUMMER: 'summer',               // Jun - Aug
  FALL: 'fall',                   // Sep - Nov
};

function getSeason(month) {
  if (month === 11 || month === 0) return SEASONS.EARLY_WINTER;
  if (month === 1 || month === 2) return SEASONS.PEAK_WINTER;
  if (month === 3 || month === 4) return SEASONS.SPRING;
  if (month >= 5 && month <= 7) return SEASONS.SUMMER;
  return SEASONS.FALL;
}

/**
 * GameEngine - Main game loop and state manager for Skiville.
 *
 * Coordinates all subsystems (weather, economy, guests), maintains
 * the canonical game state, and drives the simulation forward via
 * requestAnimationFrame with delta-time accumulation.
 */
export class GameEngine {
  constructor() {
    this._listeners = {};
    this._rafId = null;
    this._lastTimestamp = null;
    this._accumulatedRealMs = 0;
    this._minutesSinceAutoSave = 0;

    // Subsystems
    this.weather = new WeatherSystem();
    this.economy = new EconomySystem();
    this.guests = new GuestSystem();

    // Core state
    this.state = this._buildInitialState();
  }

  // ---------------------------------------------------------------------------
  // State construction
  // ---------------------------------------------------------------------------

  _buildInitialState() {
    const date = new Date(GAME_START_DATE);
    return {
      money: INITIAL_BUDGET,
      date: date,
      time: { hour: date.getHours(), minute: date.getMinutes() },
      speed: 1,
      paused: true,
      guests: {
        current: 0,
        totalToday: 0,
        satisfaction: 75,
      },
      rating: 3.0,          // out of 5
      season: getSeason(date.getMonth()),
      weather: this.weather.getConditions(),
      resort: {
        name: 'Skiville Mountain Resort',
        lifts: [],
        runs: [],
        buildings: [],
        snowDepthCm: 80,    // starting base
        snowmaking: false,
        groomingQuality: 0.7,
      },
      financials: {
        daily: { revenue: 0, expenses: 0 },
        weekly: { revenue: 0, expenses: 0 },
        monthly: { revenue: 0, expenses: 0 },
        seasonal: { revenue: 0, expenses: 0 },
        lastDayProcessed: date.getDate(),
        lastWeekProcessed: this._getWeekNumber(date),
        lastMonthProcessed: date.getMonth(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Pub / Sub event system
  // ---------------------------------------------------------------------------

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    const cbs = this._listeners[event];
    if (cbs) cbs.forEach(cb => cb(data));
  }

  // ---------------------------------------------------------------------------
  // Control methods
  // ---------------------------------------------------------------------------

  start() {
    this._tryLoadState();
    this.state.paused = false;
    this._lastTimestamp = performance.now();
    this._accumulatedRealMs = 0;
    this._scheduleFrame();
    this.emit('start', this.state);
  }

  pause() {
    this.state.paused = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.emit('pause', this.state);
  }

  resume() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this._lastTimestamp = performance.now();
    this._accumulatedRealMs = 0;
    this._scheduleFrame();
    this.emit('resume', this.state);
  }

  setSpeed(multiplier) {
    if (!(multiplier in SPEED_MULTIPLIERS)) {
      console.warn(`Invalid speed multiplier: ${multiplier}`);
      return;
    }
    this.state.speed = multiplier;
    this.emit('speedChange', { speed: multiplier });
  }

  getState() {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------

  _scheduleFrame() {
    this._rafId = requestAnimationFrame((ts) => this._frame(ts));
  }

  _frame(timestamp) {
    if (this.state.paused) return;

    const realDeltaMs = Math.min(timestamp - this._lastTimestamp, 200); // cap to avoid spiral
    this._lastTimestamp = timestamp;

    // Convert real ms to game minutes
    const gameMinutes = (realDeltaMs / 1000) * SPEED_MULTIPLIERS[this.state.speed];

    this.update(gameMinutes);

    this._scheduleFrame();
  }

  /**
   * Advance the simulation by `dt` game-minutes.
   */
  update(dt) {
    if (dt <= 0) return;

    // Advance game clock
    this._advanceClock(dt);

    // Update subsystems — order matters
    this.weather.update(this.state.date, dt);
    this.state.weather = this.weather.getConditions();

    this.guests.update(this.state, dt);
    this.state.guests.current = this.guests.getGuestCount();
    this.state.guests.satisfaction = this.guests.getAverageSatisfaction();

    this.economy.update(this.state, dt);
    this.state.money = this.economy.getBalance();

    // Snow depth bookkeeping
    this._updateSnowDepth(dt);

    // Financial period rollovers
    this._checkFinancialPeriods();

    // Rating recalc every game-hour-ish (batched)
    this._accumulatedRealMs += dt;
    if (this._accumulatedRealMs >= 60) {
      this._accumulatedRealMs -= 60;
      this._recalculateRating();
    }

    // Season tracking
    this.state.season = getSeason(this.state.date.getMonth());

    // Auto-save
    this._minutesSinceAutoSave += dt;
    if (this._minutesSinceAutoSave >= AUTO_SAVE_INTERVAL_MINUTES) {
      this._minutesSinceAutoSave -= AUTO_SAVE_INTERVAL_MINUTES;
      this._autoSave();
    }

    this.emit('update', this.state);
  }

  // ---------------------------------------------------------------------------
  // Clock
  // ---------------------------------------------------------------------------

  _advanceClock(minutes) {
    const ms = minutes * 60 * 1000;
    this.state.date = new Date(this.state.date.getTime() + ms);
    this.state.time.hour = this.state.date.getHours();
    this.state.time.minute = this.state.date.getMinutes();
  }

  // ---------------------------------------------------------------------------
  // Snow depth
  // ---------------------------------------------------------------------------

  _updateSnowDepth(dt) {
    const conditions = this.state.weather;
    const hoursElapsed = dt / 60;

    // Accumulation
    if (conditions.state === 'heavy-snow') {
      this.state.resort.snowDepthCm += (3 + Math.random() * 5) * hoursElapsed;
    } else if (conditions.state === 'light-snow') {
      this.state.resort.snowDepthCm += (0.5 + Math.random() * 1.5) * hoursElapsed;
    } else if (conditions.state === 'blizzard') {
      this.state.resort.snowDepthCm += (5 + Math.random() * 8) * hoursElapsed;
    }

    // Melt
    if (conditions.temperatureC > 0) {
      const meltRate = conditions.temperatureC * 0.4; // cm per hour per degree above 0
      this.state.resort.snowDepthCm = Math.max(0, this.state.resort.snowDepthCm - meltRate * hoursElapsed);
    }

    // Snowmaking contribution (if active and cold enough)
    if (this.state.resort.snowmaking && conditions.temperatureC < -2) {
      this.state.resort.snowDepthCm += 1.5 * hoursElapsed;
    }
  }

  // ---------------------------------------------------------------------------
  // Financial period rollovers
  // ---------------------------------------------------------------------------

  _checkFinancialPeriods() {
    const d = this.state.date;
    const f = this.state.financials;

    // Daily rollover
    if (d.getDate() !== f.lastDayProcessed) {
      this.emit('dailyReport', { ...f.daily });
      f.daily = { revenue: 0, expenses: 0 };
      f.lastDayProcessed = d.getDate();
      // Reset daily guest counter
      this.state.guests.totalToday = 0;
    }

    // Weekly rollover
    const wk = this._getWeekNumber(d);
    if (wk !== f.lastWeekProcessed) {
      this.emit('weeklyReport', { ...f.weekly });
      f.weekly = { revenue: 0, expenses: 0 };
      f.lastWeekProcessed = wk;
    }

    // Monthly rollover
    if (d.getMonth() !== f.lastMonthProcessed) {
      this.emit('monthlyReport', this.economy.getMonthlyReport());
      f.monthly = { revenue: 0, expenses: 0 };
      f.lastMonthProcessed = d.getMonth();
    }
  }

  // ---------------------------------------------------------------------------
  // Resort rating
  // ---------------------------------------------------------------------------

  _recalculateRating() {
    const satisfaction = this.state.guests.satisfaction;       // 0-100
    const waitTimes = this.guests.getWaitTimes();
    const avgWait = waitTimes.length > 0
      ? waitTimes.reduce((s, w) => s + w.minutes, 0) / waitTimes.length
      : 0;
    const snowQuality = this._snowQualityScore();
    const facilityQuality = this.state.resort.groomingQuality; // 0-1
    const pricingFairness = this.economy.getPricingFairnessScore(); // 0-1

    // Weighted composite (each 0-1 range)
    const satisfactionNorm = satisfaction / 100;
    const waitScore = Math.max(0, 1 - avgWait / 30);  // 30 min wait = score 0
    const snowScore = snowQuality;
    const facilityScore = facilityQuality;
    const pricingScore = pricingFairness;

    const raw = (
      satisfactionNorm * 0.30 +
      waitScore * 0.25 +
      snowScore * 0.20 +
      facilityScore * 0.15 +
      pricingScore * 0.10
    );

    // Map 0-1 to 1-5 stars
    this.state.rating = Math.round((1 + raw * 4) * 10) / 10;
    this.state.rating = Math.min(5, Math.max(1, this.state.rating));
  }

  _snowQualityScore() {
    const temp = this.state.weather.temperatureC;
    const depth = this.state.resort.snowDepthCm;

    let quality = 0;
    if (depth < 30) quality = 0.2;
    else if (depth < 80) quality = 0.5;
    else if (depth < 200) quality = 0.8;
    else quality = 1.0;

    // Temperature bonus for powder
    if (temp < -8) quality = Math.min(1, quality + 0.15);
    else if (temp > 0) quality = Math.max(0, quality - 0.3);

    return Math.max(0, Math.min(1, quality));
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  _autoSave() {
    try {
      const serializable = {
        ...this.state,
        date: this.state.date.toISOString(),
      };
      localStorage.setItem('skiville_save', JSON.stringify(serializable));
      this.emit('autoSave', { timestamp: Date.now() });
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }

  _tryLoadState() {
    try {
      const raw = localStorage.getItem('skiville_save');
      if (!raw) return;
      const saved = JSON.parse(raw);
      saved.date = new Date(saved.date);
      saved.time = { hour: saved.date.getHours(), minute: saved.date.getMinutes() };
      Object.assign(this.state, saved);
      this.economy.setBalance(this.state.money);
      this.emit('loaded', this.state);
    } catch (e) {
      console.warn('Failed to load save:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  _getWeekNumber(d) {
    const oneJan = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - oneJan) / 86400000);
    return Math.ceil((days + oneJan.getDay() + 1) / 7);
  }
}
