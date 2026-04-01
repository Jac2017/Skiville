/**
 * EventSystem - Random events, seasonal challenges, and yearly goals for Skiville.
 *
 * Random events are checked once per simulated game-hour via accumulated time.
 * Each event has weighted probability, duration, financial effects, and optional
 * player choices. Seasonal challenges and yearly goals track progress against
 * milestone targets and pay out rewards when completed.
 */

// ---------------------------------------------------------------------------
// Event definitions
// ---------------------------------------------------------------------------

const RANDOM_EVENTS = {
  'equipment-failure': {
    type:        'equipment-failure',
    title:       'Lift Breakdown',
    description: 'A ski lift has suffered a mechanical failure and is out of service.',
    baseProbability: 0.04,   // per-hour base chance
    minDurationHours: 2,
    maxDurationHours: 8,
    minCost:     10_000,
    maxCost:     50_000,
    severity:    'warning',
    choices: [
      { id: 'emergency-repair', label: 'Emergency Repair (2x cost, half time)', costMultiplier: 2.0, timeMultiplier: 0.5 },
      { id: 'standard-repair',  label: 'Standard Repair',                       costMultiplier: 1.0, timeMultiplier: 1.0 },
    ],
  },
  'storm-damage': {
    type:        'storm-damage',
    title:       'Storm Damage',
    description: 'High winds and heavy snow have caused structural damage to resort buildings.',
    baseProbability: 0.02,
    minDurationHours: 4,
    maxDurationHours: 12,
    minCost:     20_000,
    maxCost:     100_000,
    severity:    'danger',
    choices: null,
  },
  'accident': {
    type:        'accident',
    title:       'Guest Injury',
    description: 'A guest has been injured on the slopes. Ski patrol is responding.',
    baseProbability: 0.03,
    minDurationHours: 1,
    maxDurationHours: 2,
    minCost:     5_000,
    maxCost:     30_000,
    reputationHit: -0.1,
    severity:    'danger',
    choices: [
      { id: 'settle',    label: 'Settle Privately (+$10K, no press)',  costMultiplier: 1.33, reputationMult: 0.5 },
      { id: 'cooperate', label: 'Full Cooperation with Authorities',   costMultiplier: 1.0,  reputationMult: 1.0 },
    ],
  },
  'power-outage': {
    type:        'power-outage',
    title:       'Power Outage',
    description: 'A power failure has shut down all ski lifts. Backup generators are limited.',
    baseProbability: 0.025,
    minDurationHours: 1,
    maxDurationHours: 3,
    flatCost:    15_000,
    severity:    'warning',
    choices: null,
  },
  'vip-visit': {
    type:        'vip-visit',
    title:       'VIP Celebrity Visit',
    description: 'A famous celebrity has arrived incognito! Word is spreading fast on social media.',
    baseProbability: 0.012,
    minDurationHours: 72,    // 3 days
    maxDurationHours: 72,
    flatCost:    0,
    reputationBoost: 0.2,
    guestBoostPct:   0.20,   // +20% guests for duration
    severity:    'success',
    choices: [
      { id: 'vip-treatment', label: 'Roll Out VIP Treatment ($5K, +extra 10% guests)',    extraCost: 5_000, extraGuestBoost: 0.10 },
      { id: 'respect-privacy', label: 'Respect Privacy (no extra cost)',                 extraCost: 0,     extraGuestBoost: 0    },
    ],
  },
  'powder-day': {
    type:        'powder-day',
    title:       'Powder Day!',
    description: 'Fresh deep powder has fallen overnight! Conditions are absolutely epic.',
    baseProbability: 0,       // triggered by snow accumulation, not random roll
    minDurationHours: 24,
    maxDurationHours: 24,
    flatCost:    0,
    guestBoostPct: 0.50,     // +50% guests
    severity:    'success',
    choices: null,
  },
  'water-main-break': {
    type:        'water-main-break',
    title:       'Water Main Break',
    description: 'A burst pipe is disrupting village services. Restaurants are operating at half capacity.',
    baseProbability: 0.015,
    minDurationHours: 12,
    maxDurationHours: 24,
    flatCost:    30_000,
    restaurantCapacity: 0.5,
    severity:    'warning',
    choices: null,
  },
  'record-crowd': {
    type:        'record-crowd',
    title:       'Record Crowd Day',
    description: 'An unexpectedly massive crowd has arrived today. The resort is over capacity!',
    baseProbability: 0.02,
    minDurationHours: 12,
    maxDurationHours: 12,
    flatCost:    0,
    guestBoostPct: 0.80,    // +80% guests
    satisfactionRisk: true, // satisfaction drops if under-capacity
    severity:    'info',
    choices: null,
  },
};

// ---------------------------------------------------------------------------
// Seasonal challenges (keyed by their challenge id)
// ---------------------------------------------------------------------------

const SEASONAL_CHALLENGES = {
  'early-season': {
    id:          'early-season',
    title:       'Early Season Opener',
    description: 'Open 10 or more lifts by December 15th.',
    reward:      200_000,
    season:      'early-winter',
  },
  'holiday-rush': {
    id:          'holiday-rush',
    title:       'Holiday Rush',
    description: 'Maintain 80% or higher guest satisfaction from Dec 20 through Jan 5.',
    reward:      500_000,
    season:      'early-winter',
  },
  'peak-performance': {
    id:          'peak-performance',
    title:       'Peak Performance',
    description: 'Reach $2M daily revenue at any point in February.',
    reward:      1_000_000,
    season:      'peak-winter',
  },
  'spring-survival': {
    id:          'spring-survival',
    title:       'Spring Survival',
    description: 'Stay profitable (positive daily revenue) throughout all of April.',
    reward:      300_000,
    season:      'spring',
  },
};

// ---------------------------------------------------------------------------
// Yearly goals
// ---------------------------------------------------------------------------

const YEARLY_GOALS = {
  'guest-milestone': {
    id:          'guest-milestone',
    title:       'Guest Milestone',
    description: 'Host 500,000 total guests this season.',
    target:      500_000,
    reward:      750_000,
  },
  'rating-target': {
    id:          'rating-target',
    title:       'Top Rated Resort',
    description: 'Achieve a resort rating of 4.5 stars or higher.',
    target:      4.5,
    reward:      500_000,
  },
  'revenue-target': {
    id:          'revenue-target',
    title:       'Revenue Record',
    description: 'Hit $100M in total seasonal revenue.',
    target:      100_000_000,
    reward:      2_000_000,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextEventId = 1;

function _uid() {
  return `evt-${_nextEventId++}`;
}

function _rand(min, max) {
  return min + Math.random() * (max - min);
}

function _randInt(min, max) {
  return Math.floor(_rand(min, max + 1));
}

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// EventSystem class
// ---------------------------------------------------------------------------

export class EventSystem {
  constructor() {
    // Pub/sub listeners
    this._listeners = {};

    // Active events currently affecting the resort
    this._activeEvents = [];

    // Completed event history (capped at 20)
    this._eventHistory = [];

    // Seasonal challenge state: { [id]: { ...challenge, progress, completed, failed } }
    this._challenges = {};

    // Yearly goal state: { [id]: { ...goal, progress, completed } }
    this._yearlyGoals = {};

    // Accumulates game-minutes to fire once-per-game-hour checks
    this._hourAccum = 0;

    // Track last snow depth seen to detect powder-day trigger
    this._lastSnowDepthCm = 0;

    // Track which season's challenges are loaded
    this._loadedSeason = null;

    // Track holiday-rush satisfaction across its window (running min)
    this._holidayRushMinSatisfaction = 100;
    this._holidayRushActive = false;

    // Track April daily profitability for spring-survival
    this._springDaysChecked = new Set();
    this._springFailedDays  = 0;

    // Initialise yearly goals
    for (const [id, def] of Object.entries(YEARLY_GOALS)) {
      this._yearlyGoals[id] = { ...def, progress: 0, completed: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Pub / Sub
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
  // Main update — called from GameEngine each tick
  // ---------------------------------------------------------------------------

  /**
   * Advance event system by dt game-minutes.
   * @param {object} gameState - canonical game state
   * @param {number} dt        - game-minutes elapsed this tick
   */
  update(gameState, dt) {
    if (dt <= 0) return;

    // Age active events and expire finished ones
    this._tickActiveEvents(gameState, dt);

    // Once-per-game-hour random event rolls
    this._hourAccum += dt;
    if (this._hourAccum >= 60) {
      this._hourAccum -= 60;
      this._rollRandomEvents(gameState);
      this._checkPowderDay(gameState);
    }

    // Seasonal challenge bootstrapping
    this._ensureChallengesForSeason(gameState);

    // Challenge progress checks
    this._updateChallengeProgress(gameState);

    // Yearly goal progress
    this._updateYearlyGoalProgress(gameState);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns a copy of all currently active events. */
  getActiveEvents() {
    return this._activeEvents.map(e => ({ ...e }));
  }

  /**
   * Resolve an event that offers player choices.
   * @param {string} eventId - the event's unique id
   * @param {string} choiceId - which choice was made
   * @returns {boolean} true if resolution succeeded
   */
  resolveEvent(eventId, choiceId) {
    const idx = this._activeEvents.findIndex(e => e.id === eventId);
    if (idx === -1) return false;

    const event = this._activeEvents[idx];
    if (!event.choices) return false;

    const choice = event.choices.find(c => c.id === choiceId);
    if (!choice) return false;

    // Apply choice modifiers to the event's remaining effects
    if (choice.costMultiplier !== undefined && event.effects.cost) {
      event.effects.cost *= choice.costMultiplier;
    }
    if (choice.timeMultiplier !== undefined && event.remainingHours) {
      event.remainingHours *= choice.timeMultiplier;
    }
    if (choice.reputationMult !== undefined && event.effects.reputationHit) {
      event.effects.reputationHit *= choice.reputationMult;
    }
    if (choice.extraCost) {
      event.effects.cost = (event.effects.cost || 0) + choice.extraCost;
    }
    if (choice.extraGuestBoost) {
      event.effects.guestBoostPct = (event.effects.guestBoostPct || 0) + choice.extraGuestBoost;
    }

    event.resolved  = true;
    event.choiceMade = choiceId;

    // Remove choices array so UI knows decision is done
    event.choices = null;

    this.emit('eventResolved', { event, choiceId });
    return true;
  }

  /** Returns seasonal challenges with current progress for the active season. */
  getChallenges() {
    return Object.values(this._challenges).map(c => ({ ...c }));
  }

  /** Returns yearly goals with current progress. */
  getYearlyGoals() {
    return Object.values(this._yearlyGoals).map(g => ({ ...g }));
  }

  /** Returns last 10 resolved events. */
  getEventHistory() {
    return this._eventHistory.slice(-10).reverse();
  }

  // ---------------------------------------------------------------------------
  // Active event management
  // ---------------------------------------------------------------------------

  _tickActiveEvents(gameState, dt) {
    const dtHours = dt / 60;

    for (let i = this._activeEvents.length - 1; i >= 0; i--) {
      const event = this._activeEvents[i];
      event.remainingHours = Math.max(0, event.remainingHours - dtHours);

      if (event.remainingHours <= 0) {
        this._expireEvent(gameState, event);
        this._activeEvents.splice(i, 1);
      }
    }
  }

  _expireEvent(gameState, event) {
    event.endTime = new Date(gameState.date);

    // One-time costs are charged when the event fires; undo persistent modifiers
    if (event.effects.guestBoostPct) {
      // Guest boost dissolves naturally — nothing to undo in state
    }
    if (event.effects.restaurantCapacity) {
      // Restaurants back to full — effect tracked via active events query
    }

    // Push to history (cap at 20)
    const record = { ...event, resolved: true };
    this._eventHistory.push(record);
    if (this._eventHistory.length > 20) {
      this._eventHistory.shift();
    }

    this.emit('eventExpired', record);
  }

  // ---------------------------------------------------------------------------
  // Random event rolling
  // ---------------------------------------------------------------------------

  _rollRandomEvents(gameState) {
    for (const [type, def] of Object.entries(RANDOM_EVENTS)) {
      if (type === 'powder-day') continue; // handled separately
      if (this._activeEvents.some(e => e.type === type)) continue; // no duplicates

      const prob = this._adjustedProbability(def, type, gameState);
      if (Math.random() < prob) {
        this._fireEvent(type, def, gameState);
      }
    }
  }

  /**
   * Returns the per-hour probability for a given event type, adjusted for
   * current game conditions (lift age, weather, etc.).
   */
  _adjustedProbability(def, type, gameState) {
    let p = def.baseProbability;
    const weather = gameState.weather || {};

    switch (type) {
      case 'equipment-failure': {
        // Probability scales with average lift age (years)
        const lifts = gameState.resort?.lifts || [];
        if (lifts.length > 0) {
          const now = gameState.date;
          const avgAgeYears = lifts.reduce((sum, l) => {
            const built = l.builtYear || 2020;
            return sum + (now.getFullYear() - built);
          }, 0) / lifts.length;
          p += avgAgeYears * 0.005; // +0.5% per average year of age
        }
        break;
      }
      case 'storm-damage': {
        if (weather.state === 'blizzard')    p *= 4.0;
        if (weather.state === 'heavy-snow')  p *= 2.0;
        break;
      }
      case 'power-outage': {
        if (weather.state === 'blizzard')    p *= 3.5;
        if (weather.state === 'heavy-snow')  p *= 2.0;
        if (weather.state === 'freezing-rain') p *= 2.5;
        break;
      }
      case 'record-crowd': {
        // Higher chance on weekends
        const day = gameState.date?.getDay();
        if (day === 6 || day === 0) p *= 2.0;
        break;
      }
    }

    return _clamp(p, 0, 0.5);
  }

  _fireEvent(type, def, gameState) {
    const durationHours = def.minDurationHours === def.maxDurationHours
      ? def.minDurationHours
      : _rand(def.minDurationHours, def.maxDurationHours);

    const cost = def.flatCost !== undefined
      ? def.flatCost
      : _rand(def.minCost || 0, def.maxCost || 0);

    const effects = {
      cost,
      reputationHit:      def.reputationHit   || 0,
      reputationBoost:    def.reputationBoost  || 0,
      guestBoostPct:      def.guestBoostPct    || 0,
      satisfactionRisk:   def.satisfactionRisk || false,
      restaurantCapacity: def.restaurantCapacity || 1.0,
    };

    // Charge the cost immediately against the game state
    if (cost > 0) {
      gameState.money -= cost;
      if (gameState.financials?.daily) {
        gameState.financials.daily.expenses = (gameState.financials.daily.expenses || 0) + cost;
      }
    }

    // Apply instant reputation effects
    if (effects.reputationHit) {
      gameState.rating = _clamp(gameState.rating + effects.reputationHit, 1, 5);
    }
    if (effects.reputationBoost) {
      gameState.rating = _clamp(gameState.rating + effects.reputationBoost, 1, 5);
    }

    // Apply satisfaction drop for record-crowd if under-capacity
    if (effects.satisfactionRisk) {
      const lifts = gameState.resort?.lifts || [];
      const openLifts = lifts.filter(l => l.status === 'open').length;
      const capacity = openLifts * 1800; // rough guests per lift per day
      const guests   = gameState.guests?.current || 0;
      if (guests * 1.8 > capacity) {
        gameState.guests.satisfaction = _clamp(
          (gameState.guests.satisfaction || 75) - 15, 0, 100
        );
      }
    }

    const event = {
      id:             _uid(),
      type:           def.type,
      title:          def.title,
      description:    def.description,
      severity:       def.severity || 'info',
      startTime:      new Date(gameState.date),
      durationHours,
      remainingHours: durationHours,
      effects,
      choices:        def.choices ? def.choices.map(c => ({ ...c })) : null,
      resolved:       false,
      choiceMade:     null,
    };

    this._activeEvents.push(event);
    this.emit('eventFired', { ...event });
    return event;
  }

  // ---------------------------------------------------------------------------
  // Powder-day trigger
  // ---------------------------------------------------------------------------

  _checkPowderDay(gameState) {
    const currentDepth = gameState.resort?.snowDepthCm || 0;
    const newSnow = currentDepth - this._lastSnowDepthCm;
    this._lastSnowDepthCm = currentDepth;

    // Trigger powder day when 20+ cm fell since last check
    if (newSnow >= 20 && !this._activeEvents.some(e => e.type === 'powder-day')) {
      const def = RANDOM_EVENTS['powder-day'];
      this._fireEvent('powder-day', def, gameState);
    }
  }

  // ---------------------------------------------------------------------------
  // Seasonal challenges
  // ---------------------------------------------------------------------------

  _ensureChallengesForSeason(gameState) {
    const season = gameState.season;
    if (season === this._loadedSeason) return;

    this._loadedSeason = season;
    this._challenges   = {};

    for (const [id, def] of Object.entries(SEASONAL_CHALLENGES)) {
      if (def.season === season) {
        this._challenges[id] = {
          ...def,
          progress:  0,
          completed: false,
          failed:    false,
        };
      }
    }

    // Reset per-challenge tracking state
    this._holidayRushMinSatisfaction = 100;
    this._holidayRushActive          = false;
    this._springDaysChecked          = new Set();
    this._springFailedDays           = 0;

    this.emit('challengesLoaded', { season, challenges: this.getChallenges() });
  }

  _updateChallengeProgress(gameState) {
    const date  = gameState.date;
    const month = date.getMonth(); // 0-based
    const day   = date.getDate();

    // ---- early-season: open 10+ lifts by Dec 15 ----
    if (this._challenges['early-season'] && !this._challenges['early-season'].completed) {
      const ch    = this._challenges['early-season'];
      const lifts = gameState.resort?.lifts || [];
      const open  = lifts.filter(l => l.status === 'open').length;
      ch.progress = open;

      if (!ch.failed) {
        // Failure deadline: Dec 15 (month 11, day 15) at end of day
        if (month === 11 && day > 15) {
          if (open < 10) {
            ch.failed = true;
            this.emit('challengeFailed', { ...ch });
          }
        }
        if (open >= 10 && !(month === 11 && day > 15)) {
          this._completeChallenge('early-season', gameState);
        }
      }
    }

    // ---- holiday-rush: maintain 80%+ satisfaction Dec 20 – Jan 5 ----
    if (this._challenges['holiday-rush'] && !this._challenges['holiday-rush'].completed) {
      const ch = this._challenges['holiday-rush'];
      const inWindow =
        (month === 11 && day >= 20) ||
        (month === 0  && day <= 5);

      if (inWindow) {
        this._holidayRushActive = true;
        const sat = gameState.guests?.satisfaction || 0;
        if (sat < this._holidayRushMinSatisfaction) {
          this._holidayRushMinSatisfaction = sat;
        }
        // progress = current satisfaction (visual), failure checked at end
        ch.progress = sat;

        if (sat < 80) {
          ch.failed = true;
          this.emit('challengeFailed', { ...ch });
        }
      }

      // Window ended — check success
      if (this._holidayRushActive && month === 0 && day > 5 && !ch.failed && !ch.completed) {
        this._completeChallenge('holiday-rush', gameState);
      }
    }

    // ---- peak-performance: $2M daily revenue in February ----
    if (this._challenges['peak-performance'] && !this._challenges['peak-performance'].completed) {
      const ch = this._challenges['peak-performance'];
      if (month === 1) {
        const dailyRev = gameState.financials?.daily?.revenue || 0;
        ch.progress    = dailyRev;
        if (dailyRev >= 2_000_000) {
          this._completeChallenge('peak-performance', gameState);
        }
      }
    }

    // ---- spring-survival: stay profitable through April ----
    if (this._challenges['spring-survival'] && !this._challenges['spring-survival'].completed) {
      const ch = this._challenges['spring-survival'];
      if (month === 3) {
        const dayKey    = `${date.getFullYear()}-${month}-${day}`;
        const dailyRev  = gameState.financials?.daily?.revenue || 0;
        const dailyExp  = gameState.financials?.daily?.expenses || 0;

        if (!this._springDaysChecked.has(dayKey) && gameState.time?.hour === 23) {
          this._springDaysChecked.add(dayKey);
          if (dailyRev - dailyExp < 0) {
            this._springFailedDays++;
          }
        }

        ch.progress = this._springDaysChecked.size; // days checked

        if (this._springFailedDays > 0) {
          ch.failed = true;
          this.emit('challengeFailed', { ...ch });
        }
      }
      // Award at end of April
      if (month === 4 && day === 1 && !ch.failed && !ch.completed) {
        this._completeChallenge('spring-survival', gameState);
      }
    }
  }

  _completeChallenge(id, gameState) {
    const ch = this._challenges[id];
    if (!ch || ch.completed || ch.failed) return;

    ch.completed = true;
    ch.progress  = ch.progress || 100;

    // Pay out reward
    gameState.money += ch.reward;
    if (gameState.financials?.daily) {
      gameState.financials.daily.revenue = (gameState.financials.daily.revenue || 0) + ch.reward;
    }

    this.emit('challengeCompleted', { ...ch });
  }

  // ---------------------------------------------------------------------------
  // Yearly goals
  // ---------------------------------------------------------------------------

  _updateYearlyGoalProgress(gameState) {
    // guest-milestone: total guests this season
    {
      const goal = this._yearlyGoals['guest-milestone'];
      if (!goal.completed) {
        // season guest total approximated via state (cumulative)
        const total    = gameState.guests?.seasonTotal || 0;
        goal.progress  = total;
        if (total >= goal.target) {
          this._completeYearlyGoal('guest-milestone', gameState);
        }
      }
    }

    // rating-target: 4.5+ stars
    {
      const goal = this._yearlyGoals['rating-target'];
      if (!goal.completed) {
        goal.progress = gameState.rating || 0;
        if (goal.progress >= goal.target) {
          this._completeYearlyGoal('rating-target', gameState);
        }
      }
    }

    // revenue-target: $100M seasonal revenue
    {
      const goal = this._yearlyGoals['revenue-target'];
      if (!goal.completed) {
        const rev      = gameState.financials?.seasonal?.revenue || 0;
        goal.progress  = rev;
        if (rev >= goal.target) {
          this._completeYearlyGoal('revenue-target', gameState);
        }
      }
    }
  }

  _completeYearlyGoal(id, gameState) {
    const goal = this._yearlyGoals[id];
    if (!goal || goal.completed) return;

    goal.completed = true;

    // Pay out reward
    gameState.money += goal.reward;
    if (gameState.financials?.daily) {
      gameState.financials.daily.revenue = (gameState.financials.daily.revenue || 0) + goal.reward;
    }

    this.emit('goalCompleted', { ...goal });
  }
}
