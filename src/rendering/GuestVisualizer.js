/**
 * GuestVisualizer.js
 * Visualizes resort guests as point entities on the 3D mountain for Skiville.
 * Guests are distributed across ski runs, lift queues, and the village area.
 */
import * as Cesium from 'cesium';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total number of reusable point entities in the guest pool. */
const POOL_SIZE = 80;

/** Number of queue cluster entities created at major lift bases. */
const QUEUE_CLUSTER_COUNT = 10;

/** Guests represented by each visible entity. */
const GUESTS_PER_ENTITY = 100;

/** Village center coordinates (Whistler village area). */
const VILLAGE_LAT = 50.1145;
const VILLAGE_LNG = -122.9531;

/** Height offset above terrain for guest points, in metres. */
const GUEST_HEIGHT = 5;

/** Spread radius (degrees) for village and queue clusters. */
const VILLAGE_SPREAD = 0.004;
const QUEUE_SPREAD = 0.0003;

/** Distribution fractions must sum to 1.0. */
const FRAC_SKIING = 0.60;
const FRAC_QUEUING = 0.25;
// FRAC_VILLAGE = 0.15 (remainder)

/** Speed at which skiing entities advance down the run per tick (0–1 progress). */
const SKI_SPEED = 0.004;

/** Maximum lateral offset (degrees) applied to skiing entities. */
const LATERAL_SPREAD = 0.0006;

/** Wait-time thresholds (in equivalent "queue length" units) for colour coding. */
const QUEUE_GREEN_MAX = 5;
const QUEUE_YELLOW_MAX = 15;

/** Guest-type colours as Cesium Color instances. */
const GUEST_COLORS = {
  families: Cesium.Color.fromCssColorString('#FFD700'),
  experts:  Cesium.Color.fromCssColorString('#FF4444'),
  beginners: Cesium.Color.fromCssColorString('#44FF44'),
  teens:    Cesium.Color.fromCssColorString('#AA44FF'),
  default:  Cesium.Color.fromCssColorString('#00EEFF'),
};

/** Queue wait colours. */
const QUEUE_COLOR_GREEN  = Cesium.Color.fromCssColorString('#00FF88');
const QUEUE_COLOR_YELLOW = Cesium.Color.fromCssColorString('#FFDD00');
const QUEUE_COLOR_RED    = Cesium.Color.fromCssColorString('#FF3333');

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Convert lat/lng + elevation to Cesium Cartesian3.
 * Returns null if conversion fails.
 * @param {number} lat
 * @param {number} lng
 * @param {number} [elevation=GUEST_HEIGHT]
 * @returns {Cesium.Cartesian3|null}
 */
function toCartesian(lat, lng, elevation = GUEST_HEIGHT) {
  try {
    return Cesium.Cartesian3.fromDegrees(lng, lat, elevation);
  } catch (e) {
    console.warn('[GuestVisualizer] toCartesian failed:', e);
    return null;
  }
}

/**
 * Return a random float in [min, max).
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Linearly interpolate between two Cartesian3 positions.
 * @param {Cesium.Cartesian3} a
 * @param {Cesium.Cartesian3} b
 * @param {number} t  0–1
 * @returns {Cesium.Cartesian3}
 */
function lerpCartesian(a, b, t) {
  return Cesium.Cartesian3.lerp(a, b, t, new Cesium.Cartesian3());
}

/**
 * Determine the dominant guest type in a gameState guest breakdown.
 * Falls back to 'default' when no breakdown is present.
 * @param {object} guests  gameState.guests
 * @returns {string}
 */
function dominantGuestType(guests) {
  if (!guests) return 'default';
  const types = ['families', 'experts', 'beginners', 'teens'];
  let best = 'default';
  let bestCount = -1;
  for (const t of types) {
    const count = guests[t] ?? 0;
    if (count > bestCount) {
      bestCount = count;
      best = t;
    }
  }
  return bestCount > 0 ? best : 'default';
}

/**
 * Pick a queue wait colour based on a numeric wait value.
 * @param {number} wait  Unitless wait magnitude (queue length or minutes).
 * @returns {Cesium.Color}
 */
function waitColor(wait) {
  if (wait < QUEUE_GREEN_MAX)  return QUEUE_COLOR_GREEN;
  if (wait < QUEUE_YELLOW_MAX) return QUEUE_COLOR_YELLOW;
  return QUEUE_COLOR_RED;
}

// ---------------------------------------------------------------------------
// GuestVisualizer
// ---------------------------------------------------------------------------

export class GuestVisualizer {
  /**
   * @param {Cesium.Viewer} viewer  Active CesiumJS viewer instance.
   */
  constructor(viewer) {
    /** @type {Cesium.Viewer|null} */
    this._viewer = viewer ?? null;

    /**
     * Pool of reusable point entities for general guests.
     * @type {Cesium.Entity[]}
     */
    this._pool = [];

    /**
     * Pool of point entities used for queue cluster visualisation.
     * @type {Cesium.Entity[]}
     */
    this._queuePool = [];

    /**
     * Per-pool-entity state used by the skiing animation.
     * @type {Array<{liftIndex:number, progress:number, lateralOffset:number}>}
     */
    this._entityState = [];

    /**
     * Lift position data stored during init().
     * Each entry: { baseLat, baseLng, baseElev, peakLat, peakLng, peakElev }
     * @type {Array<object>}
     */
    this._liftPositions = [];

    /** Whether init() has completed successfully. */
    this._ready = false;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build the entity pool and store lift positions for later use.
   * Must be called before update().
   *
   * @param {Array<{
   *   coords: { base: {lat:number, lng:number}, peak: {lat:number, lng:number} },
   *   baseElevation?: number,
   *   peakElevation?: number
   * }>} lifts  Array of lift descriptors from the game model.
   */
  init(lifts) {
    try {
      if (!this._viewer) {
        console.warn('[GuestVisualizer] init() called with null viewer — skipping.');
        return;
      }

      // --- Store lift positions -------------------------------------------
      this._liftPositions = [];
      if (Array.isArray(lifts)) {
        for (const lift of lifts) {
          try {
            const base = lift?.coords?.base;
            const peak = lift?.coords?.peak;
            if (!base || !peak) continue;
            this._liftPositions.push({
              baseLat:  base.lat,
              baseLng:  base.lng,
              baseElev: lift.baseElevation ?? GUEST_HEIGHT,
              peakLat:  peak.lat,
              peakLng:  peak.lng,
              peakElev: lift.peakElevation ?? 500,
            });
          } catch (liftErr) {
            console.warn('[GuestVisualizer] Failed to parse lift entry:', liftErr);
          }
        }
      }

      // Fallback lift so the pool always has somewhere to distribute guests.
      if (this._liftPositions.length === 0) {
        this._liftPositions.push({
          baseLat: VILLAGE_LAT,      baseLng: VILLAGE_LNG,      baseElev: 700,
          peakLat: VILLAGE_LAT + 0.02, peakLng: VILLAGE_LNG + 0.01, peakElev: 1600,
        });
      }

      // --- Build main guest pool ------------------------------------------
      this._pool = [];
      this._entityState = [];

      for (let i = 0; i < POOL_SIZE; i++) {
        const liftIndex = i % this._liftPositions.length;
        const lift = this._liftPositions[liftIndex];

        const entity = this._viewer.entities.add({
          show: false,
          position: toCartesian(lift.peakLat, lift.peakLng, lift.peakElev) ?? undefined,
          point: {
            pixelSize: 6,
            color: GUEST_COLORS.default,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        this._pool.push(entity);
        this._entityState.push({
          liftIndex,
          progress: Math.random(), // stagger entities along the run
          lateralOffset: randBetween(-LATERAL_SPREAD, LATERAL_SPREAD),
        });
      }

      // --- Build queue cluster pool ---------------------------------------
      this._queuePool = [];
      const queueLifts = this._liftPositions.slice(0, QUEUE_CLUSTER_COUNT);

      // Ensure we always create exactly QUEUE_CLUSTER_COUNT entries, cycling
      // through available lifts when there are fewer than that.
      for (let i = 0; i < QUEUE_CLUSTER_COUNT; i++) {
        const lift = queueLifts[i % queueLifts.length];

        const entity = this._viewer.entities.add({
          show: false,
          position: toCartesian(lift.baseLat, lift.baseLng, lift.baseElev) ?? undefined,
          point: {
            pixelSize: 8,
            color: QUEUE_COLOR_GREEN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });

        this._queuePool.push(entity);
      }

      this._ready = true;
      console.log(
        `[GuestVisualizer] Initialised: ${POOL_SIZE} guest entities, ` +
        `${QUEUE_CLUSTER_COUNT} queue clusters, ${this._liftPositions.length} lifts.`
      );
    } catch (e) {
      console.error('[GuestVisualizer] init() error:', e);
    }
  }

  /**
   * Update entity visibility, positions, and colours based on the current game state.
   * Call once per game tick.
   *
   * @param {{
   *   guests?: { current?: number, families?: number, experts?: number,
   *              beginners?: number, teens?: number },
   *   queues?: Array<{ liftIndex?: number, length?: number }>
   * }} gameState
   */
  update(gameState) {
    try {
      if (!this._ready || !this._viewer) return;

      // ---- Guest count & entity budget -----------------------------------
      const guestCount = gameState?.guests?.current ?? 0;
      const visibleCount = Math.min(
        Math.floor(guestCount / GUESTS_PER_ENTITY),
        POOL_SIZE
      );

      // ---- Distribution budget ------------------------------------------
      const skiingCount  = Math.round(visibleCount * FRAC_SKIING);
      const queuingCount = Math.round(visibleCount * FRAC_QUEUING);
      // village = remainder
      const villageCount = visibleCount - skiingCount - queuingCount;

      // ---- Dominant guest colour ----------------------------------------
      const guestType = dominantGuestType(gameState?.guests);
      const guestColor = GUEST_COLORS[guestType] ?? GUEST_COLORS.default;

      // ---- Update main pool ---------------------------------------------
      for (let i = 0; i < POOL_SIZE; i++) {
        const entity = this._pool[i];
        const state  = this._entityState[i];

        if (i >= visibleCount) {
          entity.show = false;
          continue;
        }

        entity.show = true;
        entity.point.color = guestColor;

        const lift = this._liftPositions[state.liftIndex];

        if (i < skiingCount) {
          // ---- Skiing (moving downhill) ----------------------------------
          this._updateSkiingEntity(entity, state, lift);

        } else if (i < skiingCount + queuingCount) {
          // ---- Queuing (clustered near lift base) ------------------------
          const clusterLift =
            this._liftPositions[i % this._liftPositions.length];

          const jLat = clusterLift.baseLat + randBetween(-QUEUE_SPREAD, QUEUE_SPREAD);
          const jLng = clusterLift.baseLng + randBetween(-QUEUE_SPREAD, QUEUE_SPREAD);
          const pos  = toCartesian(jLat, jLng, clusterLift.baseElev + GUEST_HEIGHT);
          if (pos) entity.position = pos;

        } else {
          // ---- Village area ---------------------------------------------
          const vLat = VILLAGE_LAT + randBetween(-VILLAGE_SPREAD, VILLAGE_SPREAD);
          const vLng = VILLAGE_LNG + randBetween(-VILLAGE_SPREAD, VILLAGE_SPREAD);
          const pos  = toCartesian(vLat, vLng, GUEST_HEIGHT);
          if (pos) entity.position = pos;
        }
      }

      // ---- Update queue cluster entities --------------------------------
      this._updateQueueClusters(gameState, guestCount);

    } catch (e) {
      console.error('[GuestVisualizer] update() error:', e);
    }
  }

  /**
   * Remove all managed entities from the viewer and reset internal state.
   */
  destroy() {
    try {
      if (!this._viewer) return;

      for (const entity of this._pool) {
        try { this._viewer.entities.remove(entity); } catch (_) { /* ignored */ }
      }
      for (const entity of this._queuePool) {
        try { this._viewer.entities.remove(entity); } catch (_) { /* ignored */ }
      }

      this._pool          = [];
      this._queuePool     = [];
      this._entityState   = [];
      this._liftPositions = [];
      this._ready         = false;

      console.log('[GuestVisualizer] Destroyed — all entities removed.');
    } catch (e) {
      console.error('[GuestVisualizer] destroy() error:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Advance a skiing entity one tick down its assigned lift line.
   * When progress reaches 1 (base), teleport back to the peak.
   *
   * @param {Cesium.Entity} entity
   * @param {{liftIndex:number, progress:number, lateralOffset:number}} state
   * @param {{baseLat:number,baseLng:number,baseElev:number,
   *          peakLat:number,peakLng:number,peakElev:number}} lift
   */
  _updateSkiingEntity(entity, state, lift) {
    // Advance progress (peak = 0, base = 1)
    state.progress += SKI_SPEED;

    if (state.progress >= 1.0) {
      // Teleport to a random lift's peak
      const newLiftIndex = Math.floor(Math.random() * this._liftPositions.length);
      state.liftIndex      = newLiftIndex;
      state.progress       = 0;
      state.lateralOffset  = randBetween(-LATERAL_SPREAD, LATERAL_SPREAD);

      const newLift = this._liftPositions[newLiftIndex];
      const pos = toCartesian(newLift.peakLat, newLift.peakLng, newLift.peakElev);
      if (pos) entity.position = pos;
      return;
    }

    const t = state.progress;

    // Interpolate lat/lng/elev independently so we can add a lateral offset.
    const lat  = lift.peakLat  + (lift.baseLat  - lift.peakLat)  * t + state.lateralOffset;
    const lng  = lift.peakLng  + (lift.baseLng  - lift.peakLng)  * t;
    const elev = lift.peakElev + (lift.baseElev - lift.peakElev) * t + GUEST_HEIGHT;

    // Use Cesium.Cartesian3.lerp for the final 3D position to honour ellipsoidal
    // geometry, blending from the raw interpolated point toward the lerped result.
    const rawPos = toCartesian(lat, lng, elev);
    if (!rawPos) return;

    const peakCart = toCartesian(lift.peakLat, lift.peakLng, lift.peakElev + GUEST_HEIGHT);
    const baseCart = toCartesian(lift.baseLat, lift.baseLng, lift.baseElev + GUEST_HEIGHT);

    if (peakCart && baseCart) {
      const lerped = lerpCartesian(peakCart, baseCart, t);
      // Blend lerped (smooth line) with raw (captures lateral offset / elev curve).
      entity.position = lerpCartesian(lerped, rawPos, 0.4);
    } else {
      entity.position = rawPos;
    }
  }

  /**
   * Update the QUEUE_CLUSTER_COUNT queue entities.
   * Size and colour reflect queue lengths from gameState, falling back to
   * a proportion of the total guest count.
   *
   * @param {object} gameState
   * @param {number} guestCount
   */
  _updateQueueClusters(gameState, guestCount) {
    const queues   = gameState?.queues ?? [];
    const lifts    = this._liftPositions;

    for (let i = 0; i < this._queuePool.length; i++) {
      const entity   = this._queuePool[i];
      const liftIdx  = i % lifts.length;
      const lift     = lifts[liftIdx];

      // Determine queue depth for this cluster.
      let queueLength = 0;
      if (queues.length > 0) {
        // Try to find a matching queue entry; fall back to positional index.
        const qEntry =
          queues.find(q => (q.liftIndex ?? q.liftId) === liftIdx) ??
          queues[i % queues.length];
        queueLength = qEntry?.length ?? 0;
      } else {
        // No queue data — derive a proportional length from guest count.
        queueLength = Math.floor(guestCount / (GUESTS_PER_ENTITY * lifts.length));
      }

      // Show between 3 and 8 cluster points depending on queue depth.
      // We only have one entity per cluster position here; size encodes depth.
      const clampedDepth = Math.max(0, Math.min(queueLength, 100));
      const pixelSize    = 6 + Math.round((clampedDepth / 100) * 10); // 6–16px

      // Visible when there are any guests on the mountain.
      entity.show = guestCount > 0;

      // Jitter position slightly each update so the cluster feels alive.
      const jLat = lift.baseLat + randBetween(-QUEUE_SPREAD, QUEUE_SPREAD);
      const jLng = lift.baseLng + randBetween(-QUEUE_SPREAD, QUEUE_SPREAD);
      const pos  = toCartesian(jLat, jLng, lift.baseElev + GUEST_HEIGHT);
      if (pos) entity.position = pos;

      entity.point.pixelSize = pixelSize;
      entity.point.color     = waitColor(queueLength);
    }
  }
}
