/**
 * OperationsPanelRenderer - Renders the operations management panels for
 * snowmaking, grooming, avalanche control, and lift operations.
 *
 * Exports a plain object with pure render functions (return HTML strings)
 * plus a `bindOperationsActions` function that wires up DOM event handlers.
 *
 * CSS classes follow PanelManager conventions:
 *   panel-section, panel-section-title, stat-row, stat-label, stat-value,
 *   facility-item, action-btn, progress-bar, progress-fill
 */

// ---------------------------------------------------------------------------
// Colour mappings
// ---------------------------------------------------------------------------

const RISK_COLOURS = {
  low:          { bg: '#1a3a1a', border: '#2d6b2d', text: '#4caf50', label: 'LOW' },
  moderate:     { bg: '#2d2a10', border: '#7a6b10', text: '#f0c030', label: 'MODERATE' },
  considerable: { bg: '#3a2010', border: '#c06010', text: '#ff8c00', label: 'CONSIDERABLE' },
  high:         { bg: '#3a1010', border: '#c03030', text: '#f44336', label: 'HIGH' },
  extreme:      { bg: '#2d0a2d', border: '#8b008b', text: '#e040fb', label: 'EXTREME' },
};

const ZONE_DISPLAY_NAMES = {
  'alpine-whistler':  'Alpine — Whistler',
  'alpine-blackcomb': 'Alpine — Blackcomb',
  'glacier':          'Glacier Zone',
  'bowls':            'Symphony / Harmony Bowls',
};

// ---------------------------------------------------------------------------
// Utility helpers (keep dependency-free — no imports needed)
// ---------------------------------------------------------------------------

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _money(n) {
  const abs = Math.abs(Math.round(n));
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

function _pct(val) {
  return `${Math.round(clamp(val, 0, 1) * 100)}%`;
}

function _qualityColor(quality) {
  if (quality >= 0.75) return 'progress-green';
  if (quality >= 0.40) return 'progress-orange';
  return 'progress-red';
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function _formatCountdown(closedUntil, currentDate) {
  if (!closedUntil) return null;
  const msLeft = closedUntil.getTime() - currentDate.getTime();
  if (msLeft <= 0) return 'Reopening…';
  const totalMinutes = Math.ceil(msLeft / 60000);
  const hours   = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}

// ---------------------------------------------------------------------------
// Snowmaking renderer
// ---------------------------------------------------------------------------

/**
 * Renders the full snowmaking panel HTML.
 *
 * @param {object} gameState  - canonical game state
 * @param {object} operations - OperationsSystem instance
 * @returns {string} HTML
 */
function renderSnowmaking(gameState, operations) {
  const weather   = gameState.weather || {};
  const temp      = weather.temperatureC ?? 0;
  const canMake   = temp < -2;
  const costPerHr = operations.getSnowmakingCostPerHour();
  const snowRate  = operations.getTotalSnowProductionRate(weather);
  const gunList   = operations.getSnowmakingStatus();
  const runs      = gameState.resort?.runs || [];

  // Temp indicator
  const tempClass   = canMake ? 'stat-positive' : 'stat-negative';
  const tempLabel   = canMake ? 'OK — guns can run' : 'Too warm for snowmaking';
  const tempDisplay = `${Math.round(temp)}°C`;

  // Build per-run gun rows
  const runRows = gunList.map(({ runId, active, coverage }) => {
    const run     = runs.find(r => r.id === runId);
    const runName = run ? _esc(run.name) : _esc(runId);
    const covPct  = Math.round(coverage * 100);
    const checkedAttr = active ? 'checked' : '';
    const activeLabel = active
      ? `<span class="stat-positive">ON</span>`
      : `<span style="opacity:0.4">OFF</span>`;

    return `
      <div class="facility-item" style="gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;min-width:0">
            <input type="checkbox" class="ops-snowgun-toggle"
              data-run-id="${_esc(runId)}"
              ${checkedAttr}
              style="width:16px;height:16px;accent-color:#4fc3f7;cursor:pointer">
            <span class="stat-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${runName}</span>
          </label>
          <span style="font-size:11px;min-width:36px;text-align:right">${activeLabel}</span>
        </div>
        ${active ? `
        <div style="display:flex;align-items:center;gap:6px;padding-left:24px">
          <span class="stat-label" style="font-size:10px;min-width:60px">Coverage</span>
          <div class="progress-bar" style="flex:1;height:6px">
            <div class="progress-fill progress-blue" style="width:${covPct}%"></div>
          </div>
          <span style="font-size:10px;min-width:32px;text-align:right;opacity:0.7">${covPct}%</span>
        </div>` : ''}
      </div>`;
  }).join('');

  const emptyMsg = gunList.length === 0
    ? '<p style="opacity:0.5;font-size:12px">No runs registered yet.</p>'
    : '';

  return `
    <div class="panel-section">
      <div class="panel-section-title">Current Temperature</div>
      <div class="stat-row">
        <span class="stat-label">Temperature</span>
        <span class="stat-value ${tempClass}">${tempDisplay}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Status</span>
        <span class="stat-value ${tempClass}" style="font-size:11px">${tempLabel}</span>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Summary</div>
      <div class="stat-row">
        <span class="stat-label">Cost Per Hour</span>
        <span class="stat-value stat-negative">${_money(costPerHr)}/hr</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Snow Production</span>
        <span class="stat-value ${snowRate > 0 ? 'stat-positive' : ''}">${snowRate.toFixed(1)} cm/hr total</span>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Snow Guns — Per Run</div>
      ${emptyMsg}
      ${runRows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Grooming renderer
// ---------------------------------------------------------------------------

/**
 * Renders the grooming management panel.
 *
 * @param {object} gameState  - canonical game state
 * @param {object} operations - OperationsSystem instance
 * @returns {string} HTML
 */
function renderGrooming(gameState, operations) {
  const runs          = gameState.resort?.runs || [];
  const openRuns      = runs.filter(r => r.status === 'open');
  const groomStatus   = operations.getGroomingStatus();
  const scheduledCount = operations.getGroomingScheduleCount();
  const groomCost     = scheduledCount * 2_500;
  const currentHour   = gameState.time?.hour ?? 0;
  const nextGroomHour = operations.getNextGroomingTime();

  // Hours until next grooming window
  const hoursUntil = currentHour < nextGroomHour
    ? nextGroomHour - currentHour
    : 24 - currentHour + nextGroomHour;
  const inWindow = currentHour >= nextGroomHour || currentHour < 6;
  const nextGroomDisplay = inWindow
    ? '<span class="stat-positive">NOW (22:00 – 06:00)</span>'
    : `in ~${hoursUntil}h (22:00)`;

  // Map runId → grooming quality for quick lookup
  const qualityMap = new Map(groomStatus.map(g => [g.runId, g.quality]));
  const scheduledMap = new Map(groomStatus.map(g => [g.runId, g.scheduled]));

  // Build per-run rows (show only open runs)
  const runRows = openRuns.map(run => {
    const quality    = qualityMap.get(run.id) ?? 0;
    const scheduled  = scheduledMap.get(run.id) ?? false;
    const qualPct    = Math.round(quality * 100);
    const barClass   = _qualityColor(quality);
    const checkedAttr = scheduled ? 'checked' : '';
    const diffBadge  = _diffBadge(run.difficulty);

    return `
      <div class="facility-item">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
          <span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
            ${diffBadge}
            <span class="stat-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(run.name)}</span>
          </span>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;white-space:nowrap">
            <input type="checkbox" class="ops-groom-schedule"
              data-run-id="${_esc(run.id)}"
              ${checkedAttr}
              style="width:14px;height:14px;accent-color:#4fc3f7;cursor:pointer">
            <span style="opacity:0.7">Nightly</span>
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:10px;opacity:0.6;min-width:50px">Quality</span>
          <div class="progress-bar" style="flex:1;height:8px">
            <div class="progress-fill ${barClass}" style="width:${qualPct}%"></div>
          </div>
          <span style="font-size:10px;min-width:36px;text-align:right;opacity:0.8">${qualPct}%</span>
        </div>
      </div>`;
  }).join('');

  const emptyMsg = openRuns.length === 0
    ? '<p style="opacity:0.5;font-size:12px">No open runs.</p>'
    : '';

  return `
    <div class="panel-section">
      <div class="panel-section-title">Next Grooming Run</div>
      <div class="stat-row">
        <span class="stat-label">Window</span>
        <span class="stat-value" style="font-size:11px">${nextGroomDisplay}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Scheduled Runs</span>
        <span class="stat-value">${scheduledCount}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Estimated Cost</span>
        <span class="stat-value stat-negative">${_money(groomCost)}</span>
      </div>
      <div class="panel-actions">
        <button class="action-btn btn-primary ops-groom-all" id="ops-btn-groom-all">
          Groom All Open Runs — ${_money(openRuns.length * 2_500)}
        </button>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Run Grooming Quality</div>
      ${emptyMsg}
      ${runRows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Avalanche control renderer
// ---------------------------------------------------------------------------

/**
 * Renders the avalanche control panel.
 *
 * @param {object} gameState  - canonical game state
 * @param {object} operations - OperationsSystem instance
 * @returns {string} HTML
 */
function renderAvalanche(gameState, operations) {
  const weather  = gameState.weather || {};
  const date     = gameState.date || new Date();
  const zones    = operations.getAvalancheRisk();

  const windSpeed  = Math.round(weather.windSpeedKmh ?? 0);
  const windGust   = Math.round(weather.windGustKmh ?? 0);
  const windDir    = weather.windDirection || '—';
  const snowRate   = (weather.snowRateCmPerHour ?? 0).toFixed(1);

  // Build zone cards
  const zoneCards = zones.map(({ zone, riskLevel, closedUntil }) => {
    const colours      = RISK_COLOURS[riskLevel] || RISK_COLOURS.low;
    const displayName  = ZONE_DISPLAY_NAMES[zone] || _esc(zone);
    const countdown    = closedUntil ? _formatCountdown(closedUntil, date) : null;
    const isExtreme    = riskLevel === 'extreme';
    const isClosed     = !!closedUntil;

    const statusLine = isClosed
      ? `<span style="color:#f44336;font-size:11px">CLOSED — ${_esc(countdown)}</span>`
      : isExtreme
        ? `<span style="color:#e040fb;font-size:11px">AUTO-CLOSED (extreme risk)</span>`
        : `<span style="color:#aaa;font-size:11px">Open</span>`;

    const btnDisabled = isClosed ? 'disabled' : '';
    const btnLabel    = isClosed
      ? `Control Work In Progress`
      : `Trigger Control Work — $15,000`;

    return `
      <div class="facility-item" style="
        border:1px solid ${colours.border};
        background:${colours.bg};
        border-radius:6px;
        padding:10px;
        margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
          <div>
            <div style="font-weight:600;font-size:13px;color:#e8eaf0">${displayName}</div>
            <div style="margin-top:2px">${statusLine}</div>
          </div>
          <div style="
            background:${colours.border};
            color:${colours.text};
            padding:3px 8px;
            border-radius:4px;
            font-size:11px;
            font-weight:700;
            white-space:nowrap">
            ${colours.label}
          </div>
        </div>
        ${isClosed ? `
        <div class="progress-bar" style="height:4px;margin-bottom:8px">
          <div class="progress-fill progress-red" style="width:100%;animation:pulse 1.5s infinite"></div>
        </div>` : ''}
        <button class="action-btn ops-av-control"
          data-zone="${_esc(zone)}"
          ${btnDisabled}
          style="width:100%;${isClosed ? 'opacity:0.5;cursor:not-allowed' : ''}">
          ${btnLabel}
        </button>
      </div>`;
  }).join('');

  return `
    <div class="panel-section">
      <div class="panel-section-title">Current Conditions</div>
      <div class="stat-row">
        <span class="stat-label">Wind Speed</span>
        <span class="stat-value ${windSpeed >= 50 ? 'stat-negative' : ''}">${windSpeed} km/h ${windDir}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Wind Gusts</span>
        <span class="stat-value ${windGust >= 60 ? 'stat-negative' : ''}">${windGust} km/h</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">New Snow Rate</span>
        <span class="stat-value">${snowRate} cm/hr</span>
      </div>
    </div>

    <div class="panel-section">
      <div class="panel-section-title">Avalanche Zones</div>
      <p style="font-size:11px;opacity:0.55;margin-bottom:10px;line-height:1.5">
        Control work costs $15,000 per zone, closes runs for 3 hours,
        and resets risk to <em>low</em>. Extreme-risk zones are auto-closed.
      </p>
      ${zoneCards}
    </div>`;
}

// ---------------------------------------------------------------------------
// Action binding
// ---------------------------------------------------------------------------

/**
 * Attaches DOM event handlers for all operations panel toggles and buttons.
 * Should be called after the panel HTML has been injected into the DOM.
 *
 * @param {object} operations - OperationsSystem instance
 * @param {object} gameState  - canonical game state (mutated by operations)
 * @param {Function} [onUpdate] - optional callback to trigger a re-render
 */
function bindOperationsActions(operations, gameState, onUpdate) {
  function rerender() {
    if (typeof onUpdate === 'function') onUpdate();
  }

  // ---- Snow gun toggles ----
  document.querySelectorAll('.ops-snowgun-toggle').forEach(checkbox => {
    // Replace to avoid duplicate handlers on re-render
    const fresh = checkbox.cloneNode(true);
    checkbox.parentNode.replaceChild(fresh, checkbox);
    fresh.addEventListener('change', () => {
      const runId = fresh.dataset.runId;
      if (runId) {
        operations.toggleSnowmaking(runId);
        rerender();
      }
    });
  });

  // ---- Grooming schedule checkboxes ----
  document.querySelectorAll('.ops-groom-schedule').forEach(checkbox => {
    const fresh = checkbox.cloneNode(true);
    checkbox.parentNode.replaceChild(fresh, checkbox);
    fresh.addEventListener('change', () => {
      const runId = fresh.dataset.runId;
      if (runId) {
        operations.toggleGroomSchedule(runId);
        rerender();
      }
    });
  });

  // ---- Groom All button ----
  const groomAllBtn = document.getElementById('ops-btn-groom-all');
  if (groomAllBtn) {
    groomAllBtn.addEventListener('click', () => {
      const runs = gameState.resort?.runs || [];
      const openRuns = runs.filter(r => r.status === 'open');
      const cost = openRuns.length * 2_500;

      if (gameState.money < cost) {
        _showToast('Not enough funds for full grooming.', 'warning');
        return;
      }

      // Schedule all open runs and flag them groomed immediately
      for (const run of openRuns) {
        operations.groomingSchedule.add(run.id);
        run.groomed = true;
      }

      // Charge cost directly
      gameState.financials.daily.expenses += cost;
      gameState.resort.groomingQuality = 1.0;

      operations.emit('groomAllTriggered', { count: openRuns.length, cost });
      rerender();
    });
  }

  // ---- Avalanche control work buttons ----
  document.querySelectorAll('.ops-av-control').forEach(btn => {
    if (btn.disabled) return;
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      const zone = fresh.dataset.zone;
      if (!zone) return;

      if (gameState.money < 15_000) {
        _showToast('Insufficient funds for avalanche control work.', 'warning');
        return;
      }

      const triggered = operations.triggerControlWork(zone, gameState);
      if (triggered) {
        _showToast(`Control work triggered for ${ZONE_DISPLAY_NAMES[zone] || zone}.`, 'info');
        rerender();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Internal UI helpers
// ---------------------------------------------------------------------------

function _diffBadge(difficulty) {
  const badges = {
    green:         { symbol: '●', color: '#4caf50' },
    blue:          { symbol: '■', color: '#2196f3' },
    black:         { symbol: '◆', color: '#e0e0e0' },
    'double-black':{ symbol: '◆◆', color: '#e0e0e0' },
  };
  const b = badges[difficulty] || { symbol: '?', color: '#aaa' };
  return `<span style="color:${b.color};font-size:11px;flex-shrink:0">${b.symbol}</span>`;
}

function _showToast(message, type = 'info') {
  // Lightweight toast — falls back gracefully if no toast container exists.
  const existingToast = document.getElementById('ops-toast');
  if (existingToast) existingToast.remove();

  const colours = {
    info:    { bg: '#1a3a4a', border: '#2196f3' },
    warning: { bg: '#3a2a10', border: '#ff9800' },
    error:   { bg: '#3a1010', border: '#f44336' },
  };
  const c = colours[type] || colours.info;

  const toast = document.createElement('div');
  toast.id = 'ops-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '80px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: '#e8eaf0',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    zIndex: '9999',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.2s',
  });
  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    }, 2500);
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const OperationsPanelRenderer = {
  renderSnowmaking,
  renderGrooming,
  renderAvalanche,
  bindOperationsActions,
};
