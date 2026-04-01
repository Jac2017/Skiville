/**
 * EventPanelRenderer - Renders the events, challenges, and goals panel for Skiville.
 *
 * Exports a plain object with pure render functions (return HTML strings)
 * plus a `bindEventActions` function that wires up DOM event handlers.
 *
 * CSS classes follow PanelManager conventions:
 *   panel-section, panel-section-title, facility-item, stat-row, stat-label,
 *   stat-value, progress-bar, progress-fill, action-btn, notification type styling
 */

// ---------------------------------------------------------------------------
// Severity colour mapping (mirrors notification type styling)
// ---------------------------------------------------------------------------

const SEVERITY_STYLES = {
  success: { border: 'var(--hud-success, #4caf50)', text: '#4caf50',  label: 'GOOD NEWS', icon: '&#10003;' },
  info:    { border: 'var(--hud-accent,  #2196f3)', text: '#4fc3f7',  label: 'INFO',       icon: '&#8505;'  },
  warning: { border: 'var(--hud-warning, #ff9800)', text: '#ff9800',  label: 'WARNING',    icon: '&#9888;'  },
  danger:  { border: 'var(--hud-danger,  #f44336)', text: '#f44336',  label: 'URGENT',     icon: '&#10007;' },
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function _esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _money(n) {
  const abs  = Math.abs(Math.round(n));
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toLocaleString('en-US')}`;
}

function _pct(val, max) {
  return Math.min(100, Math.round((val / max) * 100));
}

function _formatHours(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0)           return `${h}h`;
  return `${m}m`;
}

function _progressClass(pctInt) {
  if (pctInt >= 75) return 'progress-green';
  if (pctInt >= 40) return 'progress-blue';
  if (pctInt >= 15) return 'progress-orange';
  return 'progress-red';
}

// ---------------------------------------------------------------------------
// Active events section
// ---------------------------------------------------------------------------

function _renderActiveEvents(activeEvents) {
  if (activeEvents.length === 0) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Active Events</div>
        <p style="font-size:12px;opacity:0.5;padding:4px 0">No events currently active. The resort is running smoothly.</p>
      </div>`;
  }

  const eventCards = activeEvents.map(event => {
    const sty       = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;
    const remaining = _formatHours(event.remainingHours || 0);

    const costLine = event.effects?.cost > 0
      ? `<div class="stat-row"><span class="stat-label">Cost</span><span class="stat-value stat-negative">${_money(event.effects.cost)}</span></div>`
      : '';
    const repHit = (event.effects?.reputationHit || 0) < 0
      ? `<div class="stat-row"><span class="stat-label">Reputation</span><span class="stat-value stat-negative">${event.effects.reputationHit.toFixed(1)} stars</span></div>`
      : '';
    const repBoost = (event.effects?.reputationBoost || 0) > 0
      ? `<div class="stat-row"><span class="stat-label">Reputation</span><span class="stat-value stat-positive">+${event.effects.reputationBoost.toFixed(1)} stars</span></div>`
      : '';
    const guestBoost = (event.effects?.guestBoostPct || 0) > 0
      ? `<div class="stat-row"><span class="stat-label">Guest Boost</span><span class="stat-value stat-positive">+${Math.round(event.effects.guestBoostPct * 100)}%</span></div>`
      : '';
    const restCapacity = (event.effects?.restaurantCapacity || 1) < 1
      ? `<div class="stat-row"><span class="stat-label">Restaurants</span><span class="stat-value stat-negative">${Math.round(event.effects.restaurantCapacity * 100)}% capacity</span></div>`
      : '';

    // Choice buttons (only show if choices still pending)
    const choiceButtons = (event.choices && !event.resolved)
      ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
           ${event.choices.map(ch => `
             <button
               class="action-btn event-choice-btn"
               data-event-id="${_esc(event.id)}"
               data-choice-id="${_esc(ch.id)}"
               style="text-align:left;font-size:11px;padding:6px 10px;white-space:normal;height:auto;line-height:1.4">
               ${_esc(ch.label)}
             </button>`).join('')}
         </div>`
      : (event.choiceMade
          ? `<div style="font-size:11px;opacity:0.55;margin-top:8px;font-style:italic">Decision made: ${_esc(event.choiceMade.replace(/-/g, ' '))}</div>`
          : '');

    // Timer bar
    const durationTotal = event.durationHours || 1;
    const timerPct      = Math.round((event.remainingHours / durationTotal) * 100);
    const timerClass    = event.severity === 'danger'  ? 'progress-red'
                        : event.severity === 'warning' ? 'progress-orange'
                        : event.severity === 'success' ? 'progress-green'
                        : 'progress-blue';

    return `
      <div class="facility-item" style="border-left:3px solid ${sty.border};padding-left:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span style="color:${sty.text};font-size:10px;font-weight:700;letter-spacing:0.05em">${sty.label}</span>
              <span style="font-weight:600;font-size:13px;color:#e8eaf0">${_esc(event.title)}</span>
            </div>
            <div style="font-size:11px;opacity:0.65;line-height:1.4">${_esc(event.description)}</div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:10px;opacity:0.55;min-width:52px">Remaining</span>
          <div class="progress-bar" style="flex:1;height:5px">
            <div class="progress-fill ${timerClass}" style="width:${timerPct}%"></div>
          </div>
          <span style="font-size:11px;min-width:42px;text-align:right;opacity:0.75">${remaining}</span>
        </div>

        ${costLine}${repHit}${repBoost}${guestBoost}${restCapacity}
        ${choiceButtons}
      </div>`;
  }).join('');

  return `
    <div class="panel-section">
      <div class="panel-section-title">Active Events (${activeEvents.length})</div>
      ${eventCards}
    </div>`;
}

// ---------------------------------------------------------------------------
// Seasonal challenges section
// ---------------------------------------------------------------------------

function _renderChallenges(challenges) {
  if (challenges.length === 0) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Seasonal Challenges</div>
        <p style="font-size:12px;opacity:0.5;padding:4px 0">No challenges available for the current season.</p>
      </div>`;
  }

  const rows = challenges.map(ch => {
    const completed = ch.completed;
    const failed    = ch.failed;

    const statusBadge = completed
      ? `<span style="background:#1a3a1a;color:#4caf50;border:1px solid #2d6b2d;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">COMPLETE</span>`
      : failed
        ? `<span style="background:#3a1010;color:#f44336;border:1px solid #c03030;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">FAILED</span>`
        : `<span style="background:#1a2233;color:#4fc3f7;border:1px solid #1e3a5f;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">ACTIVE</span>`;

    // Normalise progress to a percentage for each challenge type
    let barPct   = 0;
    let progText = '';

    if (ch.id === 'early-season') {
      barPct   = _pct(ch.progress, 10);
      progText = `${ch.progress} / 10 lifts open`;
    } else if (ch.id === 'holiday-rush') {
      barPct   = Math.round(ch.progress);     // satisfaction is 0-100
      progText = `${Math.round(ch.progress)}% satisfaction`;
    } else if (ch.id === 'peak-performance') {
      barPct   = _pct(ch.progress, 2_000_000);
      progText = `${_money(ch.progress)} / $2M daily`;
    } else if (ch.id === 'spring-survival') {
      barPct   = _pct(ch.progress, 30);       // ~30 days in April
      progText = `${ch.progress} days checked`;
    } else {
      barPct   = completed ? 100 : 0;
      progText = completed ? 'Complete' : 'In progress';
    }

    const barClass = completed ? 'progress-green' : failed ? 'progress-red' : _progressClass(barPct);
    const opacity  = (completed || failed) ? 'opacity:0.65;' : '';

    return `
      <div class="facility-item" style="${opacity}margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:5px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:#e8eaf0;margin-bottom:2px">${_esc(ch.title)}</div>
            <div style="font-size:11px;opacity:0.6;line-height:1.4">${_esc(ch.description)}</div>
          </div>
          ${statusBadge}
        </div>

        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:10px;opacity:0.55;min-width:52px">Progress</span>
          <div class="progress-bar" style="flex:1;height:8px">
            <div class="progress-fill ${barClass}" style="width:${barPct}%"></div>
          </div>
          <span style="font-size:10px;min-width:60px;text-align:right;opacity:0.65">${progText}</span>
        </div>

        <div class="stat-row" style="padding-top:2px;border-top:1px solid rgba(255,255,255,0.06)">
          <span class="stat-label" style="font-size:11px">Reward</span>
          <span class="stat-value stat-positive" style="font-size:12px">${_money(ch.reward)}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="panel-section">
      <div class="panel-section-title">Seasonal Challenges</div>
      ${rows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Yearly goals section
// ---------------------------------------------------------------------------

function _renderYearlyGoals(yearlyGoals) {
  const rows = yearlyGoals.map(goal => {
    const completed = goal.completed;

    const statusBadge = completed
      ? `<span style="background:#1a3a1a;color:#4caf50;border:1px solid #2d6b2d;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">ACHIEVED</span>`
      : `<span style="background:#1a2233;color:#4fc3f7;border:1px solid #1e3a5f;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700">IN PROGRESS</span>`;

    let barPct   = 0;
    let progText = '';

    if (goal.id === 'guest-milestone') {
      barPct   = _pct(goal.progress, goal.target);
      progText = `${Math.round(goal.progress / 1000)}K / 500K guests`;
    } else if (goal.id === 'rating-target') {
      const normProg = Math.max(0, (goal.progress || 0) - 1);  // 1-5 range -> 0-4
      barPct         = _pct(normProg, goal.target - 1);
      progText       = `${(goal.progress || 0).toFixed(1)} / 4.5 stars`;
    } else if (goal.id === 'revenue-target') {
      barPct   = _pct(goal.progress, goal.target);
      progText = `${_money(goal.progress)} / $100M`;
    }

    const barClass = completed ? 'progress-green' : _progressClass(barPct);
    const opacity  = completed ? 'opacity:0.65;' : '';

    return `
      <div class="facility-item" style="${opacity}margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:5px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:13px;color:#e8eaf0;margin-bottom:2px">${_esc(goal.title)}</div>
            <div style="font-size:11px;opacity:0.6;line-height:1.4">${_esc(goal.description)}</div>
          </div>
          ${statusBadge}
        </div>

        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <span style="font-size:10px;opacity:0.55;min-width:52px">Progress</span>
          <div class="progress-bar" style="flex:1;height:8px">
            <div class="progress-fill ${barClass}" style="width:${barPct}%"></div>
          </div>
          <span style="font-size:10px;min-width:70px;text-align:right;opacity:0.65">${progText}</span>
        </div>

        <div class="stat-row" style="padding-top:2px;border-top:1px solid rgba(255,255,255,0.06)">
          <span class="stat-label" style="font-size:11px">Reward</span>
          <span class="stat-value stat-positive" style="font-size:12px">${_money(goal.reward)}</span>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="panel-section">
      <div class="panel-section-title">Yearly Goals</div>
      ${rows}
    </div>`;
}

// ---------------------------------------------------------------------------
// Event history log
// ---------------------------------------------------------------------------

function _renderEventHistory(history) {
  if (history.length === 0) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Recent Event History</div>
        <p style="font-size:12px;opacity:0.5;padding:4px 0">No events have occurred yet.</p>
      </div>`;
  }

  const rows = history.map(event => {
    const sty      = SEVERITY_STYLES[event.severity] || SEVERITY_STYLES.info;
    const costLine = (event.effects?.cost || 0) > 0
      ? `<span style="color:#f44336;margin-left:6px;font-size:10px">-${_money(event.effects.cost)}</span>`
      : '';
    const rewardLine = (event.effects?.reputationBoost || 0) > 0
      ? `<span style="color:#4caf50;margin-left:6px;font-size:10px">+${event.effects.reputationBoost.toFixed(1)} rep</span>`
      : '';
    const guestLine = (event.effects?.guestBoostPct || 0) > 0
      ? `<span style="color:#4fc3f7;margin-left:6px;font-size:10px">+${Math.round(event.effects.guestBoostPct * 100)}% guests</span>`
      : '';
    const choiceLine = event.choiceMade
      ? `<span style="opacity:0.45;font-size:10px;margin-left:4px">&#8212; ${_esc(event.choiceMade.replace(/-/g, ' '))}</span>`
      : '';

    const dateStr = event.endTime
      ? new Date(event.endTime).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        })
      : '&#8212;';

    return `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <span style="color:${sty.text};font-size:14px;flex-shrink:0;line-height:1.2">${sty.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:baseline;gap:4px;flex-wrap:wrap">
            <span style="font-size:12px;font-weight:600;color:#d0d4e0">${_esc(event.title)}</span>
            ${costLine}${rewardLine}${guestLine}${choiceLine}
          </div>
          <div style="font-size:10px;opacity:0.40;margin-top:1px">${dateStr}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="panel-section">
      <div class="panel-section-title">Recent Event History</div>
      <div style="padding:0 2px">${rows}</div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main render entry point
// ---------------------------------------------------------------------------

/**
 * Render the full events panel HTML.
 *
 * @param {object} gameState   - canonical game state
 * @param {object} eventSystem - EventSystem instance
 * @returns {string} HTML ready to inject into the panel container
 */
function renderEventsPanel(gameState, eventSystem) {
  if (!eventSystem) return '<p style="opacity:0.5;font-size:12px;padding:8px">Event system not available.</p>';

  const activeEvents = eventSystem.getActiveEvents();
  const challenges   = eventSystem.getChallenges();
  const yearlyGoals  = eventSystem.getYearlyGoals();
  const history      = eventSystem.getEventHistory();

  return [
    _renderActiveEvents(activeEvents),
    _renderChallenges(challenges),
    _renderYearlyGoals(yearlyGoals),
    _renderEventHistory(history),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Action binding
// ---------------------------------------------------------------------------

/**
 * Attaches DOM event handlers for event choice buttons.
 * Should be called after the panel HTML has been injected into the DOM.
 *
 * @param {object}   eventSystem - EventSystem instance
 * @param {Function} [onUpdate]  - optional callback to trigger a re-render
 */
function bindEventActions(eventSystem, onUpdate) {
  if (!eventSystem) return;

  function rerender() {
    if (typeof onUpdate === 'function') onUpdate();
  }

  // Choice buttons: resolve player decisions
  document.querySelectorAll('.event-choice-btn').forEach(btn => {
    // Replace node to prevent duplicate listeners on re-renders
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);

    fresh.addEventListener('click', () => {
      const eventId  = fresh.dataset.eventId;
      const choiceId = fresh.dataset.choiceId;
      if (!eventId || !choiceId) return;

      const resolved = eventSystem.resolveEvent(eventId, choiceId);
      if (resolved) {
        _showEventToast('Decision recorded.', 'info');
        rerender();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Internal toast helper
// ---------------------------------------------------------------------------

function _showEventToast(message, type = 'info') {
  const existing = document.getElementById('event-panel-toast');
  if (existing) existing.remove();

  const colours = {
    info:    { bg: '#1a3a4a', border: '#2196f3' },
    success: { bg: '#1a3a1a', border: '#4caf50' },
    warning: { bg: '#3a2a10', border: '#ff9800' },
    danger:  { bg: '#3a1010', border: '#f44336' },
  };
  const c = colours[type] || colours.info;

  const toast = document.createElement('div');
  toast.id    = 'event-panel-toast';
  toast.textContent = message;

  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '80px',
    left:         '50%',
    transform:    'translateX(-50%)',
    background:   c.bg,
    border:       `1px solid ${c.border}`,
    color:        '#e8eaf0',
    padding:      '8px 16px',
    borderRadius: '6px',
    fontSize:     '13px',
    zIndex:       '9999',
    pointerEvents: 'none',
    opacity:      '0',
    transition:   'opacity 0.2s',
  });

  document.body.appendChild(toast);

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

export const EventPanelRenderer = {
  renderEventsPanel,
  bindEventActions,
};
