/**
 * ActivitySystem - Manages resort activities beyond skiing.
 *
 * Handles building, toggling, seasonal validation, revenue/expense
 * processing, and satisfaction contributions for all non-ski activities
 * (terrain parks, tubing, summer biking, etc.).
 *
 * Integrates with the GameEngine's financials shape:
 *   gameState.financials.daily.{ revenue, expenses }
 * and reads gameState.guests.current for occupancy calculations.
 */

import { ACTIVITIES } from '../data/activities.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Map a GameEngine season string to an activity season bucket.
 * GameEngine SEASONS: 'early-winter' | 'peak-winter' | 'spring' |
 *                     'summer' | 'fall'
 * Activity seasons:   'winter' | 'summer' | 'year-round'
 */
function engineSeasonToActivitySeason(engineSeason) {
  if (engineSeason === 'early-winter' || engineSeason === 'peak-winter') {
    return 'winter';
  }
  if (engineSeason === 'summer') {
    return 'summer';
  }
  // spring / fall are shoulder seasons — only year-round activities operate
  return 'shoulder';
}

/**
 * Returns true if the activity should be open given the current season.
 * Year-round activities run in all seasons.
 * Winter/summer activities only run in their matching season.
 */
function isSeasonMatch(activitySeason, currentActivitySeason) {
  if (activitySeason === 'year-round') return true;
  return activitySeason === currentActivitySeason;
}

/**
 * Normalise a targetDemographic value (string or array) to an array.
 */
function normaliseDemographic(raw) {
  if (Array.isArray(raw)) return raw;
  return [raw];
}

// ---------------------------------------------------------------------------
// ActivitySystem
// ---------------------------------------------------------------------------

export class ActivitySystem {
  constructor() {
    // Pub/sub listeners
    this._listeners = {};

    /**
     * builtActivities: Map<activityId, {
     *   active:     boolean,
     *   position:   { lat: number, lng: number },
     *   builtDate:  Date,
     *   revenue:    number,   // lifetime revenue accumulated
     * }>
     */
    this.builtActivities = new Map();

    // Quick lookup: activityId -> catalog entry
    this._catalog = new Map(ACTIVITIES.map(a => [a.id, a]));
  }

  // ---------------------------------------------------------------------------
  // Pub / Sub
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to an event.
   * @param {string}   event
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe a specific callback from an event.
   * @param {string}   event
   * @param {Function} callback
   */
  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  /**
   * Emit an event to all registered listeners.
   * @param {string} event
   * @param {*}      data
   */
  emit(event, data) {
    const callbacks = this._listeners[event];
    if (callbacks) callbacks.forEach(cb => cb(data));
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  /**
   * Attempt to build an activity at the given map position.
   *
   * Validates:
   *  - Activity exists in catalog
   *  - Activity not already built
   *  - Player has sufficient funds (gameState.money)
   *
   * On success:
   *  - Deducts buildCost from gameState.money
   *  - Registers the activity as built and active
   *  - Emits 'activityBuilt'
   *
   * @param {string}  activityId
   * @param {{ lat: number, lng: number }} position
   * @param {object}  gameState  - Canonical game state from GameEngine
   * @returns {{ success: boolean, error?: string }}
   */
  buildActivity(activityId, position, gameState) {
    const activity = this._catalog.get(activityId);
    if (!activity) {
      return { success: false, error: `Unknown activity id: "${activityId}"` };
    }

    if (this.builtActivities.has(activityId)) {
      return {
        success: false,
        error: `"${activity.name}" has already been built.`,
      };
    }

    if (gameState.money < activity.buildCost) {
      return {
        success: false,
        error:
          `Insufficient funds. "${activity.name}" costs ` +
          `$${activity.buildCost.toLocaleString()} but you only have ` +
          `$${Math.floor(gameState.money).toLocaleString()}.`,
      };
    }

    // Deduct cost
    gameState.money -= activity.buildCost;

    // Register activity
    this.builtActivities.set(activityId, {
      active: true,
      position: { lat: position.lat, lng: position.lng },
      builtDate: gameState.date ? new Date(gameState.date) : new Date(),
      revenue: 0,
    });

    this.emit('activityBuilt', {
      activity,
      position,
      remainingFunds: gameState.money,
    });

    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Toggle
  // ---------------------------------------------------------------------------

  /**
   * Open or close a built activity.
   * No-ops silently if the activity has not been built.
   *
   * @param {string} activityId
   * @returns {{ active: boolean } | null}  New state, or null if not built
   */
  toggleActivity(activityId) {
    const record = this.builtActivities.get(activityId);
    if (!record) return null;

    record.active = !record.active;

    const activity = this._catalog.get(activityId);
    this.emit('activityToggled', {
      activityId,
      name: activity ? activity.name : activityId,
      active: record.active,
    });

    return { active: record.active };
  }

  // ---------------------------------------------------------------------------
  // Simulation update
  // ---------------------------------------------------------------------------

  /**
   * Advance all built activities by one simulation tick.
   *
   * For each built + active activity:
   *  1. Checks seasonal compatibility — auto-closes if the wrong season.
   *  2. Scales revenue by occupancy (guests / capacity).
   *  3. Applies full daily expenses regardless of occupancy.
   *  4. Adds net financials to gameState.financials.daily.
   *
   * @param {object} gameState - Canonical game state from GameEngine
   * @param {number} dt        - Delta time in game-minutes
   */
  update(gameState, dt) {
    if (!gameState || !gameState.financials) return;

    const currentActivitySeason = engineSeasonToActivitySeason(gameState.season);

    // dt is in game-minutes; scale financials proportionally to a full day
    const dayFraction = dt / (24 * 60);

    for (const [activityId, record] of this.builtActivities) {
      if (!record.active) continue;

      const activity = this._catalog.get(activityId);
      if (!activity) continue;

      // Auto-close if season is wrong
      if (!isSeasonMatch(activity.season, currentActivitySeason)) {
        record.active = false;
        this.emit('activityAutoClose', {
          activityId,
          name: activity.name,
          reason: `Out of season (activity: ${activity.season}, current: ${currentActivitySeason})`,
        });
        continue;
      }

      // Occupancy-scaled revenue: assume guests spread across all active activities
      const guestCount = gameState.guests ? (gameState.guests.current || 0) : 0;
      const occupancyRatio = Math.min(guestCount / activity.guestCapacity, 1.0);
      const tickRevenue = activity.dailyRevenue * occupancyRatio * dayFraction;
      const tickExpense = activity.dailyExpense * dayFraction;

      // Accumulate to game state financials
      gameState.financials.daily.revenue += tickRevenue;
      gameState.financials.daily.expenses += tickExpense;

      // Track lifetime revenue on the record
      record.revenue += tickRevenue;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Returns an array of built activities enriched with their catalog data
   * and current runtime status.
   *
   * @returns {Array<{
   *   id: string,
   *   name: string,
   *   season: string,
   *   buildCost: number,
   *   dailyRevenue: number,
   *   dailyExpense: number,
   *   guestCapacity: number,
   *   targetDemographic: string|string[],
   *   satisfactionBonus: number,
   *   description: string,
   *   active: boolean,
   *   position: { lat: number, lng: number },
   *   builtDate: Date,
   *   lifetimeRevenue: number,
   * }>}
   */
  getBuiltActivities() {
    const result = [];
    for (const [activityId, record] of this.builtActivities) {
      const activity = this._catalog.get(activityId);
      if (!activity) continue;
      result.push({
        ...activity,
        active: record.active,
        position: { ...record.position },
        builtDate: new Date(record.builtDate),
        lifetimeRevenue: record.revenue,
      });
    }
    return result;
  }

  /**
   * Returns catalog activities that have not yet been built.
   * Optionally accepts gameState for future unlock-condition checks.
   *
   * @param {object} [gameState]
   * @returns {Array} Unbuilt catalog entries
   */
  getAvailableActivities(gameState) { // eslint-disable-line no-unused-vars
    return ACTIVITIES.filter(a => !this.builtActivities.has(a.id));
  }

  /**
   * Returns the sum of satisfaction bonuses from all currently active
   * and seasonally valid built activities.
   *
   * The returned value is intended to be added directly to the base
   * satisfaction score (e.g. 0.23 = +23 pp).
   *
   * @returns {number}
   */
  getTotalSatisfactionBonus() {
    let total = 0;
    for (const [activityId, record] of this.builtActivities) {
      if (!record.active) continue;
      const activity = this._catalog.get(activityId);
      if (activity) total += activity.satisfactionBonus;
    }
    return total;
  }

  /**
   * Filters the full catalog to activities that operate in the given season.
   * Includes 'year-round' activities in every result set.
   *
   * @param {'winter'|'summer'|'year-round'|string} season
   *   Pass the ActivitySystem season string ('winter', 'summer') or a raw
   *   GameEngine season string (will be normalised automatically).
   * @returns {Array} Matching catalog entries
   */
  getSeasonalActivities(season) {
    // Accept both raw GameEngine season strings and normalised ones
    const normSeason =
      season === 'early-winter' || season === 'peak-winter'
        ? 'winter'
        : season === 'summer'
        ? 'summer'
        : season; // pass through 'winter', 'summer', 'year-round' unchanged

    return ACTIVITIES.filter(
      a => a.season === normSeason || a.season === 'year-round'
    );
  }

  // ---------------------------------------------------------------------------
  // Serialisation helpers (for GameEngine save/load)
  // ---------------------------------------------------------------------------

  /**
   * Serialise built activities to a plain object suitable for JSON.stringify.
   * @returns {Array}
   */
  serialise() {
    const entries = [];
    for (const [id, record] of this.builtActivities) {
      entries.push({
        id,
        active: record.active,
        position: record.position,
        builtDate: record.builtDate instanceof Date
          ? record.builtDate.toISOString()
          : record.builtDate,
        revenue: record.revenue,
      });
    }
    return entries;
  }

  /**
   * Restore built activities from a previously serialised array.
   * @param {Array} data
   */
  deserialise(data) {
    if (!Array.isArray(data)) return;
    this.builtActivities.clear();
    for (const entry of data) {
      this.builtActivities.set(entry.id, {
        active: entry.active,
        position: entry.position,
        builtDate: new Date(entry.builtDate),
        revenue: entry.revenue || 0,
      });
    }
  }
}

export default ActivitySystem;
