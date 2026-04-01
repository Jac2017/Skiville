/**
 * OperationsSystem - Manages snowmaking, grooming, avalanche control,
 * and lift operations for Skiville.
 *
 * Uses an event emitter pattern consistent with GameEngine. Modifies
 * gameState.resort directly during update() and charges costs to
 * gameState.financials.daily.expenses.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNOWMAKING_CM_PER_HOUR     = 1.5;   // cm/hr per active gun (when cold enough)
const SNOWMAKING_COST_PER_GUN_HR = 200;   // $USD/hr per active gun
const SNOWMAKING_MIN_TEMP_C      = -2;    // guns only work below this

const GROOMING_COST_PER_RUN      = 2_500; // $ per run groomed nightly
const GROOMING_NIGHT_START       = 22;    // game hour grooming window opens
const GROOMING_NIGHT_END         = 6;     // game hour grooming window closes (next day)
const GROOMING_TRAFFIC_DECAY     = 0.0001; // quality lost per guest per minute

const AVCONTROL_COST             = 15_000; // $ per zone treatment
const AVCONTROL_CLOSURE_HOURS    = 3;      // hours zone is closed after treatment
const LIFT_COST_PER_DAY          = 8_000;  // $ per open lift per game-day

// Risk levels ordered by severity (index = numeric risk)
const RISK_LEVELS = ['low', 'moderate', 'considerable', 'high', 'extreme'];

// Thresholds (new snow cm in last 24h) that shift risk upward per step
const RISK_NEW_SNOW_THRESHOLDS   = [5, 15, 30, 50];  // cm → moderate/considerable/high/extreme
const RISK_WIND_THRESHOLD_KMH    = 50;                // above this adds +1 risk tier
const RISK_TEMP_SWING_THRESHOLD  = 8;                 // °C swing adds +1 risk tier

const AVALANCHE_ZONES = [
  'alpine-whistler',
  'alpine-blackcomb',
  'glacier',
  'bowls',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function riskIndex(level) {
  return RISK_LEVELS.indexOf(level);
}

// ---------------------------------------------------------------------------
// OperationsSystem
// ---------------------------------------------------------------------------

export class OperationsSystem {
  constructor() {
    // ---- event emitter ----
    this._listeners = {};

    // ---- snowmaking ----
    // Map<runId, { active: boolean, coverage: number (0-1) }>
    this.snowGuns = new Map();

    // ---- grooming ----
    // Set<runId> of runs scheduled for nightly grooming
    this.groomingSchedule = new Set();

    // Per-run grooming quality: Map<runId, number (0-1)>
    this._groomingQuality = new Map();

    // Track which runs were already groomed this nightly cycle so we don't
    // double-charge. Resets when we leave the grooming window.
    this._groomedThisNight = new Set();
    this._inGroomingWindow = false;

    // ---- avalanche control ----
    // Map<zone, { riskLevel: string, closedUntil: Date|null, dailyNewSnow: number }>
    this._avalancheZones = new Map();
    this._initAvalancheZones();

    // Sliding window: last-24h snowfall samples
    // Array of { gameTime: Date, cmAdded: number }
    this._snowfallHistory = [];

    // For temperature-swing detection
    this._tempHistory = [];   // Array of { gameTime: Date, temp: number }

    // ---- lift state ----
    // Map<liftId, { onHold: boolean, holdReason: string|null }>
    this._liftState = new Map();

    // Accumulate fractional daily lift costs
    this._liftCostAccum = 0;

    // Track last expense-day to charge lift fixed costs once per game-day
    this._lastLiftExpenseDay = -1;
  }

  // ---------------------------------------------------------------------------
  // Event emitter
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
  // Initialisation helpers
  // ---------------------------------------------------------------------------

  _initAvalancheZones() {
    for (const zone of AVALANCHE_ZONES) {
      this._avalancheZones.set(zone, {
        riskLevel: 'low',
        closedUntil: null,
        dailyNewSnow: 0,
      });
    }
  }

  /**
   * Call once after gameState.resort.runs is populated to register all runs.
   * Safe to call again if runs change; will not overwrite existing entries.
   */
  initRuns(runs) {
    for (const run of runs) {
      if (!this.snowGuns.has(run.id)) {
        this.snowGuns.set(run.id, { active: false, coverage: 0 });
      }
      if (!this._groomingQuality.has(run.id)) {
        this._groomingQuality.set(run.id, run.groomed ? 1.0 : 0.5);
      }
    }
  }

  /**
   * Call once after gameState.resort.lifts is populated.
   */
  initLifts(lifts) {
    for (const lift of lifts) {
      if (!this._liftState.has(lift.id)) {
        this._liftState.set(lift.id, { onHold: false, holdReason: null });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Snowmaking API
  // ---------------------------------------------------------------------------

  /**
   * Toggle a snow gun on or off for the given run.
   * Registers the run if not yet tracked.
   */
  toggleSnowmaking(runId) {
    if (!this.snowGuns.has(runId)) {
      this.snowGuns.set(runId, { active: false, coverage: 0 });
    }
    const gun = this.snowGuns.get(runId);
    gun.active = !gun.active;
    this.emit('snowmakingToggled', { runId, active: gun.active });
    return gun.active;
  }

  /** Returns array of { runId, active, coverage } for all tracked guns. */
  getSnowmakingStatus() {
    return Array.from(this.snowGuns.entries()).map(([runId, gun]) => ({
      runId,
      active: gun.active,
      coverage: gun.coverage,
    }));
  }

  /** Total hourly cost ($) of all currently active snow guns. */
  getSnowmakingCostPerHour() {
    let count = 0;
    for (const gun of this.snowGuns.values()) {
      if (gun.active) count++;
    }
    return count * SNOWMAKING_COST_PER_GUN_HR;
  }

  // ---------------------------------------------------------------------------
  // Grooming API
  // ---------------------------------------------------------------------------

  /**
   * Add or remove a run from the nightly grooming schedule.
   */
  toggleGroomSchedule(runId) {
    if (this.groomingSchedule.has(runId)) {
      this.groomingSchedule.delete(runId);
      this.emit('groomScheduleChanged', { runId, scheduled: false });
      return false;
    } else {
      this.groomingSchedule.add(runId);
      this.emit('groomScheduleChanged', { runId, scheduled: true });
      return true;
    }
  }

  /**
   * Returns array of { runId, scheduled, quality } for all tracked runs.
   * Quality is 0-1 where 1 = freshly groomed.
   */
  getGroomingStatus() {
    const result = [];
    for (const [runId, quality] of this._groomingQuality.entries()) {
      result.push({
        runId,
        scheduled: this.groomingSchedule.has(runId),
        quality,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Avalanche control API
  // ---------------------------------------------------------------------------

  /**
   * Trigger avalanche control work on the given zone.
   * Costs $15,000, closes the zone for 3 hours, resets risk to 'low'.
   * @param {string} zone - one of AVALANCHE_ZONES
   * @param {object} gameState - current game state (for financials and date)
   * @returns {boolean} true if work was triggered
   */
  triggerControlWork(zone, gameState) {
    if (!this._avalancheZones.has(zone)) return false;
    const zoneData = this._avalancheZones.get(zone);

    // Charge the cost
    gameState.financials.daily.expenses += AVCONTROL_COST;

    // Close the zone for 3 game-hours
    const closedUntil = new Date(gameState.date.getTime() + AVCONTROL_CLOSURE_HOURS * 60 * 60 * 1000);
    zoneData.riskLevel = 'low';
    zoneData.closedUntil = closedUntil;

    // Close all runs in this zone
    this._closeZoneRuns(zone, gameState, closedUntil);

    this.emit('avalancheControlTriggered', {
      zone,
      cost: AVCONTROL_COST,
      closedUntil,
    });

    return true;
  }

  /** Returns array of { zone, riskLevel, closedUntil } for all zones. */
  getAvalancheRisk() {
    return AVALANCHE_ZONES.map(zone => {
      const data = this._avalancheZones.get(zone);
      return {
        zone,
        riskLevel: data.riskLevel,
        closedUntil: data.closedUntil,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Lift operations API
  // ---------------------------------------------------------------------------

  /**
   * Open or close a lift.
   * @param {string} liftId
   * @param {object} gameState
   */
  toggleLift(liftId, gameState) {
    const lift = (gameState.resort.lifts || []).find(l => l.id === liftId);
    if (!lift) return;

    if (lift.status === 'open') {
      lift.status = 'closed';
      this.emit('liftClosed', { liftId });
    } else {
      // Cannot open if on hold
      const state = this._liftState.get(liftId);
      if (state?.onHold) {
        this.emit('liftOpenBlocked', { liftId, reason: state.holdReason });
        return;
      }
      lift.status = 'open';
      this.emit('liftOpened', { liftId });
    }
  }

  /**
   * Put a lift on wind hold (or clear hold if reason is null).
   * @param {string} liftId
   * @param {string|null} reason - hold reason, or null to clear
   */
  setLiftHold(liftId, reason) {
    if (!this._liftState.has(liftId)) {
      this._liftState.set(liftId, { onHold: false, holdReason: null });
    }
    const state = this._liftState.get(liftId);
    if (reason) {
      state.onHold = true;
      state.holdReason = reason;
      this.emit('liftHoldSet', { liftId, reason });
    } else {
      state.onHold = false;
      state.holdReason = null;
      this.emit('liftHoldCleared', { liftId });
    }
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------

  /**
   * Advance all operations systems by dt game-minutes.
   * Modifies gameState.resort directly and debits gameState.financials.daily.expenses.
   *
   * @param {object} gameState - canonical game state from GameEngine
   * @param {number} dt - game minutes elapsed
   */
  update(gameState, dt) {
    if (dt <= 0) return;

    const hoursElapsed = dt / 60;
    const currentHour = gameState.time.hour;
    const date = gameState.date;
    const weather = gameState.weather;
    const runs = gameState.resort.runs || [];
    const lifts = gameState.resort.lifts || [];
    const guestCount = gameState.guests?.current || 0;

    // Register any runs/lifts that appeared since last call
    this.initRuns(runs);
    this.initLifts(lifts);

    // Track snowfall history for avalanche risk
    this._recordSnowfall(weather, date, hoursElapsed);
    this._recordTemperature(weather, date);

    // ---- Snowmaking ----
    this._updateSnowmaking(gameState, runs, weather, hoursElapsed);

    // ---- Grooming cycle ----
    this._updateGrooming(gameState, runs, currentHour, guestCount, dt);

    // ---- Avalanche control ----
    this._updateAvalanche(gameState, runs, date, weather);

    // ---- Lift operations costs ----
    this._updateLiftCosts(gameState, lifts, date);
  }

  // ---------------------------------------------------------------------------
  // Snowmaking update
  // ---------------------------------------------------------------------------

  _updateSnowmaking(gameState, runs, weather, hoursElapsed) {
    const canMakeSnow = weather.temperatureC < SNOWMAKING_MIN_TEMP_C;
    let totalCostThisTick = 0;

    for (const [runId, gun] of this.snowGuns.entries()) {
      if (!gun.active) continue;

      totalCostThisTick += SNOWMAKING_COST_PER_GUN_HR * hoursElapsed;

      if (canMakeSnow) {
        // Add snow to the specific run object
        const run = runs.find(r => r.id === runId);
        if (run) {
          run.snowDepthCm = (run.snowDepthCm || 0) + SNOWMAKING_CM_PER_HOUR * hoursElapsed;
        }

        // Coverage increases toward 1.0 over time
        gun.coverage = Math.min(1.0, gun.coverage + 0.02 * hoursElapsed);
      }
    }

    if (totalCostThisTick > 0) {
      gameState.financials.daily.expenses += totalCostThisTick;
    }
  }

  // ---------------------------------------------------------------------------
  // Grooming update
  // ---------------------------------------------------------------------------

  _updateGrooming(gameState, runs, currentHour, guestCount, dtMinutes) {
    const inNightWindow = this._isGroomingWindow(currentHour);

    // Detect transition into the grooming window
    if (inNightWindow && !this._inGroomingWindow) {
      this._inGroomingWindow = true;
      this._groomedThisNight.clear();
    } else if (!inNightWindow && this._inGroomingWindow) {
      this._inGroomingWindow = false;
    }

    if (inNightWindow) {
      // Process nightly grooming for scheduled runs not yet done tonight
      for (const runId of this.groomingSchedule) {
        if (this._groomedThisNight.has(runId)) continue;

        const run = runs.find(r => r.id === runId);
        if (!run) continue;

        run.groomed = true;
        this._groomingQuality.set(runId, 1.0);
        this._groomedThisNight.add(runId);

        // Charge grooming cost
        gameState.financials.daily.expenses += GROOMING_COST_PER_RUN;

        this.emit('runGroomed', { runId, cost: GROOMING_COST_PER_RUN });
      }
    } else {
      // Daytime: quality degrades based on guest traffic
      if (guestCount > 0) {
        const decay = guestCount * GROOMING_TRAFFIC_DECAY * dtMinutes;
        for (const [runId, quality] of this._groomingQuality.entries()) {
          const newQuality = clamp(quality - decay, 0, 1);
          this._groomingQuality.set(runId, newQuality);

          // Reflect degraded grooming on run object
          const run = runs.find(r => r.id === runId);
          if (run && newQuality < 0.3) {
            run.groomed = false;
          }
        }
      }
    }

    // Keep resort-wide groomingQuality in sync (average of open runs)
    const openRunQualities = runs
      .filter(r => r.status === 'open' && this._groomingQuality.has(r.id))
      .map(r => this._groomingQuality.get(r.id));

    if (openRunQualities.length > 0) {
      const avg = openRunQualities.reduce((s, q) => s + q, 0) / openRunQualities.length;
      gameState.resort.groomingQuality = Math.round(avg * 100) / 100;
    }
  }

  _isGroomingWindow(hour) {
    // 22:00 through 05:59
    return hour >= GROOMING_NIGHT_START || hour < GROOMING_NIGHT_END;
  }

  // ---------------------------------------------------------------------------
  // Avalanche update
  // ---------------------------------------------------------------------------

  _updateAvalanche(gameState, runs, date, weather) {
    const newSnow24h = this._getNewSnowLast24h(date);
    const tempSwing  = this._getTempSwingLast24h(date);

    for (const zone of AVALANCHE_ZONES) {
      const zoneData = this._avalancheZones.get(zone);

      // Check if closure has expired
      if (zoneData.closedUntil && date >= zoneData.closedUntil) {
        zoneData.closedUntil = null;
        this._reopenZoneRuns(zone, gameState);
        this.emit('zoneReopened', { zone });
      }

      // Recalculate risk (skip if currently under control work)
      if (!zoneData.closedUntil) {
        zoneData.riskLevel = this._calcAvalancheRisk(newSnow24h, weather.windSpeedKmh, tempSwing);
      }

      // Auto-close zone runs if risk is extreme
      if (zoneData.riskLevel === 'extreme' && !zoneData.closedUntil) {
        this._closeZoneRuns(zone, gameState, null);
        this.emit('extremeRiskAutoClose', { zone });
      }
    }
  }

  _calcAvalancheRisk(newSnow24h, windSpeedKmh, tempSwingC) {
    let riskIdx = 0; // start at 'low'

    // New snow contribution
    for (let i = 0; i < RISK_NEW_SNOW_THRESHOLDS.length; i++) {
      if (newSnow24h >= RISK_NEW_SNOW_THRESHOLDS[i]) {
        riskIdx = i + 1;
      }
    }

    // Wind contribution
    if (windSpeedKmh >= RISK_WIND_THRESHOLD_KMH) {
      riskIdx = Math.min(riskIdx + 1, RISK_LEVELS.length - 1);
    }

    // Temperature swing contribution
    if (tempSwingC >= RISK_TEMP_SWING_THRESHOLD) {
      riskIdx = Math.min(riskIdx + 1, RISK_LEVELS.length - 1);
    }

    return RISK_LEVELS[riskIdx];
  }

  // ---------------------------------------------------------------------------
  // Zone run helpers
  // ---------------------------------------------------------------------------

  /**
   * Determine which zone a run belongs to based on the run's mountain and
   * difficulty. This is a heuristic mapping — real data would use coordinates.
   */
  _getRunZone(run) {
    const mountain = run.mountain || '';
    const difficulty = run.difficulty || '';

    if (mountain === 'whistler' && (difficulty === 'double-black' || difficulty === 'black')) {
      return 'alpine-whistler';
    }
    if (mountain === 'blackcomb' && (difficulty === 'double-black' || difficulty === 'black')) {
      return 'alpine-blackcomb';
    }
    // Runs with 'glacier' or 'bowl' in their name go to the relevant zone
    const nameLower = (run.name || '').toLowerCase();
    if (nameLower.includes('glacier') || nameLower.includes('horstman')) return 'glacier';
    if (nameLower.includes('bowl') || nameLower.includes('symphony') || nameLower.includes('harmony')) return 'bowls';

    // Remaining blacks on either mountain → alpine zones
    if (mountain === 'whistler') return 'alpine-whistler';
    if (mountain === 'blackcomb') return 'alpine-blackcomb';
    return null;
  }

  _closeZoneRuns(zone, gameState, closedUntil) {
    const runs = gameState.resort.runs || [];
    for (const run of runs) {
      if (this._getRunZone(run) === zone) {
        run.status = 'closed';
        run._avalancheClosure = true;
        run._closedUntil = closedUntil;
      }
    }
  }

  _reopenZoneRuns(zone, gameState) {
    const runs = gameState.resort.runs || [];
    for (const run of runs) {
      if (this._getRunZone(run) === zone && run._avalancheClosure) {
        run.status = 'open';
        run._avalancheClosure = false;
        run._closedUntil = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lift cost update
  // ---------------------------------------------------------------------------

  _updateLiftCosts(gameState, lifts, date) {
    // Charge $8,000/day per open lift — prorate per tick
    const openLifts = lifts.filter(l => l.status === 'open').length;
    if (openLifts === 0) return;

    // Per-minute cost
    const minuteCost = (openLifts * LIFT_COST_PER_DAY) / (24 * 60);
    const tickCost = minuteCost; // dt is folded in at the call site; we charge per minute here

    // We accumulate and charge once per game-day at rollover to avoid
    // float drift, but also add the per-tick fractional cost to expenses
    // continuously so the finance panel stays live.
    gameState.financials.daily.expenses += minuteCost;
  }

  // ---------------------------------------------------------------------------
  // Snowfall / temperature history (for avalanche risk)
  // ---------------------------------------------------------------------------

  _recordSnowfall(weather, date, hoursElapsed) {
    const snowAdded = (weather.snowRateCmPerHour || 0) * hoursElapsed;
    if (snowAdded > 0) {
      this._snowfallHistory.push({ gameTime: new Date(date), cmAdded: snowAdded });
    }

    // Prune entries older than 24 game-hours
    const cutoff = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    this._snowfallHistory = this._snowfallHistory.filter(e => e.gameTime >= cutoff);
  }

  _getNewSnowLast24h(date) {
    const cutoff = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    return this._snowfallHistory
      .filter(e => e.gameTime >= cutoff)
      .reduce((sum, e) => sum + e.cmAdded, 0);
  }

  _recordTemperature(weather, date) {
    this._tempHistory.push({ gameTime: new Date(date), temp: weather.temperatureC });
    const cutoff = new Date(date.getTime() - 24 * 60 * 60 * 1000);
    this._tempHistory = this._tempHistory.filter(e => e.gameTime >= cutoff);
  }

  _getTempSwingLast24h(date) {
    if (this._tempHistory.length < 2) return 0;
    const temps = this._tempHistory.map(e => e.temp);
    return Math.max(...temps) - Math.min(...temps);
  }

  // ---------------------------------------------------------------------------
  // Convenience accessors used by the renderer
  // ---------------------------------------------------------------------------

  /**
   * Returns the game-hour at which the next grooming window opens.
   */
  getNextGroomingTime() {
    return GROOMING_NIGHT_START; // 22:00
  }

  /**
   * Returns total number of runs currently scheduled for grooming.
   */
  getGroomingScheduleCount() {
    return this.groomingSchedule.size;
  }

  /**
   * Returns total snow production rate (cm/hr) across all active guns.
   */
  getTotalSnowProductionRate(weather) {
    if ((weather?.temperatureC ?? 0) >= SNOWMAKING_MIN_TEMP_C) return 0;
    let count = 0;
    for (const gun of this.snowGuns.values()) {
      if (gun.active) count++;
    }
    return count * SNOWMAKING_CM_PER_HOUR;
  }
}
