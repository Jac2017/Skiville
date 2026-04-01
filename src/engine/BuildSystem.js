/**
 * BuildSystem.js
 * Manages the build mode system for Skiville ski resort tycoon game.
 * Handles the building catalog, construction queues, and build mode state.
 */

'use strict';

// ---------------------------------------------------------------------------
// Building catalog definition
// ---------------------------------------------------------------------------

const BUILDING_CATALOG = {
  hotels: {
    label: 'Hotels',
    category: 'hotels',
    items: {
      'hotel-luxury': {
        type: 'hotel-luxury',
        category: 'hotels',
        name: 'Luxury Hotel',
        cost: 45_000_000,
        buildTimeDays: 180,
        dailyRevenue: 28_000,
        description: 'Five-star resort hotel with spa and premium amenities.',
        capacity: 200,
      },
      'hotel-mid-range': {
        type: 'hotel-mid-range',
        category: 'hotels',
        name: 'Mid-Range Hotel',
        cost: 15_000_000,
        buildTimeDays: 120,
        dailyRevenue: 9_000,
        description: 'Comfortable three-star hotel catering to families and groups.',
        capacity: 120,
      },
      'hotel-budget': {
        type: 'hotel-budget',
        category: 'hotels',
        name: 'Budget Hotel',
        cost: 5_000_000,
        buildTimeDays: 60,
        dailyRevenue: 2_800,
        description: 'Affordable lodging for budget-conscious skiers.',
        capacity: 80,
      },
    },
  },

  restaurants: {
    label: 'Restaurants',
    category: 'restaurants',
    items: {
      'restaurant-fine-dining': {
        type: 'restaurant-fine-dining',
        category: 'restaurants',
        name: 'Fine Dining Restaurant',
        cost: 3_000_000,
        buildTimeDays: 45,
        dailyRevenue: 4_500,
        description: 'Upscale alpine cuisine with panoramic mountain views.',
        capacity: 60,
      },
      'restaurant-casual': {
        type: 'restaurant-casual',
        category: 'restaurants',
        name: 'Casual Restaurant',
        cost: 1_500_000,
        buildTimeDays: 30,
        dailyRevenue: 1_800,
        description: 'Family-friendly dining with a varied menu.',
        capacity: 100,
      },
      'restaurant-on-mountain': {
        type: 'restaurant-on-mountain',
        category: 'restaurants',
        name: 'On-Mountain Restaurant',
        cost: 2_000_000,
        buildTimeDays: 40,
        dailyRevenue: 2_400,
        description: 'Mid-mountain refueling stop with hot food and drinks.',
        capacity: 80,
      },
      'restaurant-fast-food': {
        type: 'restaurant-fast-food',
        category: 'restaurants',
        name: 'Fast Food Outlet',
        cost: 800_000,
        buildTimeDays: 20,
        dailyRevenue: 900,
        description: 'Quick-service counter for burgers, hot dogs, and snacks.',
        capacity: 150,
      },
    },
  },

  bars: {
    label: 'Bars',
    category: 'bars',
    items: {
      'bar-apres-ski': {
        type: 'bar-apres-ski',
        category: 'bars',
        name: 'Après-Ski Bar',
        cost: 1_200_000,
        buildTimeDays: 30,
        dailyRevenue: 1_600,
        description: 'Classic après-ski hangout with live music and cocktails.',
        capacity: 120,
      },
      'bar-nightclub': {
        type: 'bar-nightclub',
        category: 'bars',
        name: 'Nightclub',
        cost: 2_000_000,
        buildTimeDays: 40,
        dailyRevenue: 2_800,
        description: 'High-energy nightclub keeping the party going after dark.',
        capacity: 200,
      },
      'bar-pub': {
        type: 'bar-pub',
        category: 'bars',
        name: 'Mountain Pub',
        cost: 800_000,
        buildTimeDays: 25,
        dailyRevenue: 900,
        description: 'Cosy pub with local craft beers and a welcoming atmosphere.',
        capacity: 80,
      },
    },
  },

  shops: {
    label: 'Shops',
    category: 'shops',
    items: {
      'shop-retail': {
        type: 'shop-retail',
        category: 'shops',
        name: 'Retail Shop',
        cost: 600_000,
        buildTimeDays: 20,
        dailyRevenue: 700,
        description: 'General resort merchandise, clothing, and souvenirs.',
        capacity: 50,
      },
      'shop-rental': {
        type: 'shop-rental',
        category: 'shops',
        name: 'Rental Shop',
        cost: 1_000_000,
        buildTimeDays: 25,
        dailyRevenue: 1_200,
        description: 'Ski and snowboard equipment rental for all skill levels.',
        capacity: 60,
      },
      'shop-gear': {
        type: 'shop-gear',
        category: 'shops',
        name: 'Gear Shop',
        cost: 500_000,
        buildTimeDays: 15,
        dailyRevenue: 550,
        description: 'Specialist ski and snowboard gear sales.',
        capacity: 40,
      },
    },
  },

  condos: {
    label: 'Condos',
    category: 'condos',
    items: {
      'condo-luxury': {
        type: 'condo-luxury',
        category: 'condos',
        name: 'Luxury Condominiums',
        cost: 25_000_000,
        buildTimeDays: 240,
        dailyRevenue: 18_000,
        description: 'Ski-in/ski-out luxury condo complex with concierge services.',
        capacity: 80,
      },
      'condo-standard': {
        type: 'condo-standard',
        category: 'condos',
        name: 'Standard Condominiums',
        cost: 10_000_000,
        buildTimeDays: 150,
        dailyRevenue: 6_500,
        description: 'Well-appointed condos offering great value for groups.',
        capacity: 120,
      },
    },
  },

  parking: {
    label: 'Parking',
    category: 'parking',
    items: {
      'parking-surface': {
        type: 'parking-surface',
        category: 'parking',
        name: 'Surface Parking Lot',
        cost: 2_000_000,
        buildTimeDays: 30,
        dailyRevenue: 1_400,
        description: 'Open-air parking lot with 400 spaces.',
        capacity: 400,
      },
      'parking-multi-level': {
        type: 'parking-multi-level',
        category: 'parking',
        name: 'Multi-Level Parking Structure',
        cost: 8_000_000,
        buildTimeDays: 90,
        dailyRevenue: 4_800,
        description: 'Covered multi-storey garage with 1,200 spaces.',
        capacity: 1200,
      },
    },
  },

  'terrain-park': {
    label: 'Terrain Park',
    category: 'terrain-park',
    items: {
      'terrain-park-basic': {
        type: 'terrain-park-basic',
        category: 'terrain-park',
        name: 'Basic Terrain Park',
        cost: 1_000_000,
        buildTimeDays: 20,
        dailyRevenue: 800,
        description: 'Entry-level park with jumps, rails, and boxes.',
        capacity: 100,
      },
      'terrain-park-competition': {
        type: 'terrain-park-competition',
        category: 'terrain-park',
        name: 'Competition Terrain Park',
        cost: 3_000_000,
        buildTimeDays: 45,
        dailyRevenue: 2_200,
        description: 'Pro-grade park suitable for hosting competitions.',
        capacity: 200,
      },
    },
  },

  lifts: {
    label: 'Lifts',
    category: 'lifts',
    items: {
      'lift-t-bar': {
        type: 'lift-t-bar',
        category: 'lifts',
        name: 'T-Bar Lift',
        cost: 2_000_000,
        buildTimeDays: 60,
        dailyRevenue: 1_200,
        description: 'Simple surface lift ideal for beginner slopes.',
        capacity: 600,
      },
      'lift-quad': {
        type: 'lift-quad',
        category: 'lifts',
        name: 'Quad Chairlift',
        cost: 8_000_000,
        buildTimeDays: 120,
        dailyRevenue: 4_000,
        description: 'Fixed-grip four-person chairlift for intermediate terrain.',
        capacity: 1800,
      },
      'lift-express-quad': {
        type: 'lift-express-quad',
        category: 'lifts',
        name: 'Express Quad Chairlift',
        cost: 12_000_000,
        buildTimeDays: 150,
        dailyRevenue: 6_500,
        description: 'High-speed detachable quad with heated seats.',
        capacity: 2400,
      },
      'lift-gondola': {
        type: 'lift-gondola',
        category: 'lifts',
        name: 'Gondola',
        cost: 25_000_000,
        buildTimeDays: 240,
        dailyRevenue: 14_000,
        description: 'Enclosed gondola cabin providing all-weather access to the summit.',
        capacity: 1200,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// BuildSystem class
// ---------------------------------------------------------------------------

let _nextId = 1;

export class BuildSystem {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._listeners = new Map();

    /** @type {Map<string, object>} Active construction entries keyed by id */
    this._activeConstructions = new Map();

    /** @type {string|null} Currently active build-mode category */
    this._activeBuildMode = null;
  }

  // -------------------------------------------------------------------------
  // Event emitter
  // -------------------------------------------------------------------------

  /**
   * Subscribe to a named event.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('BuildSystem.on: handler must be a function');
    }
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(handler);
    return this; // allow chaining
  }

  /**
   * Unsubscribe from a named event.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    if (!this._listeners.has(event)) return this;
    const updated = this._listeners.get(event).filter(fn => fn !== handler);
    this._listeners.set(event, updated);
    return this;
  }

  /**
   * Emit a named event with an optional payload.
   * @param {string} event
   * @param {*} data
   */
  emit(event, data) {
    if (!this._listeners.has(event)) return;
    for (const handler of this._listeners.get(event)) {
      try {
        handler(data);
      } catch (err) {
        console.error(`BuildSystem: error in handler for "${event}"`, err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------

  /**
   * Returns the full building catalog grouped by category.
   * @returns {object}
   */
  getCatalog() {
    return BUILDING_CATALOG;
  }

  /**
   * Looks up a single catalog entry by item type string.
   * @param {string} itemType
   * @returns {object|null}
   */
  _getCatalogEntry(itemType) {
    for (const category of Object.values(BUILDING_CATALOG)) {
      if (category.items[itemType]) {
        return category.items[itemType];
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Affordability
  // -------------------------------------------------------------------------

  /**
   * Returns true if the player has enough money to build the given item.
   * @param {string} itemType
   * @param {number} money - Current player balance in dollars
   * @returns {boolean}
   */
  canAfford(itemType, money) {
    const entry = this._getCatalogEntry(itemType);
    if (!entry) return false;
    return money >= entry.cost;
  }

  // -------------------------------------------------------------------------
  // Construction management
  // -------------------------------------------------------------------------

  /**
   * Starts construction of a building.
   *
   * @param {string} itemType - Catalog type key e.g. 'hotel-luxury'
   * @param {{ lat: number, lng: number }} position - Map position for the build
   * @param {object} gameState - Mutable game state; must expose `money` (number)
   *                             and a `deductMoney(amount)` method or writable
   *                             `money` property.
   * @returns {{ success: boolean, message: string, construction?: object }}
   */
  startConstruction(itemType, position, gameState) {
    const entry = this._getCatalogEntry(itemType);

    if (!entry) {
      return { success: false, message: `Unknown building type: "${itemType}"` };
    }

    if (!this.canAfford(itemType, gameState.money)) {
      return {
        success: false,
        message: `Insufficient funds. ${entry.name} costs $${(entry.cost / 1_000_000).toFixed(1)}M but you only have $${(gameState.money / 1_000_000).toFixed(1)}M.`,
      };
    }

    if (!position || typeof position.lat !== 'number' || typeof position.lng !== 'number') {
      return { success: false, message: 'Invalid position: must be an object with lat and lng.' };
    }

    // Deduct cost from game state
    if (typeof gameState.deductMoney === 'function') {
      gameState.deductMoney(entry.cost);
    } else {
      gameState.money -= entry.cost;
    }

    const id = String(_nextId++);
    const construction = {
      id,
      type: entry.type,
      category: entry.category,
      name: entry.name,
      position: { lat: position.lat, lng: position.lng },
      cost: entry.cost,
      buildTimeDays: entry.buildTimeDays,
      daysRemaining: entry.buildTimeDays,
      progress: 0,
      dailyRevenue: entry.dailyRevenue,
      capacity: entry.capacity,
      description: entry.description,
      startedAt: Date.now(),
    };

    this._activeConstructions.set(id, construction);

    this.emit('constructionStarted', { ...construction });

    return { success: true, message: `Construction of ${entry.name} started.`, construction };
  }

  /**
   * Advances all active construction timers by the given delta (in game days).
   * Completes any construction whose timer reaches zero.
   *
   * @param {number} dt - Game days elapsed since last update
   */
  updateConstruction(dt) {
    if (!dt || dt <= 0) return;

    for (const [id, construction] of this._activeConstructions) {
      construction.daysRemaining = Math.max(0, construction.daysRemaining - dt);
      construction.progress = parseFloat(
        (((construction.buildTimeDays - construction.daysRemaining) / construction.buildTimeDays) * 100).toFixed(1)
      );

      if (construction.daysRemaining <= 0) {
        construction.progress = 100;
        this._activeConstructions.delete(id);
        this.emit('constructionComplete', { ...construction });
      }
    }
  }

  /**
   * Returns a snapshot array of all in-progress constructions with a progress
   * percentage rounded to one decimal place.
   *
   * @returns {Array<object>}
   */
  getActiveConstructions() {
    return Array.from(this._activeConstructions.values()).map(c => ({ ...c }));
  }

  /**
   * Cancels an active construction by id and issues a 50% refund.
   *
   * @param {string} id - Construction id to cancel
   * @param {object} gameState - Mutable game state for refund
   * @returns {{ success: boolean, message: string, refund?: number }}
   */
  cancelConstruction(id, gameState) {
    const construction = this._activeConstructions.get(id);
    if (!construction) {
      return { success: false, message: `No active construction with id "${id}".` };
    }

    const refund = Math.floor(construction.cost * 0.5);
    this._activeConstructions.delete(id);

    if (typeof gameState.addMoney === 'function') {
      gameState.addMoney(refund);
    } else {
      gameState.money += refund;
    }

    this.emit('constructionCancelled', { construction: { ...construction }, refund });

    return {
      success: true,
      message: `Construction of ${construction.name} cancelled. $${(refund / 1_000_000).toFixed(2)}M refunded.`,
      refund,
    };
  }

  // -------------------------------------------------------------------------
  // Build mode state
  // -------------------------------------------------------------------------

  /**
   * Activates build mode for the given category.
   * @param {string} category - Category key from the catalog
   */
  setBuildMode(category) {
    if (!BUILDING_CATALOG[category]) {
      console.warn(`BuildSystem.setBuildMode: unknown category "${category}"`);
    }
    this._activeBuildMode = category;
    this.emit('buildModeChanged', { mode: category });
  }

  /**
   * Exits build mode.
   */
  cancelBuildMode() {
    this._activeBuildMode = null;
    this.emit('buildModeChanged', { mode: null });
  }

  /**
   * Returns the currently active build-mode category, or null.
   * @returns {string|null}
   */
  getActiveBuildMode() {
    return this._activeBuildMode;
  }
}
