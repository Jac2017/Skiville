/**
 * LiftAnimator.js
 * Animates gondola/chair entities moving along lift cables for Skiville.
 * Uses CesiumJS billboard and point entities interpolated between base and peak positions.
 */
import * as Cesium from 'cesium';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default progress increment per game-tick when no rideTime is supplied. */
const DEFAULT_SPEED = 0.002;

/**
 * Approximate cable length in meters used to derive speed from rideTime.
 * A rideTime (seconds) maps to speed = 1 / (rideTime * TARGET_FPS).
 */
const TARGET_FPS = 60;

/** Offset added to base/peak elevations so entities float just above the cable. */
const CABLE_HEIGHT_OFFSET = 2; // metres

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a {lat, lng} coordinate + elevation (metres) to a Cesium Cartesian3.
 * Returns null on failure.
 * @param {number} lat
 * @param {number} lng
 * @param {number} elevationMetres
 * @returns {Cesium.Cartesian3|null}
 */
function toCartesian(lat, lng, elevationMetres) {
  try {
    return Cesium.Cartesian3.fromDegrees(lng, lat, elevationMetres + CABLE_HEIGHT_OFFSET);
  } catch (e) {
    console.warn('[LiftAnimator] toCartesian failed:', e);
    return null;
  }
}

/**
 * Determine pool size (number of moving entities) for a lift type.
 * @param {string} type
 * @returns {number}
 */
function poolSize(type) {
  if (type === 't-bar') return 3;
  return 5; // default: 4-6 range; using 5 as a balanced mid-point
}

/**
 * Build the appearance descriptor for a given lift type.
 * Returns { kind: 'billboard'|'point', pixelSize, color }
 * @param {string} type
 * @returns {{ kind: string, pixelSize: number, color: Cesium.Color }}
 */
function appearanceFor(type) {
  switch (type) {
    case 'gondola':
    case 'peak2peak':
      return { kind: 'billboard', pixelSize: 10, color: Cesium.Color.fromCssColorString('#DDDDDD') };
    case 'express-quad':
    case 'quad':
    case 'triple':
      return { kind: 'point', pixelSize: 6, color: Cesium.Color.fromCssColorString('#AAAAAA') };
    case 't-bar':
      return { kind: 'point', pixelSize: 4, color: Cesium.Color.fromCssColorString('#888888') };
    default:
      return { kind: 'point', pixelSize: 6, color: Cesium.Color.fromCssColorString('#AAAAAA') };
  }
}

/**
 * Create a tiny canvas data-URI circle for billboard use, sized to pixelSize.
 * Cached by size.
 */
const _circleCache = new Map();
function circleDataUri(pixelSize) {
  if (_circleCache.has(pixelSize)) return _circleCache.get(pixelSize);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = pixelSize;
    canvas.height = pixelSize;
    const ctx = canvas.getContext('2d');
    const r = pixelSize / 2;
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.fillStyle = '#DDDDDD';
    ctx.fill();
    const uri = canvas.toDataURL();
    _circleCache.set(pixelSize, uri);
    return uri;
  } catch (e) {
    // Fallback: empty string — Cesium will just not display the image
    return '';
  }
}

// ---------------------------------------------------------------------------
// LiftAnimator
// ---------------------------------------------------------------------------

/**
 * Animates gondola/chair entities that travel back and forth along lift cables.
 *
 * Lift data shape expected by init():
 * {
 *   id: string,
 *   name: string,
 *   type: 'gondola'|'express-quad'|'quad'|'triple'|'t-bar'|'magic-carpet'|'peak2peak',
 *   status: 'open'|'closed',
 *   coords: { base: { lat, lng }, peak: { lat, lng } },
 *   baseElevation: number,   // metres
 *   peakElevation: number,   // metres
 *   rideTime?: number,       // seconds (optional)
 * }
 */
export class LiftAnimator {
  /**
   * @param {Cesium.Viewer} viewer - CesiumJS viewer instance.
   */
  constructor(viewer) {
    /** @type {Cesium.Viewer|null} */
    this._viewer = viewer ?? null;

    /**
     * Map from liftId to lift animation state:
     * {
     *   entities: Array<{ entity: Cesium.Entity, state: { progress, direction, speed } }>,
     *   positions: { base: Cesium.Cartesian3, peak: Cesium.Cartesian3 },
     *   appearance: { kind, pixelSize, color },
     *   active: boolean,
     * }
     * @type {Map<string, object>}
     */
    this._pools = new Map();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initialise entity pools for the provided lifts.
   * Skips any lift with type 'magic-carpet'.
   * Safe to call multiple times — existing pools are destroyed first.
   *
   * @param {Array<object>} lifts
   */
  init(lifts) {
    if (!this._viewer) return;
    if (!Array.isArray(lifts)) return;

    // Clean up any previously created pools.
    this.destroy();

    for (const lift of lifts) {
      try {
        this._initLift(lift);
      } catch (e) {
        console.warn(`[LiftAnimator] Failed to init lift "${lift?.id}":`, e);
      }
    }
  }

  /**
   * Advance all lift animations by one game tick.
   * Should be called from the main game loop (e.g. Cesium postRender or requestAnimationFrame).
   *
   * @param {object} gameState - Expected shape: { resort: { lifts: Array<{ id, status }> } }
   */
  update(gameState) {
    if (!this._viewer) return;
    if (!this._pools.size) return;

    // Build a quick lookup of live status from gameState.
    const statusById = new Map();
    try {
      const liveLifts = gameState?.resort?.lifts;
      if (Array.isArray(liveLifts)) {
        for (const l of liveLifts) {
          if (l?.id != null) statusById.set(String(l.id), l.status);
        }
      }
    } catch (e) {
      console.warn('[LiftAnimator] update: failed to read gameState:', e);
    }

    for (const [liftId, pool] of this._pools) {
      try {
        this._updatePool(liftId, pool, statusById);
      } catch (e) {
        console.warn(`[LiftAnimator] update: error in pool "${liftId}":`, e);
      }
    }
  }

  /**
   * Remove all managed entities from the viewer and clear internal state.
   */
  destroy() {
    if (!this._viewer) {
      this._pools.clear();
      return;
    }

    for (const [, pool] of this._pools) {
      try {
        this._destroyPool(pool);
      } catch (e) {
        console.warn('[LiftAnimator] destroy: error removing entities:', e);
      }
    }
    this._pools.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Initialise one lift's entity pool.
   * @param {object} lift
   */
  _initLift(lift) {
    // Skip magic carpets — they don't have cable animation.
    if (lift.type === 'magic-carpet') return;

    // Validate required fields.
    if (!lift.id || !lift.coords?.base || !lift.coords?.peak) {
      console.warn('[LiftAnimator] _initLift: missing required fields on lift', lift);
      return;
    }

    const base = toCartesian(
      lift.coords.base.lat,
      lift.coords.base.lng,
      lift.baseElevation ?? 0,
    );
    const peak = toCartesian(
      lift.coords.peak.lat,
      lift.coords.peak.lng,
      lift.peakElevation ?? 0,
    );

    if (!base || !peak) {
      console.warn(`[LiftAnimator] _initLift: could not compute positions for lift "${lift.id}"`);
      return;
    }

    const appearance = appearanceFor(lift.type);
    const count = poolSize(lift.type);

    // Speed: if rideTime is provided, convert seconds → progress/frame.
    // A full one-way trip takes rideTime seconds at TARGET_FPS frames/s.
    const speed =
      lift.rideTime && lift.rideTime > 0
        ? 1 / (lift.rideTime * TARGET_FPS)
        : DEFAULT_SPEED;

    const entitySlots = [];

    for (let i = 0; i < count; i++) {
      // Stagger initial progress evenly.  Entity 0 starts at 0, entity 1 at 1/count, etc.
      const initialProgress = i / count;

      // Alternate direction so entities travel in both directions from the start.
      const direction = i % 2 === 0 ? 1 : -1;

      const startPos = this._lerpPosition(base, peak, initialProgress);
      const entity = this._createEntity(appearance, startPos, lift.name, i);

      if (!entity) continue;

      entitySlots.push({
        entity,
        state: {
          progress: initialProgress,
          direction,
          speed,
        },
      });
    }

    this._pools.set(String(lift.id), {
      entities: entitySlots,
      positions: { base, peak },
      appearance,
      active: lift.status === 'open',
    });
  }

  /**
   * Create a single Cesium entity (billboard or point) at the given position.
   * @param {{ kind: string, pixelSize: number, color: Cesium.Color }} appearance
   * @param {Cesium.Cartesian3} position
   * @param {string} liftName
   * @param {number} index
   * @returns {Cesium.Entity|null}
   */
  _createEntity(appearance, position, liftName, index) {
    try {
      const entityOptions = {
        name: `${liftName} car ${index + 1}`,
        position,
      };

      if (appearance.kind === 'billboard') {
        entityOptions.billboard = {
          image: circleDataUri(appearance.pixelSize),
          width: appearance.pixelSize,
          height: appearance.pixelSize,
          color: appearance.color,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
          // Keep billboard screen-size constant regardless of camera distance.
          sizeInMeters: false,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
      } else {
        entityOptions.point = {
          pixelSize: appearance.pixelSize,
          color: appearance.color,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        };
      }

      return this._viewer.entities.add(entityOptions);
    } catch (e) {
      console.warn('[LiftAnimator] _createEntity failed:', e);
      return null;
    }
  }

  /**
   * Update a single pool for one game tick.
   * @param {string} liftId
   * @param {object} pool
   * @param {Map<string, string>} statusById
   */
  _updatePool(liftId, pool, statusById) {
    const liveStatus = statusById.has(liftId) ? statusById.get(liftId) : null;

    // If the lift is not present in gameState, preserve the current active state.
    const isOpen = liveStatus !== null ? liveStatus === 'open' : pool.active;

    // Sync active flag.
    pool.active = isOpen;

    const closedColor = Cesium.Color.RED;

    for (const slot of pool.entities) {
      const { entity, state } = slot;
      if (!entity) continue;

      if (isOpen) {
        // Advance progress.
        state.progress += state.speed * state.direction;

        // Reverse at boundaries.
        if (state.progress >= 1) {
          state.progress = 1;
          state.direction = -1;
        } else if (state.progress <= 0) {
          state.progress = 0;
          state.direction = 1;
        }

        // Interpolate position along cable.
        const newPos = this._lerpPosition(
          pool.positions.base,
          pool.positions.peak,
          state.progress,
        );

        if (newPos) {
          try {
            entity.position = new Cesium.ConstantPositionProperty(newPos);
          } catch (e) {
            console.warn('[LiftAnimator] _updatePool: failed to set position:', e);
          }
        }

        // Restore original colour if the lift was previously closed.
        this._setEntityColor(entity, pool.appearance);
      } else {
        // Closed: freeze position, paint red.
        this._setEntityColor(entity, pool.appearance, closedColor);
      }
    }
  }

  /**
   * Apply a colour override (or restore the default appearance colour) to an entity.
   * @param {Cesium.Entity} entity
   * @param {{ kind: string, color: Cesium.Color }} appearance
   * @param {Cesium.Color} [override] - If provided, use this colour instead of appearance.color.
   */
  _setEntityColor(entity, appearance, override) {
    try {
      const color = override ?? appearance.color;
      if (appearance.kind === 'billboard' && entity.billboard) {
        entity.billboard.color = color;
      } else if (appearance.kind === 'point' && entity.point) {
        entity.point.color = color;
      }
    } catch (e) {
      console.warn('[LiftAnimator] _setEntityColor failed:', e);
    }
  }

  /**
   * Remove all entities belonging to a pool from the viewer.
   * @param {object} pool
   */
  _destroyPool(pool) {
    for (const slot of pool.entities) {
      try {
        if (slot.entity) {
          this._viewer.entities.remove(slot.entity);
        }
      } catch (e) {
        console.warn('[LiftAnimator] _destroyPool: failed to remove entity:', e);
      }
    }
    pool.entities = [];
  }

  /**
   * Lerp between two Cartesian3 positions by a 0-1 factor.
   * Returns null on failure.
   * @param {Cesium.Cartesian3} base
   * @param {Cesium.Cartesian3} peak
   * @param {number} t  - 0 = base, 1 = peak
   * @returns {Cesium.Cartesian3|null}
   */
  _lerpPosition(base, peak, t) {
    try {
      // Cesium.Cartesian3.lerp signature: lerp(start, end, t, result)
      return Cesium.Cartesian3.lerp(base, peak, t, new Cesium.Cartesian3());
    } catch (e) {
      console.warn('[LiftAnimator] _lerpPosition failed:', e);
      return null;
    }
  }
}
