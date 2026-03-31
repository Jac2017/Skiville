/**
 * EntityRenderer.js
 * Renders 3D game entities on a CesiumJS viewer for Skiville ski resort tycoon.
 * Handles lifts, buildings, run markers, snow particles, skiers, and village labels.
 */
import * as Cesium from 'cesium';

const SKIER_POOL_SIZE = 25;
const SNOW_PARTICLE_COUNT = 60;
const TOWER_INTERVAL_METERS = 200;

// Simple white circle data URI for snow particles
let _whiteCircle = null;
function getWhiteCircle() {
  if (_whiteCircle) return _whiteCircle;
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  _whiteCircle = c.toDataURL();
  return _whiteCircle;
}

export class EntityRenderer {
  constructor(viewer) {
    this._viewer = viewer;
    this._liftEntities = new Map();
    this._buildingEntities = new Map();
    this._runMarkerEntities = new Map();
    this._snowEntities = [];
    this._skierEntities = [];
    this._villageLabels = [];
    this._skierPaths = [];
    this._snowActive = false;
    this._onPostRender = this._onPostRender.bind(this);
  }

  init(resortData) {
    if (!this._viewer) return;

    const { lifts = [], buildings = [], runs = [] } = resortData;

    lifts.forEach(lift => this._createLift(lift));
    // buildings need coords to render - only add those that have lat/lng
    buildings.forEach(b => {
      if (b.coords?.lat || b.lat) this._createBuilding(b);
    });

    // Build skier paths from runs that have coordinate paths
    this._skierPaths = runs
      .filter(r => Array.isArray(r.path) && r.path.length >= 2 && r.path[0].lng)
      .map(r => ({ points: r.path }));

    if (this._skierPaths.length > 0) {
      this._initSkierPool();
    }

    // Create village labels
    this._createVillageLabel({ name: 'Whistler Village', lng: -122.9531, lat: 50.1145, alt: 675 });
    this._createVillageLabel({ name: 'Creekside', lng: -122.9640, lat: 50.0880, alt: 655 });
    this._createVillageLabel({ name: 'Upper Village', lng: -122.9470, lat: 50.1130, alt: 690 });

    try {
      this._viewer.scene.postRender.addEventListener(this._onPostRender);
    } catch (e) {
      console.warn('Could not attach post-render listener:', e);
    }
  }

  update(gameState = {}) {
    if (!this._viewer) return;

    // Update lift status colors
    const lifts = gameState.resort?.lifts || gameState.lifts || [];
    lifts.forEach(lift => {
      const group = this._liftEntities.get(lift.id);
      if (!group) return;
      const color = lift.status === 'open' ? Cesium.Color.LIME
        : lift.status === 'hold' ? Cesium.Color.ORANGE
        : Cesium.Color.RED;
      try {
        group.cable.polyline.material = new Cesium.PolylineDashMaterialProperty({
          color, dashLength: 16,
        });
        if (group.label.label) {
          group.label.label.show = lift.status === 'open';
        }
      } catch (e) { /* ignore update errors */ }
    });

    // Toggle snow
    const weather = gameState.weather || {};
    const isSnowing = weather.state === 'light-snow' || weather.state === 'heavy-snow' || weather.state === 'blizzard';
    if (isSnowing && !this._snowActive) this._startSnow();
    else if (!isSnowing && this._snowActive) this._stopSnow();
  }

  destroy() {
    if (!this._viewer) return;
    try {
      this._viewer.scene.postRender.removeEventListener(this._onPostRender);
      this._liftEntities.forEach(g => {
        this._viewer.entities.remove(g.cable);
        this._viewer.entities.remove(g.label);
        g.towers.forEach(t => this._viewer.entities.remove(t));
      });
      this._buildingEntities.forEach(e => this._viewer.entities.remove(e));
      this._runMarkerEntities.forEach(e => this._viewer.entities.remove(e));
      [...this._snowEntities, ...this._skierEntities, ...this._villageLabels]
        .forEach(e => this._viewer.entities.remove(e));
    } catch (e) { /* cleanup errors ok */ }
  }

  // ── Lifts ──

  _createLift(lift) {
    if (!this._viewer) return;
    // Support both lift.coords.base and lift.base formats
    const base = lift.coords?.base || lift.base;
    const peak = lift.coords?.peak || lift.peak;
    if (!base?.lat || !peak?.lat) return;

    try {
      const basePos = Cesium.Cartesian3.fromDegrees(base.lng, base.lat, base.alt || lift.baseElevation || 0);
      const peakPos = Cesium.Cartesian3.fromDegrees(peak.lng, peak.lat, peak.alt || lift.peakElevation || 0);
      const color = lift.status === 'open' ? Cesium.Color.LIME : Cesium.Color.RED;

      const cable = this._viewer.entities.add({
        polyline: {
          positions: [basePos, peakPos],
          width: 3,
          material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 16 }),
        },
      });

      const label = this._viewer.entities.add({
        position: basePos,
        label: {
          text: lift.name,
          font: '13px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: lift.status === 'open',
          scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 5000, 0.3),
        },
      });

      // Place towers along the lift line
      const towers = [];
      const distance = Cesium.Cartesian3.distance(basePos, peakPos);
      const count = Math.max(2, Math.floor(distance / TOWER_INTERVAL_METERS));
      for (let i = 1; i < count; i++) {
        const t = i / count;
        const pos = Cesium.Cartesian3.lerp(basePos, peakPos, t, new Cesium.Cartesian3());
        const tower = this._viewer.entities.add({
          position: pos,
          cylinder: {
            length: 12, topRadius: 0.4, bottomRadius: 0.8,
            material: Cesium.Color.GRAY,
          },
        });
        towers.push(tower);
      }

      this._liftEntities.set(lift.id, { cable, label, towers });
    } catch (e) {
      console.warn(`Failed to create lift ${lift.name}:`, e);
    }
  }

  // ── Buildings ──

  _createBuilding(b) {
    if (!this._viewer) return;
    const lat = b.coords?.lat || b.lat;
    const lng = b.coords?.lng || b.lng;
    if (!lat || !lng) return;

    // Determine type for sizing/coloring
    let dims, color;
    if (b.rooms || b.type === 'luxury' || b.type === 'mid-range' || b.type === 'budget') {
      dims = new Cesium.Cartesian3(40, 40, 20);
      color = Cesium.Color.fromCssColorString('#4488CC').withAlpha(0.85);
    } else if (b.type === 'fine-dining' || b.type === 'casual' || b.type === 'on-mountain' || b.type === 'fast-food') {
      dims = new Cesium.Cartesian3(20, 20, 8);
      color = Cesium.Color.fromCssColorString('#E8882A').withAlpha(0.85);
    } else if (b.type === 'apres-ski' || b.type === 'nightclub' || b.type === 'pub') {
      dims = new Cesium.Cartesian3(18, 18, 8);
      color = Cesium.Color.fromCssColorString('#8844BB').withAlpha(0.85);
    } else {
      dims = new Cesium.Cartesian3(14, 14, 6);
      color = Cesium.Color.fromCssColorString('#44AA55').withAlpha(0.85);
    }

    try {
      const entity = this._viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 0),
        box: {
          dimensions: dims,
          material: color,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: b.name || '',
          font: '11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -24),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(300, 1.0, 3000, 0.0),
        },
      });
      this._buildingEntities.set(b.id, entity);
    } catch (e) {
      console.warn(`Failed to create building ${b.name}:`, e);
    }
  }

  // ── Village Labels ──

  _createVillageLabel(village) {
    if (!this._viewer) return;
    try {
      const entity = this._viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(village.lng, village.lat, (village.alt || 0) + 50),
        label: {
          text: village.name,
          font: 'bold 18px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#003366'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          translucencyByDistance: new Cesium.NearFarScalar(1000, 1.0, 8000, 0.0),
        },
      });
      this._villageLabels.push(entity);
    } catch (e) {
      console.warn(`Failed to create village label:`, e);
    }
  }

  // ── Snow Particles ──

  _startSnow() {
    if (this._snowActive || !this._viewer) return;
    this._snowActive = true;

    try {
      const cam = this._viewer.camera;
      const camLng = Cesium.Math.toDegrees(cam.positionCartographic.longitude);
      const camLat = Cesium.Math.toDegrees(cam.positionCartographic.latitude);
      const camAlt = cam.positionCartographic.height || 2000;

      for (let i = 0; i < SNOW_PARTICLE_COUNT; i++) {
        const lng = camLng + (Math.random() - 0.5) * 0.015;
        const lat = camLat + (Math.random() - 0.5) * 0.015;
        const alt = camAlt + (Math.random() - 0.3) * 800;

        const entity = this._viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
          billboard: {
            image: getWhiteCircle(),
            width: 6, height: 6,
            color: Cesium.Color.WHITE.withAlpha(0.75),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          _snow: {
            lng, lat, alt,
            fallSpeed: 0.5 + Math.random() * 1.2,
            driftX: (Math.random() - 0.5) * 0.00003,
            driftY: (Math.random() - 0.5) * 0.00003,
            resetAlt: alt,
            floorAlt: alt - 700,
          },
        });
        this._snowEntities.push(entity);
      }
    } catch (e) {
      console.warn('Snow particle creation failed:', e);
    }
  }

  _stopSnow() {
    this._snowActive = false;
    this._snowEntities.forEach(e => {
      try { this._viewer.entities.remove(e); } catch (_) {}
    });
    this._snowEntities = [];
  }

  // ── Animated Skiers ──

  _initSkierPool() {
    if (!this._viewer || this._skierPaths.length === 0) return;

    for (let i = 0; i < SKIER_POOL_SIZE; i++) {
      const pathIndex = i % this._skierPaths.length;
      const pt = this._interpolatePath(this._skierPaths[pathIndex].points, Math.random());

      try {
        const entity = this._viewer.entities.add({
          position: Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.alt || 0),
          point: {
            pixelSize: 5,
            color: Cesium.Color.fromCssColorString('#00EEFF').withAlpha(0.9),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          _skier: {
            pathIndex,
            progress: Math.random(),
            speed: 0.0008 + Math.random() * 0.0012,
          },
        });
        this._skierEntities.push(entity);
      } catch (e) { /* skip this skier */ }
    }
  }

  _interpolatePath(points, t) {
    if (!points || points.length === 0) return { lng: 0, lat: 0, alt: 0 };
    if (points.length === 1) return points[0];
    const ct = Math.max(0, Math.min(1, t));
    const scaled = ct * (points.length - 1);
    const idx = Math.floor(scaled);
    const frac = scaled - idx;
    if (idx >= points.length - 1) return points[points.length - 1];
    const a = points[idx], b = points[idx + 1];
    return {
      lng: a.lng + (b.lng - a.lng) * frac,
      lat: a.lat + (b.lat - a.lat) * frac,
      alt: (a.alt || 0) + ((b.alt || 0) - (a.alt || 0)) * frac,
    };
  }

  // ── Per-frame ──

  _onPostRender() {
    try {
      this._updateSkiers();
      if (this._snowActive) this._updateSnow();
    } catch (e) { /* silent */ }
  }

  _updateSkiers() {
    this._skierEntities.forEach(entity => {
      const s = entity._skier;
      if (!s) return;
      s.progress += s.speed;
      if (s.progress > 1) {
        s.progress = 0;
        s.pathIndex = Math.floor(Math.random() * this._skierPaths.length);
      }
      const path = this._skierPaths[s.pathIndex];
      if (!path) return;
      const pt = this._interpolatePath(path.points, s.progress);
      entity.position = Cesium.Cartesian3.fromDegrees(pt.lng, pt.lat, pt.alt || 0);
    });
  }

  _updateSnow() {
    const cam = this._viewer.camera;
    const camLng = Cesium.Math.toDegrees(cam.positionCartographic.longitude);
    const camLat = Cesium.Math.toDegrees(cam.positionCartographic.latitude);
    const camAlt = cam.positionCartographic.height || 2000;

    this._snowEntities.forEach(entity => {
      const s = entity._snow;
      if (!s) return;
      s.alt -= s.fallSpeed;
      s.lng += s.driftX;
      s.lat += s.driftY;
      if (s.alt < s.floorAlt) {
        s.alt = camAlt + (Math.random() - 0.3) * 600;
        s.lng = camLng + (Math.random() - 0.5) * 0.015;
        s.lat = camLat + (Math.random() - 0.5) * 0.015;
        s.floorAlt = s.alt - 600;
      }
      entity.position = Cesium.Cartesian3.fromDegrees(s.lng, s.lat, s.alt);
    });
  }
}
