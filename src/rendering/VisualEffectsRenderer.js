/**
 * VisualEffectsRenderer.js
 * Handles enhanced weather effects, grooming machine animations, and snowmaking
 * visuals for the Skiville ski resort tycoon game using CesiumJS.
 */
import * as Cesium from 'cesium';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total billboard entities allocated for snow particles. */
const SNOW_PARTICLE_POOL_SIZE = 80;

/** Total point entities allocated for grooming machines. */
const GROOMER_POOL_SIZE = 6;

/** Total billboard entities allocated for snowmaking guns. */
const SNOWGUN_POOL_SIZE = 20;

/** Speed at which grooming machines travel along lift lines (progress per frame). */
const GROOMER_SPEED = 0.001;

/** Elevation above ground (metres) at which snow particles are spawned. */
const PARTICLE_SPAWN_HEIGHT = 80;

/** Horizontal radius (degrees) within which particles are scattered around the camera. */
const PARTICLE_SPREAD_DEG = 0.004;

/** Grooming is active during hours [GROOMER_START, 24) and [0, GROOMER_END). */
const GROOMER_START_HOUR = 22;
const GROOMER_END_HOUR = 6;

/** Temperature threshold (Celsius) below which snowmaking guns operate. */
const SNOWMAKING_TEMP_THRESHOLD = -2;

/** Scale oscillation range for snowmaking gun pulse animation. */
const SNOWGUN_SCALE_MIN = 0.8;
const SNOWGUN_SCALE_MAX = 1.2;
const SNOWGUN_PULSE_SPEED = 0.05; // radians per frame

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a 16x16 white radial-gradient circle as a data URI, used as the
 * snow particle billboard image.
 * @returns {string} PNG data URI
 */
function buildSnowflakeDataURI() {
  try {
    const size = 16;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, cx, 0, Math.PI * 2);
    ctx.fill();
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('[VisualEffectsRenderer] buildSnowflakeDataURI failed:', e);
    // Fallback: a plain white 1px data URI
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
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
 * Determine whether the grooming shift is active given a decimal hour.
 * Active during [22, 24) and [0, 6).
 * @param {number} hour - e.g. 22.5
 * @returns {boolean}
 */
function isGroomingHour(hour) {
  return hour >= GROOMER_START_HOUR || hour < GROOMER_END_HOUR;
}

// ---------------------------------------------------------------------------
// VisualEffectsRenderer
// ---------------------------------------------------------------------------

export class VisualEffectsRenderer {
  /**
   * @param {Cesium.Viewer} viewer - The CesiumJS viewer instance.
   */
  constructor(viewer) {
    /** @type {Cesium.Viewer|null} */
    this._viewer = viewer || null;

    /** @type {Cesium.Entity[]} Pool of snow particle billboard entities. */
    this._particles = [];

    /** @type {Cesium.Entity[]} Pool of grooming machine point entities. */
    this._groomers = [];

    /** @type {Cesium.Entity[]} Pool of snowmaking gun billboard entities. */
    this._snowguns = [];

    /**
     * Per-particle runtime state.
     * @type {Array<{lon: number, lat: number, alt: number, speed: number, drift: number, active: boolean}>}
     */
    this._particleState = [];

    /**
     * Per-groomer runtime state.
     * @type {Array<{progress: number, liftIndex: number, active: boolean}>}
     */
    this._groomerState = [];

    /**
     * Snowmaking gun pulse phase (radians), shared across all guns.
     * @type {number}
     */
    this._gunPhase = 0;

    /**
     * Lift positions stored by init().
     * @type {Array<{base: {lat,lng,elevation}, peak: {lat,lng,elevation}}>}
     */
    this._lifts = [];

    /** Cached snowflake data URI. */
    this._snowflakeURI = null;
  }

  // -------------------------------------------------------------------------
  // Public: init
  // -------------------------------------------------------------------------

  /**
   * Stores lift positions and pre-creates all pooled entities.
   * Must be called once before update().
   * @param {Array<{base: {lat,lng,elevation}, peak: {lat,lng,elevation}}>} lifts
   */
  init(lifts) {
    try {
      if (!this._viewer) {
        console.warn('[VisualEffectsRenderer] init called with no viewer – skipping.');
        return;
      }

      this._lifts = Array.isArray(lifts) ? lifts : [];
      this._snowflakeURI = buildSnowflakeDataURI();

      this._createParticlePool();
      this._createGroomerPool();
      this._createSnowgunPool();
    } catch (e) {
      console.error('[VisualEffectsRenderer] init error:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Public: update
  // -------------------------------------------------------------------------

  /**
   * Called each game tick to refresh all visual effects based on current state.
   * @param {object} gameState
   * @param {object} gameState.weather - { state: string, temperature: number }
   * @param {object} gameState.resort  - { groomingQuality: number, snowmaking: boolean }
   * @param {object} [gameState.time]  - { hour: number } (decimal 0-24)
   */
  update(gameState) {
    try {
      if (!this._viewer) return;
      if (!gameState) return;

      const weather = gameState.weather || {};
      const resort = gameState.resort || {};
      const timeData = gameState.time || {};

      this._updateParticles(weather);
      this._updateGroomers(resort, timeData);
      this._updateSnowguns(resort, weather);
    } catch (e) {
      console.error('[VisualEffectsRenderer] update error:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Public: destroy
  // -------------------------------------------------------------------------

  /**
   * Removes all managed entities from the viewer and clears internal arrays.
   */
  destroy() {
    try {
      if (!this._viewer) return;

      const entities = this._viewer.entities;

      for (const entity of this._particles) {
        try { entities.remove(entity); } catch (_) { /* ignore */ }
      }
      for (const entity of this._groomers) {
        try { entities.remove(entity); } catch (_) { /* ignore */ }
      }
      for (const entity of this._snowguns) {
        try { entities.remove(entity); } catch (_) { /* ignore */ }
      }

      this._particles = [];
      this._groomers = [];
      this._snowguns = [];
      this._particleState = [];
      this._groomerState = [];
      this._lifts = [];
      this._viewer = null;
    } catch (e) {
      console.error('[VisualEffectsRenderer] destroy error:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Private: entity pool creation
  // -------------------------------------------------------------------------

  /** Creates SNOW_PARTICLE_POOL_SIZE billboard entities, all initially hidden. */
  _createParticlePool() {
    try {
      const entities = this._viewer.entities;
      for (let i = 0; i < SNOW_PARTICLE_POOL_SIZE; i++) {
        const entity = entities.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          billboard: {
            image: this._snowflakeURI,
            width: 6,
            height: 6,
            color: new Cesium.Color(1, 1, 1, 0.7),
            pixelOffset: new Cesium.Cartesian2(0, 0),
            eyeOffset: new Cesium.Cartesian3(0, 0, 0),
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            scaleByDistance: undefined,
            show: false,
          },
        });
        this._particles.push(entity);
        this._particleState.push({
          lon: 0,
          lat: 0,
          alt: 0,
          speed: 0.3,
          drift: 0,
          active: false,
        });
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _createParticlePool error:', e);
    }
  }

  /** Creates GROOMER_POOL_SIZE orange point entities, all initially hidden. */
  _createGroomerPool() {
    try {
      const entities = this._viewer.entities;
      for (let i = 0; i < GROOMER_POOL_SIZE; i++) {
        const entity = entities.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          point: {
            pixelSize: 8,
            color: Cesium.Color.ORANGE,
            outlineColor: Cesium.Color.fromCssColorString('#cc6600'),
            outlineWidth: 1,
            show: false,
          },
        });
        this._groomers.push(entity);
        this._groomerState.push({
          progress: Math.random(), // stagger initial positions
          liftIndex: 0,
          active: false,
        });
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _createGroomerPool error:', e);
    }
  }

  /** Creates SNOWGUN_POOL_SIZE blue billboard entities, all initially hidden. */
  _createSnowgunPool() {
    try {
      const entities = this._viewer.entities;
      // Build a small blue circle canvas for the gun icon
      const gunURI = this._buildSnowgunDataURI();
      for (let i = 0; i < SNOWGUN_POOL_SIZE; i++) {
        const entity = entities.add({
          position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
          billboard: {
            image: gunURI,
            width: 10,
            height: 10,
            color: new Cesium.Color(0.4, 0.7, 1.0, 0.85),
            scale: 1.0,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            show: false,
          },
        });
        this._snowguns.push(entity);
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _createSnowgunPool error:', e);
    }
  }

  // -------------------------------------------------------------------------
  // Private: snow particles
  // -------------------------------------------------------------------------

  /**
   * Update snow particle entities based on current weather state.
   * @param {{state: string, temperature?: number}} weather
   */
  _updateParticles(weather) {
    try {
      const state = (weather.state || '').toLowerCase();

      let activeCount = 0;
      let fallSpeed = 0.3;
      let horizontalDrift = 0;

      switch (state) {
        case 'light-snow':
          activeCount = 30;
          fallSpeed = 0.3;
          horizontalDrift = 0;
          break;
        case 'heavy-snow':
          activeCount = 60;
          fallSpeed = 0.6;
          horizontalDrift = 0.00005;
          break;
        case 'blizzard':
          activeCount = 80;
          fallSpeed = 1.1;
          horizontalDrift = 0.00015;
          break;
        default:
          // 'clear', 'overcast', or anything else – hide all particles
          this._hideAllParticles();
          return;
      }

      // Get camera position to anchor particles around the viewer
      const camera = this._viewer.camera;
      const carto = camera.positionCartographic;
      const camLon = Cesium.Math.toDegrees(carto.longitude);
      const camLat = Cesium.Math.toDegrees(carto.latitude);
      const camAlt = carto.height;

      for (let i = 0; i < SNOW_PARTICLE_POOL_SIZE; i++) {
        const entity = this._particles[i];
        const ps = this._particleState[i];

        if (i >= activeCount) {
          // This slot is beyond the active count – hide it
          if (ps.active) {
            entity.billboard.show = false;
            ps.active = false;
          }
          continue;
        }

        // Activate particle if not yet active (assign random spawn position)
        if (!ps.active) {
          ps.lon = camLon + randBetween(-PARTICLE_SPREAD_DEG, PARTICLE_SPREAD_DEG);
          ps.lat = camLat + randBetween(-PARTICLE_SPREAD_DEG, PARTICLE_SPREAD_DEG);
          ps.alt = camAlt + randBetween(0, PARTICLE_SPAWN_HEIGHT);
          ps.speed = fallSpeed * randBetween(0.6, 1.4);
          ps.drift = horizontalDrift * randBetween(-1, 1);
          ps.active = true;
          entity.billboard.show = true;
          // Randomise pixel size (4-8) and alpha (0.5-0.9) for visual variety
          entity.billboard.width = randBetween(4, 8);
          entity.billboard.height = entity.billboard.width;
          entity.billboard.color = new Cesium.Color(1, 1, 1, randBetween(0.5, 0.9));
        }

        // Advance particle downward (and drift horizontally for blizzard)
        ps.alt -= ps.speed;
        ps.lon += ps.drift;

        // If particle has fallen below ground / camera base, recycle it
        if (ps.alt < camAlt - 10) {
          ps.lon = camLon + randBetween(-PARTICLE_SPREAD_DEG, PARTICLE_SPREAD_DEG);
          ps.lat = camLat + randBetween(-PARTICLE_SPREAD_DEG, PARTICLE_SPREAD_DEG);
          ps.alt = camAlt + PARTICLE_SPAWN_HEIGHT + randBetween(0, 20);
          ps.speed = fallSpeed * randBetween(0.6, 1.4);
          ps.drift = horizontalDrift * randBetween(-1, 1);
        }

        // Update entity position
        try {
          entity.position = new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(ps.lon, ps.lat, ps.alt)
          );
        } catch (_) { /* position update failure is non-fatal */ }
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _updateParticles error:', e);
    }
  }

  /** Hides all particle entities and marks them inactive. */
  _hideAllParticles() {
    for (let i = 0; i < this._particles.length; i++) {
      const ps = this._particleState[i];
      if (ps.active) {
        this._particles[i].billboard.show = false;
        ps.active = false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: grooming machines
  // -------------------------------------------------------------------------

  /**
   * Update grooming machine entities.
   * @param {{groomingQuality?: number}} resort
   * @param {{hour?: number}} timeData
   */
  _updateGroomers(resort, timeData) {
    try {
      const hour = typeof timeData.hour === 'number' ? timeData.hour : 12;

      if (!isGroomingHour(hour)) {
        // Dawn has arrived – hide all groomers
        this._hideAllGroomers();
        return;
      }

      // Number of active groomers inversely related to groomingQuality.
      // groomingQuality is assumed 0-100; lower quality → more machines needed.
      const quality = typeof resort.groomingQuality === 'number'
        ? Math.max(0, Math.min(100, resort.groomingQuality))
        : 50;
      // Map quality 0→6 groomers, quality 100→1 groomer
      const activeGroomers = Math.max(1, Math.round(GROOMER_POOL_SIZE * (1 - quality / 100)) || 1);

      const liftCount = this._lifts.length;

      for (let i = 0; i < GROOMER_POOL_SIZE; i++) {
        const entity = this._groomers[i];
        const gs = this._groomerState[i];

        if (i >= activeGroomers || liftCount === 0) {
          if (gs.active) {
            entity.point.show = false;
            gs.active = false;
          }
          continue;
        }

        // Activate groomer if needed
        if (!gs.active) {
          gs.liftIndex = Math.floor(Math.random() * liftCount);
          gs.progress = 0;
          gs.active = true;
          entity.point.show = true;
        }

        // Advance progress along lift line
        gs.progress += GROOMER_SPEED;
        if (gs.progress > 1) {
          // Reached peak – recycle onto another random lift
          gs.liftIndex = Math.floor(Math.random() * liftCount);
          gs.progress = 0;
        }

        // Interpolate position between base and peak of the chosen lift
        const lift = this._lifts[gs.liftIndex];
        const position = this._lerpLiftPosition(lift, gs.progress);
        if (position) {
          try {
            entity.position = new Cesium.ConstantPositionProperty(position);
          } catch (_) { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _updateGroomers error:', e);
    }
  }

  /** Hides all groomer entities and marks them inactive. */
  _hideAllGroomers() {
    for (let i = 0; i < this._groomers.length; i++) {
      const gs = this._groomerState[i];
      if (gs.active) {
        this._groomers[i].point.show = false;
        gs.active = false;
      }
    }
  }

  /**
   * Interpolate a Cartesian3 position along a lift line.
   * @param {{base:{lat,lng,elevation}, peak:{lat,lng,elevation}}} lift
   * @param {number} t - progress 0..1
   * @returns {Cesium.Cartesian3|null}
   */
  _lerpLiftPosition(lift, t) {
    try {
      if (!lift || !lift.base || !lift.peak) return null;
      const base = Cesium.Cartesian3.fromDegrees(
        lift.base.lng, lift.base.lat, (lift.base.elevation || 0) + 1
      );
      const peak = Cesium.Cartesian3.fromDegrees(
        lift.peak.lng, lift.peak.lat, (lift.peak.elevation || 0) + 1
      );
      return Cesium.Cartesian3.lerp(base, peak, t, new Cesium.Cartesian3());
    } catch (e) {
      console.warn('[VisualEffectsRenderer] _lerpLiftPosition error:', e);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Private: snowmaking guns
  // -------------------------------------------------------------------------

  /**
   * Update snowmaking gun entities.
   * @param {{snowmaking?: boolean}} resort
   * @param {{temperature?: number}} weather
   */
  _updateSnowguns(resort, weather) {
    try {
      const snowmakingActive = !!resort.snowmaking;
      const temperature = typeof weather.temperature === 'number' ? weather.temperature : 0;
      const coldEnough = temperature < SNOWMAKING_TEMP_THRESHOLD;

      if (!snowmakingActive || !coldEnough || this._lifts.length === 0) {
        this._hideAllSnowguns();
        return;
      }

      // Advance pulse phase
      this._gunPhase += SNOWGUN_PULSE_SPEED;
      const pulseFraction = (Math.sin(this._gunPhase) + 1) / 2; // 0..1
      const pulseScale = SNOWGUN_SCALE_MIN + pulseFraction * (SNOWGUN_SCALE_MAX - SNOWGUN_SCALE_MIN);

      // Distribute guns along the major lift lines (first lifts in the array)
      // Each gun is placed at a fixed interval (every 1/5 of each lift length).
      let gunIndex = 0;
      const GUNS_PER_LIFT = Math.ceil(SNOWGUN_POOL_SIZE / Math.max(1, this._lifts.length));

      outer:
      for (let li = 0; li < this._lifts.length && gunIndex < SNOWGUN_POOL_SIZE; li++) {
        const lift = this._lifts[li];
        for (let seg = 0; seg < GUNS_PER_LIFT && gunIndex < SNOWGUN_POOL_SIZE; seg++) {
          const t = (seg + 0.5) / GUNS_PER_LIFT; // centre of each segment
          const position = this._lerpLiftPosition(lift, t);
          if (!position) continue;

          const entity = this._snowguns[gunIndex];
          entity.billboard.show = true;
          entity.billboard.scale = pulseScale;
          try {
            entity.position = new Cesium.ConstantPositionProperty(position);
          } catch (_) { /* non-fatal */ }
          gunIndex++;
        }
      }

      // Hide any remaining unused gun slots
      for (let i = gunIndex; i < SNOWGUN_POOL_SIZE; i++) {
        this._snowguns[i].billboard.show = false;
      }
    } catch (e) {
      console.error('[VisualEffectsRenderer] _updateSnowguns error:', e);
    }
  }

  /** Hides all snowmaking gun entities. */
  _hideAllSnowguns() {
    for (const entity of this._snowguns) {
      try {
        entity.billboard.show = false;
      } catch (_) { /* non-fatal */ }
    }
  }

  // -------------------------------------------------------------------------
  // Private: asset helpers
  // -------------------------------------------------------------------------

  /**
   * Build a small blue circle as a data URI for snowmaking gun billboards.
   * @returns {string}
   */
  _buildSnowgunDataURI() {
    try {
      const size = 16;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const cx = size / 2;
      const cy = size / 2;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
      gradient.addColorStop(0, 'rgba(160,220,255,1)');
      gradient.addColorStop(0.6, 'rgba(80,160,240,0.8)');
      gradient.addColorStop(1, 'rgba(40,100,200,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, cx, 0, Math.PI * 2);
      ctx.fill();
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[VisualEffectsRenderer] _buildSnowgunDataURI failed:', e);
      return this._snowflakeURI || '';
    }
  }
}
