/**
 * UpgradeSystem.js
 * Manages the resort upgrade catalog, prerequisite chains, in-progress timers,
 * and applied-effect tracking for Skiville's upgrade / technology-tree system.
 *
 * Emits events:
 *   'upgradeStarted'  { upgradeId, upgrade, gameState }
 *   'upgradeComplete' { upgradeId, upgrade, effects }
 *   'upgradeFailed'   { upgradeId, reason }
 */

'use strict';

// ---------------------------------------------------------------------------
// Upgrade catalog
// ---------------------------------------------------------------------------

/**
 * Full upgrade catalog grouped by category.
 * cost is in dollars.  buildTimeDays is real game-days.
 * effects keys are applied as multipliers/additions to the gameState modifier
 * layer — the EconomySystem / GuestSystem reads them.
 *
 * @type {Object.<string, UpgradeDefinition>}
 */
const UPGRADE_CATALOG = {

  // ----------------------------- LIFTS ------------------------------------

  'speed-upgrade': {
    id: 'speed-upgrade',
    name: 'Lift Speed Upgrade',
    category: 'lifts',
    cost: 2_000_000,
    buildTimeDays: 7,
    prerequisites: [],
    requiresExisting: 'lift',   // at least one lift must be built
    description: 'Upgrades lift motor and cable systems for higher throughput.',
    effects: {
      liftCapacityMultiplier: 1.20,   // +20 % capacity
    },
  },

  'heated-seats': {
    id: 'heated-seats',
    name: 'Heated Seat Cushions',
    category: 'lifts',
    cost: 1_500_000,
    buildTimeDays: 5,
    prerequisites: [],
    requiresExisting: 'lift',
    description: 'Electric heating elements in every chairlift seat keep guests warm and comfortable.',
    effects: {
      guestSatisfactionBonus: 10,     // +10 % satisfaction
    },
  },

  'bubble-cover': {
    id: 'bubble-cover',
    name: 'Bubble Cover System',
    category: 'lifts',
    cost: 3_000_000,
    buildTimeDays: 14,
    prerequisites: [],
    requiresExisting: 'lift',
    description: 'Transparent bubbles shield riders from wind and snow, boosting comfort and allowing operation in higher winds.',
    effects: {
      guestSatisfactionBonus: 15,     // +15 % satisfaction
      windResistant: true,
    },
  },

  'detachable-grip': {
    id: 'detachable-grip',
    name: 'Detachable Grip System',
    category: 'lifts',
    cost: 5_000_000,
    buildTimeDays: 21,
    prerequisites: [],
    requiresExisting: 'lift',
    description: 'High-speed detachable chairs slow only for loading — dramatically increasing passengers per hour.',
    effects: {
      liftCapacityMultiplier: 1.30,   // +30 % capacity
    },
  },

  // ----------------------------- DINING ----------------------------------

  'kitchen-expansion': {
    id: 'kitchen-expansion',
    name: 'Kitchen Expansion',
    category: 'dining',
    cost: 500_000,
    buildTimeDays: 10,
    prerequisites: [],
    description: 'Extended prep area and commercial equipment serves more covers per service.',
    effects: {
      restaurantCapacityMultiplier: 1.25,  // +25 % capacity
    },
  },

  'menu-quality': {
    id: 'menu-quality',
    name: 'Premium Menu Upgrade',
    category: 'dining',
    cost: 300_000,
    buildTimeDays: 3,
    prerequisites: [],
    description: 'Locally-sourced ingredients and a revamped menu push average spend higher.',
    effects: {
      avgSpendPerGuestBonus: 0.10,    // +10 % avg spend
    },
  },

  'outdoor-seating': {
    id: 'outdoor-seating',
    name: 'Outdoor Patio Seating',
    category: 'dining',
    cost: 200_000,
    buildTimeDays: 7,
    prerequisites: [],
    description: 'Sunny deck seating increases capacity and draws guests during clear-sky days.',
    effects: {
      restaurantCapacityMultiplier: 1.15,  // +15 % capacity
      summerRevenueBonus: 0.15,            // extra +15 % in summer
    },
  },

  // ----------------------------- HOTELS ----------------------------------

  'renovation': {
    id: 'renovation',
    name: 'Hotel Renovation',
    category: 'hotels',
    cost: 5_000_000,
    buildTimeDays: 60,
    prerequisites: [],
    description: 'Full refurbishment of rooms, lobbies, and common areas — earns a higher star rating.',
    effects: {
      hotelStarRatingBonus: 1,        // +1 star
      pricePerNightMultiplier: 1.20,  // +20 % nightly rate
    },
  },

  'spa-addition': {
    id: 'spa-addition',
    name: 'Spa & Wellness Centre',
    category: 'hotels',
    cost: 3_000_000,
    buildTimeDays: 45,
    prerequisites: [],
    description: 'Full-service spa with hot tubs, massage suites, and a sauna — guests extend their stays.',
    effects: {
      hotelOccupancyBonus: 0.15,      // +15 % occupancy
    },
  },

  'conference-rooms': {
    id: 'conference-rooms',
    name: 'Conference & Events Centre',
    category: 'hotels',
    cost: 2_000_000,
    buildTimeDays: 30,
    prerequisites: [],
    description: 'Dedicated boardrooms and a ballroom unlock lucrative corporate retreat bookings.',
    effects: {
      corporateEventsEnabled: true,
    },
  },

  // --------------------------- TECHNOLOGY --------------------------------

  'rfid-passes': {
    id: 'rfid-passes',
    name: 'RFID Lift Passes',
    category: 'technology',
    cost: 1_000_000,
    buildTimeDays: 14,
    prerequisites: [],
    description: 'Contactless gate readers eliminate manual ticket checks and slash queue times.',
    effects: {
      liftQueueTimeMultiplier: 0.80,  // -20 % queue time
    },
  },

  'mobile-app': {
    id: 'mobile-app',
    name: 'Skiville Mobile App',
    category: 'technology',
    cost: 500_000,
    buildTimeDays: 21,
    prerequisites: [],
    description: 'App for trail maps, lift status, and mobile food ordering — improves satisfaction and dining revenue.',
    effects: {
      guestSatisfactionBonus: 5,      // +5 % satisfaction
      foodRevenueMultiplier: 1.10,    // +10 % food revenue (mobile ordering)
    },
  },

  'free-wifi': {
    id: 'free-wifi',
    name: 'Resort-Wide Free Wi-Fi',
    category: 'technology',
    cost: 300_000,
    buildTimeDays: 7,
    prerequisites: [],
    description: 'High-speed wireless access across lodges, restaurants, and the base area.',
    effects: {
      guestSatisfactionBonus: 5,      // +5 % satisfaction
    },
  },

  'dynamic-pricing-ai': {
    id: 'dynamic-pricing-ai',
    name: 'Dynamic Pricing AI',
    category: 'technology',
    cost: 2_000_000,
    buildTimeDays: 30,
    prerequisites: [],
    description: 'Machine-learning engine adjusts ticket and hotel prices in real time based on demand signals.',
    effects: {
      revenueOptimizationMultiplier: 1.15,  // +15 % revenue optimisation
    },
  },

  'automated-snowmaking': {
    id: 'automated-snowmaking',
    name: 'Automated Snowmaking System',
    category: 'technology',
    cost: 4_000_000,
    buildTimeDays: 45,
    prerequisites: [],
    description: 'Sensor-driven guns and automated hydrants require minimal operator oversight.',
    effects: {
      snowmakingStaffCostMultiplier: 0.50,  // -50 % snowmaking staff cost
    },
  },

  // ----------------------------- TERRAIN ---------------------------------

  'new-zone': {
    id: 'new-zone',
    name: 'New Ski Zone',
    category: 'terrain',
    cost: 15_000_000,
    buildTimeDays: 180,
    prerequisites: [],
    description: 'Opens a previously untouched back-bowl — adds 500 skiable acres and five new runs.',
    effects: {
      skiableAcresBonus: 500,
      newRunsBonus: 5,
    },
  },

  'terrain-park-l1': {
    id: 'terrain-park-l1',
    name: 'Terrain Park (Beginner)',
    category: 'terrain',
    cost: 1_000_000,
    buildTimeDays: 14,
    prerequisites: [],
    description: 'Entry-level jumps, boxes, and rails introduce freestyle skiing to beginners.',
    effects: {
      teenSatisfactionBonus: 10,      // +10 % teen satisfaction
    },
  },

  'terrain-park-l2': {
    id: 'terrain-park-l2',
    name: 'Terrain Park (Intermediate)',
    category: 'terrain',
    cost: 2_000_000,
    buildTimeDays: 21,
    prerequisites: ['terrain-park-l1'],
    description: 'Larger features and a dedicated pipe attract intermediate freestyle riders.',
    effects: {
      teenSatisfactionBonus: 20,      // +20 % teen satisfaction (replaces l1 bonus)
    },
  },

  'terrain-park-l3': {
    id: 'terrain-park-l3',
    name: 'Terrain Park (Pro / Competition)',
    category: 'terrain',
    cost: 3_000_000,
    buildTimeDays: 30,
    prerequisites: ['terrain-park-l2'],
    description: 'Competition-grade superpipe and slopestyle course capable of hosting sanctioned events.',
    effects: {
      teenSatisfactionBonus: 30,      // +30 % teen satisfaction (replaces l2 bonus)
      competitionsEnabled: true,
    },
  },

  'night-skiing': {
    id: 'night-skiing',
    name: 'Night Skiing Lighting',
    category: 'terrain',
    cost: 7_000_000,
    buildTimeDays: 60,
    prerequisites: [],
    description: 'LED floodlights on key runs extend resort operations until 9 pm, opening an evening revenue window.',
    effects: {
      operatingHoursExtension: '21:00',  // closes 9 pm instead of 4:30 pm
      revenueMultiplier: 1.25,           // +25 % revenue during extended hours
    },
  },
};

// ---------------------------------------------------------------------------
// Category metadata (drives UI tab order / labels)
// ---------------------------------------------------------------------------

export const UPGRADE_CATEGORIES = [
  { id: 'lifts',      label: 'Lifts',      icon: '🚡' },
  { id: 'dining',     label: 'Dining',     icon: '🍽️' },
  { id: 'hotels',     label: 'Hotels',     icon: '🏨' },
  { id: 'technology', label: 'Technology', icon: '💻' },
  { id: 'terrain',    label: 'Terrain',    icon: '🏔️' },
];

// ---------------------------------------------------------------------------
// UpgradeSystem class
// ---------------------------------------------------------------------------

export class UpgradeSystem {

  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();

    /** @type {Set<string>} IDs of fully-applied upgrades */
    this._applied = new Set();

    /**
     * In-progress upgrades.
     * @type {Map<string, { upgrade: object, elapsedDays: number, totalDays: number }>}
     */
    this._active = new Map();
  }

  // -------------------------------------------------------------------------
  // Event emitter
  // -------------------------------------------------------------------------

  /**
   * Register a listener for the given event name.
   * @param {string} event
   * @param {Function} fn
   */
  on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('Listener must be a function');
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;  // allow chaining
  }

  /**
   * Remove a previously registered listener.
   * @param {string} event
   * @param {Function} fn
   */
  off(event, fn) {
    if (!this._listeners.has(event)) return this;
    const updated = this._listeners.get(event).filter(f => f !== fn);
    this._listeners.set(event, updated);
    return this;
  }

  /**
   * Fire an event, calling all registered listeners.
   * @param {string} event
   * @param {*} payload
   */
  emit(event, payload) {
    const fns = this._listeners.get(event);
    if (!fns || fns.length === 0) return;
    for (const fn of fns) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[UpgradeSystem] Listener error on "${event}":`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Catalog helpers
  // -------------------------------------------------------------------------

  /**
   * Returns the full catalog as a read-only object.
   * @returns {Object.<string, object>}
   */
  getCatalog() {
    return UPGRADE_CATALOG;
  }

  /**
   * Returns the upgrade definition for a given ID, or null if unknown.
   * @param {string} id
   * @returns {object|null}
   */
  getUpgradeById(id) {
    return UPGRADE_CATALOG[id] ?? null;
  }

  // -------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------

  /**
   * Returns true if the upgrade with the given ID has been fully applied.
   * @param {string} id
   * @returns {boolean}
   */
  isUpgradeApplied(id) {
    return this._applied.has(id);
  }

  /**
   * Returns the Set of applied upgrade IDs (read-only copy).
   * @returns {Set<string>}
   */
  getAppliedUpgrades() {
    return new Set(this._applied);
  }

  /**
   * Returns all upgrades currently being built, each enriched with
   * a `progressPct` property (0–100).
   *
   * @returns {Array<{ upgrade: object, elapsedDays: number, totalDays: number, progressPct: number }>}
   */
  getActiveUpgrades() {
    return Array.from(this._active.values()).map(entry => ({
      ...entry,
      progressPct: Math.min(100, Math.round((entry.elapsedDays / entry.totalDays) * 100)),
    }));
  }

  /**
   * Returns all upgrades whose prerequisites have been met and which have
   * not yet been started or applied.
   *
   * @param {object} gameState
   * @returns {object[]} Array of upgrade definitions
   */
  getAvailableUpgrades(gameState) {
    return Object.values(UPGRADE_CATALOG).filter(upgrade => {
      // Already applied or in progress — skip
      if (this._applied.has(upgrade.id)) return false;
      if (this._active.has(upgrade.id)) return false;

      // Check prerequisite upgrades
      if (!this._prerequisitesMet(upgrade)) return false;

      // Check structural prerequisite (e.g. a lift must exist)
      if (upgrade.requiresExisting === 'lift') {
        const lifts = gameState?.buildings?.lifts ?? [];
        if (lifts.length === 0) return false;
      }

      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Upgrade lifecycle
  // -------------------------------------------------------------------------

  /**
   * Attempts to start an upgrade.  Validates funds and prerequisites, deducts
   * the cost from gameState.money, and begins the build timer.
   *
   * Emits 'upgradeStarted' on success or 'upgradeFailed' on any error.
   *
   * @param {string} upgradeId
   * @param {object} gameState  - Must expose a mutable `money` property
   * @returns {{ success: boolean, reason?: string }}
   */
  startUpgrade(upgradeId, gameState) {
    const upgrade = UPGRADE_CATALOG[upgradeId];

    // --- Validation ---
    if (!upgrade) {
      const reason = `Unknown upgrade: "${upgradeId}"`;
      this.emit('upgradeFailed', { upgradeId, reason });
      return { success: false, reason };
    }

    if (this._applied.has(upgradeId)) {
      const reason = `Upgrade "${upgradeId}" has already been applied.`;
      this.emit('upgradeFailed', { upgradeId, reason });
      return { success: false, reason };
    }

    if (this._active.has(upgradeId)) {
      const reason = `Upgrade "${upgradeId}" is already in progress.`;
      this.emit('upgradeFailed', { upgradeId, reason });
      return { success: false, reason };
    }

    if (!this._prerequisitesMet(upgrade)) {
      const missing = upgrade.prerequisites
        .filter(pid => !this._applied.has(pid))
        .map(pid => UPGRADE_CATALOG[pid]?.name ?? pid)
        .join(', ');
      const reason = `Prerequisites not met: ${missing}`;
      this.emit('upgradeFailed', { upgradeId, reason });
      return { success: false, reason };
    }

    if (upgrade.requiresExisting === 'lift') {
      const lifts = gameState?.buildings?.lifts ?? [];
      if (lifts.length === 0) {
        const reason = 'You must have at least one lift before applying this upgrade.';
        this.emit('upgradeFailed', { upgradeId, reason });
        return { success: false, reason };
      }
    }

    const money = gameState?.money ?? 0;
    if (money < upgrade.cost) {
      const reason = `Insufficient funds — need $${upgrade.cost.toLocaleString()}, have $${money.toLocaleString()}.`;
      this.emit('upgradeFailed', { upgradeId, reason });
      return { success: false, reason };
    }

    // --- Deduct cost and start timer ---
    gameState.money -= upgrade.cost;

    this._active.set(upgradeId, {
      upgrade,
      elapsedDays: 0,
      totalDays: upgrade.buildTimeDays,
    });

    this.emit('upgradeStarted', { upgradeId, upgrade, gameState });
    return { success: true };
  }

  /**
   * Advances all active upgrade timers by `dt` game-days.
   * Completes any upgrades whose timer has reached zero and applies their
   * effects to gameState.
   *
   * Should be called once per game tick from GameEngine.
   *
   * @param {number} dt  - Elapsed game-days since last call (fractional OK)
   * @param {object} [gameState] - Optional: used to apply numeric effects
   */
  update(dt, gameState) {
    if (this._active.size === 0) return;

    const completed = [];

    for (const [id, entry] of this._active) {
      entry.elapsedDays += dt;

      if (entry.elapsedDays >= entry.totalDays) {
        completed.push(id);
      }
    }

    for (const id of completed) {
      const entry = this._active.get(id);
      this._active.delete(id);
      this._applied.add(id);

      if (gameState) {
        this._applyEffects(entry.upgrade, gameState);
      }

      this.emit('upgradeComplete', {
        upgradeId: id,
        upgrade: entry.upgrade,
        effects: entry.upgrade.effects,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Effect application
  // -------------------------------------------------------------------------

  /**
   * Applies the numeric/boolean effects of an upgrade directly to gameState's
   * modifier layer.  The exact property names mirror what EconomySystem and
   * GuestSystem read when they compute derived values.
   *
   * @param {object} upgrade
   * @param {object} gameState
   */
  _applyEffects(upgrade, gameState) {
    // Ensure the modifiers container exists
    if (!gameState.upgradeModifiers) gameState.upgradeModifiers = {};
    const mods = gameState.upgradeModifiers;

    for (const [key, value] of Object.entries(upgrade.effects)) {
      if (typeof value === 'boolean') {
        // Boolean flags just get set (OR'd so multiple upgrades can set them)
        mods[key] = mods[key] || value;
      } else if (typeof value === 'number') {
        // Multiplicative keys (end with 'Multiplier') are multiplied together
        if (key.endsWith('Multiplier')) {
          mods[key] = (mods[key] ?? 1.0) * value;
        } else if (key.endsWith('Bonus')) {
          // Additive bonuses accumulate
          mods[key] = (mods[key] ?? 0) + value;
        } else {
          // Anything else: last-write wins (e.g. star rating absolute)
          mods[key] = (mods[key] ?? 0) + value;
        }
      } else {
        // String / other — just store as-is
        mods[key] = value;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Returns true if every prerequisite upgrade has been fully applied.
   * @param {object} upgrade
   * @returns {boolean}
   */
  _prerequisitesMet(upgrade) {
    return (upgrade.prerequisites ?? []).every(pid => this._applied.has(pid));
  }

  // -------------------------------------------------------------------------
  // Serialisation (save / load)
  // -------------------------------------------------------------------------

  /**
   * Returns a plain-object snapshot suitable for JSON serialisation.
   * @returns {object}
   */
  serialize() {
    return {
      applied: Array.from(this._applied),
      active: Array.from(this._active.entries()).map(([id, entry]) => ({
        id,
        elapsedDays: entry.elapsedDays,
        totalDays: entry.totalDays,
      })),
    };
  }

  /**
   * Restores state from a previously serialised snapshot.
   * @param {object} data
   */
  deserialize(data) {
    this._applied = new Set(data.applied ?? []);
    this._active = new Map();

    for (const entry of (data.active ?? [])) {
      const upgrade = UPGRADE_CATALOG[entry.id];
      if (!upgrade) continue;
      this._active.set(entry.id, {
        upgrade,
        elapsedDays: entry.elapsedDays,
        totalDays: entry.totalDays,
      });
    }
  }
}
