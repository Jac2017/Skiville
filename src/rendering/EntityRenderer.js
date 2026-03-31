/**
 * EntityRenderer.js
 * Renders 3D game entities on a CesiumJS viewer for Skiville ski resort tycoon.
 * Handles lifts, towers, buildings, run markers, snow particles, skiers, and village labels.
 */

import * as Cesium from 'cesium';

// Lift status color map
const LIFT_STATUS_COLORS = {
  open:    Cesium.Color.GREEN,
  closed:  Cesium.Color.RED,
  'on-hold': Cesium.Color.fromCssColorString('#FF8C00'), // orange
};

// Difficulty color map for ski runs
const RUN_DIFFICULTY_COLORS = {
  green:        Cesium.Color.GREEN,
  blue:         Cesium.Color.CYAN,
  black:        Cesium.Color.BLACK,
  'double-black': Cesium.Color.RED,
};

// Building appearance config
const BUILDING_CONFIG = {
  hotel: {
    dimensions: new Cesium.Cartesian3(40, 40, 20),
    color: Cesium.Color.fromCssColorString('#4488CC').withAlpha(0.85),
  },
  restaurant: {
    dimensions: new Cesium.Cartesian3(20, 20, 8),
    color: Cesium.Color.fromCssColorString('#E8882A').withAlpha(0.85),
  },
  bar: {
    dimensions: new Cesium.Cartesian3(18, 18, 8),
    color: Cesium.Color.fromCssColorString('#8844BB').withAlpha(0.85),
  },
  shop: {
    dimensions: new Cesium.Cartesian3(14, 14, 6),
    color: Cesium.Color.fromCssColorString('#44AA55').withAlpha(0.85),
  },
};

// Simple white circle data URI used for snow and skier point billboards
const WHITE_CIRCLE_DATA_URI = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  return canvas.toDataURL();
})();

const SKIER_POOL_SIZE = 25;
const SNOW_PARTICLE_COUNT = 60;
const TOWER_INTERVAL_METERS = 200; // approximate spacing between towers along a lift line

export class EntityRenderer {
  /**
   * @param {Cesium.Viewer} viewer - An initialised CesiumJS Viewer instance.
   */
  constructor(viewer) {
    this._viewer = viewer;

    // Tracked entity arrays / maps for lifecycle management
    this._liftEntities    = new Map(); // liftId -> { cable, label, towers: [] }
    this._buildingEntities = new Map(); // buildingId -> entity
    this._runMarkerEntities = new Map(); // runId -> entity
    this._snowEntities    = [];
    this._skierEntities   = [];
    this._villageLabels   = [];

    // Runtime state
    this._skierPaths = [];  // [{points, progress, speed}]
    this._snowActive = false;
    this._snowPhase  = 0;   // drives vertical oscillation

    // Bind the per-frame callback so we can remove it later
    this._onPostRender = this._onPostRender.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create all initial entities from resort data.
   * @param {Object} resortData
   * @param {Array}  resortData.lifts      - Array of lift definitions
   * @param {Array}  resortData.buildings  - Array of building definitions
   * @param {Array}  resortData.runs       - Array of ski run definitions
   * @param {Array}  [resortData.villages] - Optional village area definitions
   */
  init(resortData) {
    const { lifts = [], buildings = [], runs = [], villages = [] } = resortData;

    lifts.forEach(lift       => this._createLift(lift));
    buildings.forEach(b      => this._createBuilding(b));
    runs.forEach(run         => this._createRunMarker(run));
    villages.forEach(village => this._createVillageLabel(village));

    // Build skier paths from run data and seed the pool
    this._skierPaths = runs
      .filter(run => Array.isArray(run.path) && run.path.length >= 2)
      .map(run => ({ points: run.path, progress: Math.random() }));

    this._initSkierPool();

    // Hook into the viewer's post-render event for per-frame updates
    this._viewer.scene.postRender.addEventListener(this._onPostRender);
  }

  /**
   * Update entity visibility, colors, and animations based on current game state.
   * Call this once per game tick (not necessarily every frame).
   * @param {Object} gameState
   * @param {Array}  [gameState.lifts]    - Updated lift statuses
   * @param {Object} [gameState.weather]  - Weather info including snow flag
   */
  update(gameState = {}) {
    const { lifts = [], weather = {} } = gameState;

    // Update lift cable colours and label visibility
    lifts.forEach(lift => {
      const group = this._liftEntities.get(lift.id);
      if (!group) return;

      const color = LIFT_STATUS_COLORS[lift.status] || Cesium.Color.WHITE;

      group.cable.polyline.material = new Cesium.PolylineDashMaterialProperty({
        color,
        dashLength: 16,
      });

      // Show label only for open lifts
      group.label.label.show = new Cesium.ConstantProperty(lift.status === 'open');
    });

    // Toggle snow particles
    const shouldSnow = !!(weather.snow);
    if (shouldSnow !== this._snowActive) {
      shouldSnow ? this._startSnow() : this._stopSnow();
    }
  }

  /**
   * Remove all entities created by this renderer and detach event listeners.
   */
  destroy() {
    this._viewer.scene.postRender.removeEventListener(this._onPostRender);

    // Remove lift entities
    this._liftEntities.forEach(group => {
      this._viewer.entities.remove(group.cable);
      this._viewer.entities.remove(group.label);
      group.towers.forEach(t => this._viewer.entities.remove(t));
    });
    this._liftEntities.clear();

    // Remove building entities
    this._buildingEntities.forEach(e => this._viewer.entities.remove(e));
    this._buildingEntities.clear();

    // Remove run marker entities
    this._runMarkerEntities.forEach(e => this._viewer.entities.remove(e));
    this._runMarkerEntities.clear();

    // Remove snow, skiers, village labels
    [...this._snowEntities, ...this._skierEntities, ...this._villageLabels]
      .forEach(e => this._viewer.entities.remove(e));

    this._snowEntities   = [];
    this._skierEntities  = [];
    this._villageLabels  = [];
    this._skierPaths     = [];
    this._snowActive     = false;
  }

  // ---------------------------------------------------------------------------
  // Lift rendering
  // ---------------------------------------------------------------------------

  _createLift(lift) {
    // lift: { id, name, status, base: {lng,lat,alt}, peak: {lng,lat,alt} }
    const basePos = Cesium.Cartesian3.fromDegrees(lift.base.lng, lift.base.lat, lift.base.alt ?? 0);
    const peakPos = Cesium.Cartesian3.fromDegrees(lift.peak.lng, lift.peak.lat, lift.peak.alt ?? 0);

    const initialColor = LIFT_STATUS_COLORS[lift.status] || Cesium.Color.WHITE;

    // Cable polyline
    const cable = this._viewer.entities.add({
      name: `lift-cable-${lift.id}`,
      polyline: {
        positions: [basePos, peakPos],
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({
          color: initialColor,
          dashLength: 16,
        }),
        clampToGround: false,
      },
    });

    // Base station billboard label
    const label = this._viewer.entities.add({
      name: `lift-label-${lift.id}`,
      position: basePos,
      billboard: {
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.8,
      },
      label: {
        text: lift.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -8),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        show: lift.status === 'open',
      },
    });

    // Towers evenly spaced along the line
    const towers = this._placeLiftTowers(basePos, peakPos);

    this._liftEntities.set(lift.id, { cable, label, towers });
  }

  /**
   * Place cylinder entities at regular intervals between two Cartesian3 points.
   * @returns {Cesium.Entity[]}
   */
  _placeLiftTowers(basePos, peakPos) {
    const towers = [];

    // Estimate number of towers based on distance
    const distance = Cesium.Cartesian3.distance(basePos, peakPos);
    const count = Math.max(2, Math.floor(distance / TOWER_INTERVAL_METERS));

    for (let i = 1; i < count; i++) {
      const t = i / count;
      const pos = Cesium.Cartesian3.lerp(basePos, peakPos, t, new Cesium.Cartesian3());

      const tower = this._viewer.entities.add({
        position: pos,
        cylinder: {
          length: 12,
          topRadius: 0.4,
          bottomRadius: 0.8,
          material: new Cesium.ColorMaterialProperty(
            Cesium.Color.fromCssColorString('#888888')
          ),
          outline: false,
        },
      });

      towers.push(tower);
    }

    return towers;
  }

  // ---------------------------------------------------------------------------
  // Building rendering
  // ---------------------------------------------------------------------------

  _createBuilding(building) {
    // building: { id, type, name, lng, lat, alt }
    const cfg = BUILDING_CONFIG[building.type] || BUILDING_CONFIG.shop;
    const pos = Cesium.Cartesian3.fromDegrees(
      building.lng,
      building.lat,
      (building.alt ?? 0) + cfg.dimensions.z / 2
    );

    const entity = this._viewer.entities.add({
      name: building.name || `building-${building.id}`,
      position: pos,
      box: {
        dimensions: cfg.dimensions,
        material: new Cesium.ColorMaterialProperty(cfg.color),
        outline: true,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.4),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: building.name || '',
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -cfg.dimensions.z - 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });

    this._buildingEntities.set(building.id, entity);
  }

  // ---------------------------------------------------------------------------
  // Ski run markers
  // ---------------------------------------------------------------------------

  _createRunMarker(run) {
    // run: { id, name, difficulty, path: [{lng,lat,alt}, ...] }
    if (!run.path || run.path.length === 0) return;

    const start = run.path[0];
    const color = RUN_DIFFICULTY_COLORS[run.difficulty] || Cesium.Color.WHITE;

    const pos = Cesium.Cartesian3.fromDegrees(start.lng, start.lat, start.alt ?? 0);

    const entity = this._viewer.entities.add({
      name: `run-marker-${run.id}`,
      position: pos,
      label: {
        text: `${run.name}\n[${run.difficulty ?? '?'}]`,
        font: 'bold 13px sans-serif',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        pixelOffset: new Cesium.Cartesian2(0, -6),
      },
    });

    this._runMarkerEntities.set(run.id, entity);
  }

  // ---------------------------------------------------------------------------
  // Village labels
  // ---------------------------------------------------------------------------

  _createVillageLabel(village) {
    // village: { name, lng, lat, alt }
    const pos = Cesium.Cartesian3.fromDegrees(village.lng, village.lat, (village.alt ?? 0) + 50);

    const entity = this._viewer.entities.add({
      name: `village-${village.name}`,
      position: pos,
      label: {
        text: village.name,
        font: 'bold 18px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.fromCssColorString('#003366'),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        translucencyByDistance: new Cesium.NearFarScalar(1000, 1.0, 8000, 0.0),
      },
    });

    this._villageLabels.push(entity);
  }

  // ---------------------------------------------------------------------------
  // Snow particles
  // ---------------------------------------------------------------------------

  _startSnow() {
    if (this._snowActive) return;
    this._snowActive = true;

    const camera = this._viewer.camera;

    for (let i = 0; i < SNOW_PARTICLE_COUNT; i++) {
      // Spread particles in a dome around the current camera position
      const spread = 800;
      const lng = Cesium.Math.toDegrees(camera.positionCartographic.longitude)
        + (Math.random() - 0.5) * 0.015;
      const lat = Cesium.Math.toDegrees(camera.positionCartographic.latitude)
        + (Math.random() - 0.5) * 0.015;
      const alt = (camera.positionCartographic.height ?? 2000)
        + (Math.random() - 0.3) * spread;

      const entity = this._viewer.entities.add({
        position: new Cesium.CallbackProperty(() => {
          // Actual position driven by _onPostRender; initial placement here
          return Cesium.Cartesian3.fromDegrees(lng, lat, alt);
        }, false),
        billboard: {
          image: WHITE_CIRCLE_DATA_URI,
          width: 6,
          height: 6,
          color: Cesium.Color.WHITE.withAlpha(0.75),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          sizeInMeters: false,
        },
        // Stash mutable state on the entity for use in _onPostRender
        _snow: {
          lng,
          lat,
          alt,
          fallSpeed: 0.5 + Math.random() * 1.2,  // meters per frame
          driftX: (Math.random() - 0.5) * 0.00003,
          driftY: (Math.random() - 0.5) * 0.00003,
          resetAlt: alt,
          floorAlt: alt - spread * 0.9,
        },
      });

      this._snowEntities.push(entity);
    }
  }

  _stopSnow() {
    this._snowActive = false;
    this._snowEntities.forEach(e => this._viewer.entities.remove(e));
    this._snowEntities = [];
  }

  // ---------------------------------------------------------------------------
  // Animated skiers
  // ---------------------------------------------------------------------------

  _initSkierPool() {
    if (this._skierPaths.length === 0) return;

    for (let i = 0; i < SKIER_POOL_SIZE; i++) {
      const pathIndex = i % this._skierPaths.length;
      const pathState = this._skierPaths[pathIndex];
      const startPt   = this._interpolatePath(pathState.points, Math.random());

      const entity = this._viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(startPt.lng, startPt.lat, startPt.alt ?? 0),
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromCssColorString('#00EEFF').withAlpha(0.9),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        // Mutable state stashed directly on the entity object
        _skier: {
          pathIndex,
          progress: Math.random(),
          speed: 0.0008 + Math.random() * 0.0012, // progress units per frame
        },
      });

      this._skierEntities.push(entity);
    }
  }

  /**
   * Interpolate a coordinate along a path (array of {lng,lat,alt} waypoints).
   * @param {Array}  points  - Waypoints
   * @param {number} t       - 0..1 progress along total path length
   * @returns {{lng, lat, alt}}
   */
  _interpolatePath(points, t) {
    if (points.length === 1) return points[0];
    const clampedT = Math.max(0, Math.min(1, t));
    const scaled   = clampedT * (points.length - 1);
    const idx      = Math.floor(scaled);
    const frac     = scaled - idx;

    if (idx >= points.length - 1) return points[points.length - 1];

    const a = points[idx];
    const b = points[idx + 1];
    return {
      lng: a.lng + (b.lng - a.lng) * frac,
      lat: a.lat + (b.lat - a.lat) * frac,
      alt: ((a.alt ?? 0) + ((b.alt ?? 0) - (a.alt ?? 0)) * frac),
    };
  }

  // ---------------------------------------------------------------------------
  // Per-frame post-render callback
  // ---------------------------------------------------------------------------

  _onPostRender() {
    this._updateSkiers();
    if (this._snowActive) this._updateSnow();
  }

  _updateSkiers() {
    this._skierEntities.forEach(entity => {
      const state = entity._skier;
      if (!state) return;

      const pathState = this._skierPaths[state.pathIndex];
      if (!pathState) return;

      state.progress += state.speed;
      if (state.progress > 1) {
        // Wrap back to the top and pick a random run
        state.progress = 0;
        state.pathIndex = Math.floor(Math.random() * this._skierPaths.length);
      }

      const pt = this._interpolatePath(
        this._skierPaths[state.pathIndex].points,
        state.progress
      );

      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.alt ?? 0)
      );
    });
  }

  _updateSnow() {
    this._snowPhase += 0.02;
    const camera = this._viewer.camera;
    const camLng = Cesium.Math.toDegrees(camera.positionCartographic.longitude);
    const camLat = Cesium.Math.toDegrees(camera.positionCartographic.latitude);
    const camAlt = camera.positionCartographic.height ?? 2000;

    this._snowEntities.forEach(entity => {
      const s = entity._snow;
      if (!s) return;

      s.alt -= s.fallSpeed;
      s.lng += s.driftX;
      s.lat += s.driftY;

      // Recycle snowflake back to top when it hits the floor
      if (s.alt < s.floorAlt) {
        s.alt   = s.resetAlt;
        s.lng   = camLng + (Math.random() - 0.5) * 0.015;
        s.lat   = camLat + (Math.random() - 0.5) * 0.015;
        s.resetAlt = camAlt + (Math.random() - 0.3) * 600;
        s.floorAlt = s.resetAlt - 600 * 0.9;
      }

      entity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(s.lng, s.lat, s.alt)
      );
    });
  }
}
