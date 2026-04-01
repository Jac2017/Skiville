/**
 * RunRenderer.js
 *
 * Renders ski-run polylines and name labels in a CesiumJS viewer.
 *
 * Usage:
 *   import { RunRenderer } from './rendering/RunRenderer.js';
 *
 *   const renderer = new RunRenderer(viewer);
 *   renderer.init(runCoordsMap, runs);
 *
 *   // Later, react to game-state changes:
 *   renderer.update(gameState);
 *
 *   // On teardown:
 *   renderer.destroy();
 *
 * Difficulty colour palette
 * ─────────────────────────
 *   green        #4caf50
 *   blue         #2196f3
 *   black        #666666
 *   double-black #ef5350
 *
 * Each run is rendered as a ground-clamped PolylineGlow entity plus a
 * BillboardGraphics-free label pinned to the topmost waypoint.
 */

import * as Cesium from 'cesium';

// ─── constants ────────────────────────────────────────────────────────────────

/** CSS hex → Cesium.Color mapping for each difficulty tier. */
const DIFFICULTY_COLORS = {
  green:          '#4caf50',
  blue:           '#2196f3',
  black:          '#666666',
  'double-black': '#ef5350',
};

/** Fallback colour for unrecognised difficulty strings. */
const FALLBACK_COLOR_HEX = '#ffffff';

/** PolylineGlow parameters. */
const GLOW_POWER    = 0.2;
const LINE_WIDTH_PX = 5;       // pixels; used as both width and glowWidth base

/**
 * Alpha applied to closed runs so they appear visually dimmed but still
 * visible (helps the player identify runs that need attention).
 */
const CLOSED_RUN_ALPHA = 0.35;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a CSS hex colour string (e.g. "#4caf50") to a Cesium.Color.
 * Falls back to white on parse failure rather than throwing.
 *
 * @param {string} hex
 * @returns {Cesium.Color}
 */
function hexToColor(hex) {
  try {
    return Cesium.Color.fromCssColorString(hex);
  } catch {
    return Cesium.Color.WHITE;
  }
}

/**
 * Convert an array of {lat, lng, alt} waypoints to a Cesium.Cartesian3 array.
 * Waypoints that contain non-finite numbers are silently skipped.
 *
 * @param {Array<{lat: number, lng: number, alt: number}>} waypoints
 * @returns {Cesium.Cartesian3[]}
 */
function waypointsToCartesian(waypoints) {
  const positions = [];
  for (const wp of waypoints) {
    if (
      typeof wp.lat !== 'number' || !isFinite(wp.lat) ||
      typeof wp.lng !== 'number' || !isFinite(wp.lng)
    ) {
      continue;
    }
    const alt = typeof wp.alt === 'number' && isFinite(wp.alt) ? wp.alt : 0;
    try {
      positions.push(
        Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, alt)
      );
    } catch {
      // Skip bad waypoints gracefully.
    }
  }
  return positions;
}

// ─── class ────────────────────────────────────────────────────────────────────

export class RunRenderer {
  /**
   * @param {Cesium.Viewer} viewer - The CesiumJS Viewer instance.
   */
  constructor(viewer) {
    /** @type {Cesium.Viewer | null} */
    this._viewer = viewer ?? null;

    /**
     * Stores the Cesium entities created for each run, keyed by run ID.
     * Each entry holds the polyline entity and (optionally) the label entity.
     *
     * @type {Map<string, { line: Cesium.Entity, label: Cesium.Entity | null, run: Object }>}
     */
    this._entities = new Map();

    /** Tracks whether init() has been called. */
    this._initialised = false;
  }

  // ── public API ─────────────────────────────────────────────────────────────

  /**
   * Create Cesium entities for all runs that have coordinate data.
   *
   * Calling init() a second time will destroy all previously created entities
   * before re-creating them, so it is safe to call with updated data.
   *
   * @param {Map<string, Array<{lat: number, lng: number, alt: number}>>} runCoordsMap
   *   Map produced by generateRunCoords().
   * @param {Array<Object>} runs
   *   The raw run objects from runs.js — needed for name, difficulty, status.
   */
  init(runCoordsMap, runs) {
    // Clean up any previously created entities first.
    if (this._initialised) {
      this.destroy();
    }

    if (!this._viewer) {
      console.warn('[RunRenderer] init() called with no viewer — cannot create entities.');
      return;
    }

    if (!(runCoordsMap instanceof Map)) {
      console.warn('[RunRenderer] init() expects a Map as first argument.');
      return;
    }

    if (!Array.isArray(runs)) {
      console.warn('[RunRenderer] init() expects an Array as second argument.');
      return;
    }

    // Build a quick lookup so we can find run metadata by ID.
    const runById = new Map();
    for (const run of runs) {
      if (run && run.id) {
        runById.set(run.id, run);
      }
    }

    for (const [runId, waypoints] of runCoordsMap) {
      const run = runById.get(runId);
      if (!run) {
        // Coords exist but no matching run metadata — skip gracefully.
        continue;
      }

      if (!Array.isArray(waypoints) || waypoints.length < 2) {
        console.warn(`[RunRenderer] Run "${runId}" has fewer than 2 waypoints — skipping.`);
        continue;
      }

      try {
        this._createRunEntities(run, waypoints);
      } catch (err) {
        console.error(`[RunRenderer] Failed to create entities for run "${runId}":`, err);
      }
    }

    this._initialised = true;
  }

  /**
   * Show/hide and restyle runs to reflect the current game state.
   *
   * Expected gameState shape (all fields optional — missing fields are ignored):
   * {
   *   runs: {
   *     [runId]: {
   *       status: 'open' | 'closed' | 'grooming' | string,
   *       // ...other fields
   *     }
   *   }
   * }
   *
   * Behaviour:
   *   - 'open'     → fully visible at normal opacity
   *   - 'closed'   → visible but dimmed (CLOSED_RUN_ALPHA)
   *   - 'grooming' → treated the same as 'closed' (visible but dimmed)
   *   - anything else (unknown status) → fully visible (fail-open)
   *
   * @param {Object} gameState
   */
  update(gameState) {
    if (!this._viewer) return;
    if (!gameState || typeof gameState !== 'object') return;

    const stateByRun = gameState.runs ?? {};

    for (const [runId, entry] of this._entities) {
      const runState = stateByRun[runId];
      const status   = runState?.status ?? entry.run?.status ?? 'open';

      try {
        this._applyRunStatus(entry, status);
      } catch (err) {
        console.error(`[RunRenderer] update() failed for run "${runId}":`, err);
      }
    }
  }

  /**
   * Remove all entities from the viewer and clear internal state.
   * Safe to call even if init() has not been called or viewer is null.
   */
  destroy() {
    if (!this._viewer) {
      this._entities.clear();
      this._initialised = false;
      return;
    }

    for (const [runId, entry] of this._entities) {
      try {
        if (entry.line && !entry.line.isDestroyed()) {
          this._viewer.entities.remove(entry.line);
        }
      } catch (err) {
        console.warn(`[RunRenderer] Could not remove line entity for "${runId}":`, err);
      }

      try {
        if (entry.label && !entry.label.isDestroyed()) {
          this._viewer.entities.remove(entry.label);
        }
      } catch (err) {
        console.warn(`[RunRenderer] Could not remove label entity for "${runId}":`, err);
      }
    }

    this._entities.clear();
    this._initialised = false;
  }

  // ── private helpers ────────────────────────────────────────────────────────

  /**
   * Create the polyline and label entities for a single run and store them.
   *
   * @param {Object} run       - Run metadata object.
   * @param {Array}  waypoints - Array of {lat, lng, alt} waypoints.
   */
  _createRunEntities(run, waypoints) {
    const positions = waypointsToCartesian(waypoints);
    if (positions.length < 2) {
      console.warn(`[RunRenderer] Could not convert waypoints to Cartesian3 for "${run.id}".`);
      return;
    }

    const colorHex = DIFFICULTY_COLORS[run.difficulty] ?? FALLBACK_COLOR_HEX;
    const baseColor = hexToColor(colorHex);

    // ── polyline entity ──────────────────────────────────────────────────────
    let lineEntity = null;
    try {
      lineEntity = this._viewer.entities.add({
        id:          `run-line-${run.id}`,
        name:        run.name ?? run.id,
        description: this._buildDescription(run),
        polyline: {
          positions,
          width:          LINE_WIDTH_PX,
          clampToGround:  true,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: GLOW_POWER,
            color:     baseColor,
          }),
          // Tapered outline for better visibility against terrain
          depthFailMaterial: new Cesium.PolylineGlowMaterialProperty({
            glowPower: GLOW_POWER,
            color:     baseColor.withAlpha(0.4),
          }),
        },
      });
    } catch (err) {
      console.error(`[RunRenderer] Failed to add polyline entity for "${run.id}":`, err);
      return;
    }

    // ── label entity ─────────────────────────────────────────────────────────
    // Place the label at the first waypoint (topmost — run starts at the peak).
    let labelEntity = null;
    try {
      const topWaypoint = waypoints[0];
      const labelPos = Cesium.Cartesian3.fromDegrees(
        topWaypoint.lng,
        topWaypoint.lat,
        (typeof topWaypoint.alt === 'number' ? topWaypoint.alt : 0) + 20
      );

      labelEntity = this._viewer.entities.add({
        id:       `run-label-${run.id}`,
        position: labelPos,
        label: {
          text:                run.name ?? run.id,
          font:                '12px sans-serif',
          fillColor:           Cesium.Color.WHITE,
          outlineColor:        Cesium.Color.BLACK,
          outlineWidth:        2,
          style:               Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin:      Cesium.VerticalOrigin.BOTTOM,
          horizontalOrigin:    Cesium.HorizontalOrigin.CENTER,
          pixelOffset:         new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          // Scale down when far away to avoid label clutter.
          scaleByDistance:     new Cesium.NearFarScalar(500, 1.0, 10_000, 0.4),
          translucencyByDistance: new Cesium.NearFarScalar(8_000, 1.0, 15_000, 0.0),
        },
      });
    } catch (err) {
      // Labels are non-critical; log but continue.
      console.warn(`[RunRenderer] Failed to add label entity for "${run.id}":`, err);
    }

    // ── store ────────────────────────────────────────────────────────────────
    this._entities.set(run.id, {
      line:  lineEntity,
      label: labelEntity,
      run,
    });

    // Apply the run's initial status from its own data.
    this._applyRunStatus(this._entities.get(run.id), run.status ?? 'open');
  }

  /**
   * Show/hide and restyle a run's entities based on a status string.
   *
   * @param {{ line: Cesium.Entity, label: Cesium.Entity|null, run: Object }} entry
   * @param {string} status
   */
  _applyRunStatus(entry, status) {
    if (!entry) return;

    const isClosed = status === 'closed' || status === 'grooming';

    // Visibility
    if (entry.line) {
      try {
        entry.line.show = true; // always keep in scene; use alpha for dimming
      } catch { /* entity may have been removed externally */ }
    }
    if (entry.label) {
      try {
        // Hide label entirely when closed to reduce visual noise.
        entry.label.show = !isClosed;
      } catch { /* label entity may be unavailable */ }
    }

    // Material alpha to signal open vs closed state.
    if (entry.line?.polyline?.material) {
      try {
        const colorHex  = DIFFICULTY_COLORS[entry.run?.difficulty] ?? FALLBACK_COLOR_HEX;
        const baseColor = hexToColor(colorHex);
        const finalColor = isClosed
          ? baseColor.withAlpha(CLOSED_RUN_ALPHA)
          : baseColor;

        entry.line.polyline.material = new Cesium.PolylineGlowMaterialProperty({
          glowPower: isClosed ? GLOW_POWER * 0.5 : GLOW_POWER,
          color:     finalColor,
        });
      } catch (err) {
        console.warn('[RunRenderer] Could not update material for run:', err);
      }
    }
  }

  /**
   * Build a simple HTML description string for the entity's info-box.
   *
   * @param {Object} run
   * @returns {string}
   */
  _buildDescription(run) {
    const difficulty = run.difficulty ?? 'unknown';
    const drop       = run.verticalDrop != null ? `${run.verticalDrop} m` : '—';
    const length     = run.length       != null ? `${run.length} m`       : '—';
    const groomed    = run.groomed ? 'Yes' : 'No';
    const status     = run.status ?? '—';

    return (
      `<table class="cesium-infoBox-defaultTable">` +
      `<tr><td>Difficulty</td><td>${difficulty}</td></tr>` +
      `<tr><td>Vertical Drop</td><td>${drop}</td></tr>` +
      `<tr><td>Length</td><td>${length}</td></tr>` +
      `<tr><td>Groomed</td><td>${groomed}</td></tr>` +
      `<tr><td>Status</td><td>${status}</td></tr>` +
      `</table>`
    );
  }
}
