/**
 * runCoords.js
 *
 * Generates GPS waypoints for ski runs based on lift GPS data.
 *
 * Runs have no coordinates of their own — only a liftAccess ID and physical
 * stats (verticalDrop, length).  This module uses those stats together with
 * the lift's base/peak GPS positions and elevations to synthesise a realistic
 * path for each run.
 *
 * Exported function:
 *   generateRunCoords(lifts, runs) → Map<runId, Array<{lat, lng, alt}>>
 *
 * Algorithm overview
 * ──────────────────
 *  1. Build a lookup map of lifts by ID.
 *  2. For each run, find the corresponding lift.
 *  3. Compute a coverage fraction: how far up/down the lift line the run spans,
 *     using the ratio verticalDrop / lift.verticalRise (capped at 1).
 *  4. Determine the run's start point (near the lift peak) and end point (part-
 *     way or all the way down towards the lift base) in lat/lng space.
 *  5. Apply a lateral offset perpendicular to the lift bearing so that multiple
 *     runs accessing the same lift don't all lie on the same line.  The offset
 *     direction and magnitude are derived from the run's index in the array
 *     (used as a deterministic seed) so results are stable across calls.
 *  6. Interpolate 5–8 waypoints along the path, adding small sinusoidal
 *     perturbations to simulate gentle terrain curves.
 *  7. Assign altitudes by linear interpolation from peakElevation down by
 *     verticalDrop over the waypoint sequence.
 */

// ─── constants ───────────────────────────────────────────────────────────────

/** Approximate metres per degree of latitude (WGS-84 mean). */
const METRES_PER_LAT_DEG = 111_320;

/**
 * Maximum lateral spread in metres from the lift centreline.
 * Runs are offset between -MAX_LATERAL_M and +MAX_LATERAL_M.
 */
const MAX_LATERAL_M = 200;

/**
 * Maximum sinusoidal curve amplitude in metres applied to each waypoint
 * to give the path a natural, non-straight appearance.
 */
const MAX_CURVE_AMP_M = 60;

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a distance in metres to degrees of latitude.
 * @param {number} metres
 * @returns {number} degrees
 */
function metresToLatDeg(metres) {
  return metres / METRES_PER_LAT_DEG;
}

/**
 * Convert a distance in metres to degrees of longitude at a given latitude.
 * @param {number} metres
 * @param {number} latDeg - reference latitude in degrees
 * @returns {number} degrees
 */
function metresToLngDeg(metres, latDeg) {
  const latRad = (latDeg * Math.PI) / 180;
  const metresPerLngDeg = METRES_PER_LAT_DEG * Math.cos(latRad);
  // Guard against poles (cos → 0) — should never occur for ski resort data.
  if (Math.abs(metresPerLngDeg) < 1) return 0;
  return metres / metresPerLngDeg;
}

/**
 * Compute the bearing unit vector perpendicular (90° clockwise) to the
 * direction from pointA to pointB, expressed in [dLat, dLng] normalised to
 * one metre on the ground.
 *
 * We work in a local metre-space to avoid distortion.
 *
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @param {number} refLat - reference latitude for lng → metre conversion
 * @returns {{ dLatPerM: number, dLngPerM: number }} unit perpendicular vector
 */
function perpendicularUnit(a, b, refLat) {
  // Convert to local metre coordinates relative to point a.
  const dy = (b.lat - a.lat) * METRES_PER_LAT_DEG;                    // north+
  const latRad = (refLat * Math.PI) / 180;
  const mPerLng = METRES_PER_LAT_DEG * Math.cos(latRad);
  const dx = (b.lng - a.lng) * mPerLng;                                // east+

  // Perpendicular (90° clockwise): (dy, -dx) normalised
  const len = Math.sqrt(dy * dy + dx * dx);
  if (len < 1e-9) {
    // Lift has zero length — return a safe fallback pointing east.
    return { dLatPerM: 0, dLngPerM: 1 / (mPerLng || 1) };
  }
  const perpY = dy / len;   // perpendicular lat component (metres → normalised)
  const perpX = -dx / len;  // perpendicular lng component (metres → normalised)

  return {
    dLatPerM: perpY / METRES_PER_LAT_DEG,
    dLngPerM: perpX / (mPerLng || 1),
  };
}

/**
 * A tiny, deterministic pseudo-random number generator seeded with an integer.
 * Returns a generator function that produces values in [-1, 1] on each call.
 *
 * Uses a simple LCG (Lehmer) so behaviour is 100 % reproducible given the
 * same seed — important so that the map looks the same every time the page
 * is loaded without storing anything.
 *
 * @param {number} seed - integer seed (run index recommended)
 * @returns {() => number} generator
 */
function makeSeededRng(seed) {
  let s = Math.abs(Math.floor(seed)) || 1;
  return () => {
    // Park-Miller LCG
    s = (s * 16_807) % 2_147_483_647;
    return (s / 2_147_483_647) * 2 - 1; // map to [-1, 1]
  };
}

// ─── core function ────────────────────────────────────────────────────────────

/**
 * Generate GPS waypoints for every run that references a known lift.
 *
 * @param {Array<Object>} lifts  - Array of lift objects from lifts.js
 * @param {Array<Object>} runs   - Array of run objects from runs.js
 * @returns {Map<string, Array<{lat: number, lng: number, alt: number}>>}
 *          Map keyed by run ID, value is an ordered array of GPS waypoints
 *          from the top of the run to the bottom.
 */
export function generateRunCoords(lifts, runs) {
  const result = new Map();

  // ── guard: bad arguments ──────────────────────────────────────────────────
  if (!Array.isArray(lifts) || !Array.isArray(runs)) {
    console.warn('[runCoords] generateRunCoords: lifts and runs must be arrays');
    return result;
  }

  // ── 1. Build lift lookup ──────────────────────────────────────────────────
  const liftById = new Map();
  for (const lift of lifts) {
    if (lift && lift.id) {
      liftById.set(lift.id, lift);
    }
  }

  // ── 2. Process each run ───────────────────────────────────────────────────
  for (let runIdx = 0; runIdx < runs.length; runIdx++) {
    const run = runs[runIdx];

    // Basic validation
    if (!run || !run.id || !run.liftAccess) {
      continue;
    }

    const lift = liftById.get(run.liftAccess);
    if (!lift) {
      // Spec: skip runs whose lift is not found.
      console.warn(
        `[runCoords] Run "${run.id}" references unknown lift "${run.liftAccess}" — skipping.`
      );
      continue;
    }

    // Validate lift coords
    const liftBase = lift.coords?.base;
    const liftPeak = lift.coords?.peak;
    if (
      !liftBase || !liftPeak ||
      typeof liftBase.lat !== 'number' || typeof liftBase.lng !== 'number' ||
      typeof liftPeak.lat !== 'number' || typeof liftPeak.lng !== 'number'
    ) {
      console.warn(`[runCoords] Lift "${lift.id}" has missing/invalid coords — skipping run "${run.id}".`);
      continue;
    }

    // Validate elevations
    const liftVerticalRise = typeof lift.verticalRise === 'number' && lift.verticalRise > 0
      ? lift.verticalRise
      : (lift.peakElevation - lift.baseElevation) || 1;

    const verticalDrop = typeof run.verticalDrop === 'number' && run.verticalDrop > 0
      ? run.verticalDrop
      : liftVerticalRise;

    const peakElev = typeof lift.peakElevation === 'number' ? lift.peakElevation : 0;

    // ── 3. Coverage fraction ─────────────────────────────────────────────────
    // What fraction of the lift's vertical does this run cover?
    // Capped at 1 so runs can't extend below the lift base.
    const coverageFraction = Math.min(verticalDrop / liftVerticalRise, 1.0);

    // ── 4. Start and end points ──────────────────────────────────────────────
    // Run starts at the lift peak; ends coverageFraction of the way toward
    // the lift base (in lat/lng space).
    const startLat = liftPeak.lat;
    const startLng = liftPeak.lng;
    const endLat   = liftPeak.lat + (liftBase.lat - liftPeak.lat) * coverageFraction;
    const endLng   = liftPeak.lng + (liftBase.lng - liftPeak.lng) * coverageFraction;

    // ── 5. Lateral offset ────────────────────────────────────────────────────
    // Spread runs sideways from the lift centreline so they don't all overlap.
    // Sign alternates, magnitude scales with index.
    const refLat = (startLat + endLat) / 2;
    const perp   = perpendicularUnit(liftPeak, liftBase, refLat);

    // Use the run index to produce a stable, varied offset.
    // Odd indices go one side, even go the other; magnitude grows then wraps.
    const offsetSign      = runIdx % 2 === 0 ? 1 : -1;
    const offsetMagnitude = MAX_LATERAL_M * (0.3 + 0.7 * ((runIdx % 5) / 4));
    const lateralMetres   = offsetSign * offsetMagnitude;

    const latOffset = perp.dLatPerM * lateralMetres;
    const lngOffset = perp.dLngPerM * lateralMetres;

    // ── 6. Waypoint generation ───────────────────────────────────────────────
    // Choose waypoint count based on run length (longer runs get more points).
    const runLength = typeof run.length === 'number' && run.length > 0 ? run.length : 2000;
    const waypointCount = runLength > 7000
      ? 8
      : runLength > 4000
        ? 7
        : runLength > 2000
          ? 6
          : 5;

    const rng = makeSeededRng(runIdx * 31 + (run.id.charCodeAt(0) || 0));

    // Perpendicular curve direction (same vector, different scale)
    const curveLatUnit = perp.dLatPerM;
    const curveLngUnit = perp.dLngPerM;

    const waypoints = [];
    for (let i = 0; i < waypointCount; i++) {
      const t = i / (waypointCount - 1); // 0 at top, 1 at bottom

      // Base position: linear interpolation from start to end
      const baseLat = startLat + (endLat - startLat) * t;
      const baseLng = startLng + (endLng - startLng) * t;

      // Apply lateral offset (full offset at all points — keeps run parallel)
      const offsetLat = baseLat + latOffset;
      const offsetLng = baseLng + lngOffset;

      // Add sinusoidal curve noise so the run gently weaves.
      // Amplitude tapers at the very start and end to avoid abrupt edges.
      const taper = Math.sin(t * Math.PI); // 0 → 1 → 0
      const curveAmp = MAX_CURVE_AMP_M * taper * rng();
      const curveLat = curveLatUnit * curveAmp;
      const curveLng = curveLngUnit * curveAmp;

      // Final position
      const lat = offsetLat + curveLat;
      const lng = offsetLng + curveLng;

      // ── 7. Altitude ────────────────────────────────────────────────────────
      // Linearly interpolate from peakElevation down by verticalDrop.
      const alt = peakElev - verticalDrop * t;

      waypoints.push({ lat, lng, alt });
    }

    result.set(run.id, waypoints);
  }

  return result;
}
