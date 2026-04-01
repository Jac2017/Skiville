/**
 * BuildPanelRenderer.js
 * Renders the build panel UI and construction queue for Skiville's build mode.
 * Exported as a plain object of render functions (not a class).
 */

'use strict';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a dollar amount into a compact string.
 * Examples: 45000000 → "$45M", 1500000 → "$1.5M", 800000 → "$800K", 500 → "$500"
 *
 * @param {number} n
 * @returns {string}
 */
function _formatMoney(n) {
  if (typeof n !== 'number' || isNaN(n)) return '$0';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';

  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    const formatted = millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1);
    return `${sign}$${formatted}M`;
  }
  if (abs >= 1_000) {
    const thousands = abs / 1_000;
    const formatted = thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(1);
    return `${sign}$${formatted}K`;
  }
  return `${sign}$${abs.toFixed(0)}`;
}

/**
 * Returns a human-readable build time string.
 * @param {number} days
 * @returns {string}
 */
function _formatBuildTime(days) {
  if (days >= 365) {
    const years = (days / 365).toFixed(1);
    return `${years} yr`;
  }
  if (days >= 30) {
    const months = Math.round(days / 30);
    return `${months} mo`;
  }
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/**
 * Escapes a string for safe embedding in HTML attribute values.
 * @param {string} str
 * @returns {string}
 */
function _escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Maps a catalog category key to a UI tab group.
 * @param {string} category
 * @returns {string}
 */
function _tabForCategory(category) {
  const map = {
    hotels: 'buildings',
    restaurants: 'buildings',
    bars: 'buildings',
    shops: 'buildings',
    condos: 'buildings',
    parking: 'buildings',
    lifts: 'lifts',
    'terrain-park': 'terrain',
  };
  return map[category] || 'equipment';
}

// Tab configuration
const TABS = [
  { id: 'buildings', label: 'Buildings', icon: '🏨' },
  { id: 'lifts', label: 'Lifts', icon: '🚡' },
  { id: 'terrain', label: 'Terrain', icon: '🏂' },
  { id: 'equipment', label: 'Equipment', icon: '⚙️' },
];

// ---------------------------------------------------------------------------
// Build panel renderer (exported as plain object)
// ---------------------------------------------------------------------------

export const BuildPanelRenderer = {

  // -------------------------------------------------------------------------
  // Public: _formatMoney (exposed for testing)
  // -------------------------------------------------------------------------
  _formatMoney,

  // -------------------------------------------------------------------------
  // renderBuildPanel
  // -------------------------------------------------------------------------

  /**
   * Renders the full build panel HTML string.
   *
   * @param {object} gameState  - Must expose `money` (number)
   * @param {object} buildSystem - Instance of BuildSystem
   * @param {string} [activeTab='buildings'] - Which tab to show active
   * @returns {string} HTML string
   */
  renderBuildPanel(gameState, buildSystem, activeTab = 'buildings') {
    const catalog = buildSystem.getCatalog();
    const activeBuildMode = buildSystem.getActiveBuildMode();
    const money = gameState.money || 0;

    // ---- Tab bar ----
    const tabBarHtml = TABS.map(tab => {
      const isActive = tab.id === activeTab;
      return `<button
          class="build-tab${isActive ? ' build-tab--active' : ''}"
          data-tab="${_escAttr(tab.id)}"
          aria-selected="${isActive}"
          role="tab"
        >${tab.icon} ${tab.label}</button>`;
    }).join('\n');

    // ---- Active build mode indicator ----
    const activeModeHtml = activeBuildMode
      ? `<div class="build-mode-indicator">
          <span class="build-mode-indicator__label">Active Mode:</span>
          <span class="build-mode-indicator__value">${_escAttr(activeBuildMode)}</span>
          <button class="action-btn btn-secondary cancel-build-mode-btn" data-action="cancelBuildMode">
            ✕ Cancel
          </button>
        </div>`
      : '';

    // ---- Item cards grouped by tab ----
    const tabContentHtml = TABS.map(tab => {
      const isActive = tab.id === activeTab;
      const categoriesInTab = Object.values(catalog).filter(
        cat => _tabForCategory(cat.category) === tab.id
      );

      if (categoriesInTab.length === 0) {
        return `<div
            class="build-tab-panel${isActive ? ' build-tab-panel--active' : ''}"
            data-tab-panel="${_escAttr(tab.id)}"
            role="tabpanel"
          >
          <p class="build-empty">No items available in this category yet.</p>
        </div>`;
      }

      const categorySections = categoriesInTab.map(cat => {
        const cardsHtml = Object.values(cat.items).map(item => {
          const affordable = buildSystem.canAfford(item.type, money);
          const disabledAttr = affordable ? '' : ' disabled';
          const disabledClass = affordable ? '' : ' upgrade-card--unaffordable';

          return `<div class="upgrade-card${disabledClass}" data-item-type="${_escAttr(item.type)}">
              <div class="upgrade-card-header">
                <span class="upgrade-name">${_escAttr(item.name)}</span>
                <span class="upgrade-cost">${_formatMoney(item.cost)}</span>
              </div>
              <p class="upgrade-desc">${_escAttr(item.description)}</p>
              <div class="upgrade-meta">
                <span class="upgrade-meta__item" title="Build time">
                  🕐 ${_formatBuildTime(item.buildTimeDays)}
                </span>
                <span class="upgrade-meta__item" title="Expected daily revenue">
                  💰 ${_formatMoney(item.dailyRevenue)}/day
                </span>
                <span class="upgrade-meta__item" title="Capacity">
                  👥 ${item.capacity.toLocaleString()}
                </span>
              </div>
              <button
                class="action-btn btn-primary build-item-btn"
                data-action="build"
                data-item-type="${_escAttr(item.type)}"
                ${disabledAttr}
              >
                ${affordable ? 'Build' : `Need ${_formatMoney(item.cost - money)} more`}
              </button>
            </div>`;
        }).join('\n');

        return `<section class="build-category">
            <h3 class="build-category__title">${_escAttr(cat.label)}</h3>
            <div class="build-category__grid">
              ${cardsHtml}
            </div>
          </section>`;
      }).join('\n');

      return `<div
          class="build-tab-panel${isActive ? ' build-tab-panel--active' : ''}"
          data-tab-panel="${_escAttr(tab.id)}"
          role="tabpanel"
        >
        ${categorySections}
      </div>`;
    }).join('\n');

    return `<div class="build-panel" id="buildPanel">
      <div class="build-panel__header">
        <h2 class="build-panel__title">Build Mode</h2>
        <span class="build-panel__budget">Budget: <strong>${_formatMoney(money)}</strong></span>
      </div>
      ${activeModeHtml}
      <nav class="build-tabs" role="tablist" aria-label="Build categories">
        ${tabBarHtml}
      </nav>
      <div class="build-panel__content">
        ${tabContentHtml}
      </div>
    </div>`;
  },

  // -------------------------------------------------------------------------
  // renderConstructionQueue
  // -------------------------------------------------------------------------

  /**
   * Renders the construction queue HTML string.
   *
   * @param {object} buildSystem - Instance of BuildSystem
   * @returns {string} HTML string
   */
  renderConstructionQueue(buildSystem) {
    const constructions = buildSystem.getActiveConstructions();

    if (constructions.length === 0) {
      return `<div class="construction-queue construction-queue--empty">
        <p class="construction-queue__empty-msg">No active constructions.</p>
      </div>`;
    }

    const itemsHtml = constructions.map(c => {
      const progressPct = Math.min(100, Math.max(0, c.progress));
      const daysLabel = c.daysRemaining === 1 ? '1 day remaining' : `${Math.ceil(c.daysRemaining)} days remaining`;

      // Colour the progress bar based on completion
      let barColourClass = 'progress-blue';
      if (progressPct >= 75) barColourClass = 'progress-green';
      else if (progressPct >= 40) barColourClass = 'progress-blue';
      else barColourClass = 'progress-blue';

      return `<div class="construction-item" data-construction-id="${_escAttr(c.id)}">
          <div class="construction-item__info">
            <span class="construction-item__name">${_escAttr(c.name)}</span>
            <span class="construction-item__location">
              (${c.position.lat.toFixed(4)}, ${c.position.lng.toFixed(4)})
            </span>
          </div>
          <div class="construction-item__progress-row">
            <div class="progress-bar" role="progressbar"
              aria-valuenow="${progressPct}"
              aria-valuemin="0"
              aria-valuemax="100">
              <div class="progress-fill ${barColourClass}" style="width: ${progressPct}%"></div>
            </div>
            <span class="construction-item__pct">${progressPct.toFixed(1)}%</span>
          </div>
          <div class="construction-item__footer">
            <span class="construction-item__days">${_escAttr(daysLabel)}</span>
            <button
              class="action-btn btn-danger cancel-construction-btn"
              data-action="cancelConstruction"
              data-construction-id="${_escAttr(c.id)}"
              title="Cancel construction (50% refund)"
            >
              Cancel (50% refund)
            </button>
          </div>
        </div>`;
    }).join('\n');

    return `<div class="construction-queue">
      <h3 class="construction-queue__title">Construction Queue (${constructions.length})</h3>
      <div class="construction-queue__list">
        ${itemsHtml}
      </div>
    </div>`;
  },

  // -------------------------------------------------------------------------
  // bindBuildActions
  // -------------------------------------------------------------------------

  /**
   * Attaches click event handlers to build buttons and cancel buttons that
   * exist in the current DOM. Call this after injecting the rendered HTML.
   *
   * Delegates via the closest parent container so it tolerates re-renders when
   * you swap out inner HTML.
   *
   * @param {object} buildSystem - Instance of BuildSystem
   * @param {object} gameState   - Mutable game state
   * @param {object} [options]
   * @param {string} [options.buildPanelSelector='#buildPanel'] - Root selector for the build panel
   * @param {string} [options.queueSelector='.construction-queue'] - Root selector for the queue
   * @param {Function} [options.onBuildStarted] - Optional callback after a build starts
   * @param {Function} [options.onCancelled] - Optional callback after a cancel
   */
  bindBuildActions(buildSystem, gameState, options = {}) {
    const {
      buildPanelSelector = '#buildPanel',
      queueSelector = '.construction-queue',
      onBuildStarted = null,
      onCancelled = null,
    } = options;

    // --- Build panel interactions ---
    const buildPanel = document.querySelector(buildPanelSelector);
    if (buildPanel) {
      // Remove old listener to prevent duplicates on re-bind
      if (buildPanel._buildClickHandler) {
        buildPanel.removeEventListener('click', buildPanel._buildClickHandler);
      }

      const buildClickHandler = (event) => {
        const target = event.target;

        // Tab switching
        const tabBtn = target.closest('.build-tab');
        if (tabBtn) {
          const tabId = tabBtn.dataset.tab;
          // Deactivate all tabs & panels
          buildPanel.querySelectorAll('.build-tab').forEach(b => {
            b.classList.remove('build-tab--active');
            b.setAttribute('aria-selected', 'false');
          });
          buildPanel.querySelectorAll('.build-tab-panel').forEach(p => {
            p.classList.remove('build-tab-panel--active');
          });
          // Activate selected
          tabBtn.classList.add('build-tab--active');
          tabBtn.setAttribute('aria-selected', 'true');
          const panel = buildPanel.querySelector(`[data-tab-panel="${tabId}"]`);
          if (panel) panel.classList.add('build-tab-panel--active');
          return;
        }

        // Cancel build mode
        const cancelModeBtn = target.closest('.cancel-build-mode-btn');
        if (cancelModeBtn) {
          buildSystem.cancelBuildMode();
          return;
        }

        // Build item button
        const buildBtn = target.closest('.build-item-btn');
        if (buildBtn && !buildBtn.disabled) {
          const itemType = buildBtn.dataset.itemType;
          if (!itemType) return;

          // Prompt for position if the game provides a picker, otherwise use
          // a default position. Integrations can override via gameState.pendingPosition.
          const position = (gameState.pendingPosition) || { lat: 0, lng: 0 };
          const result = buildSystem.startConstruction(itemType, position, gameState);

          if (result.success) {
            if (typeof onBuildStarted === 'function') {
              onBuildStarted(result.construction);
            }
          } else {
            // Surface the error to the user in a non-blocking way
            const errorEl = buildPanel.querySelector('.build-panel__error');
            if (errorEl) {
              errorEl.textContent = result.message;
              errorEl.hidden = false;
              setTimeout(() => { errorEl.hidden = true; }, 4000);
            } else {
              console.warn('BuildPanelRenderer:', result.message);
            }
          }
          return;
        }
      };

      buildPanel._buildClickHandler = buildClickHandler;
      buildPanel.addEventListener('click', buildClickHandler);
    }

    // --- Construction queue interactions ---
    const queueEl = document.querySelector(queueSelector);
    if (queueEl) {
      if (queueEl._cancelClickHandler) {
        queueEl.removeEventListener('click', queueEl._cancelClickHandler);
      }

      const cancelClickHandler = (event) => {
        const cancelBtn = event.target.closest('.cancel-construction-btn');
        if (!cancelBtn) return;

        const constructionId = cancelBtn.dataset.constructionId;
        if (!constructionId) return;

        // Confirm before cancelling to prevent accidental clicks
        const confirmed =
          typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm('Cancel this construction? You will receive a 50% refund.')
            : true; // In non-browser environments, proceed without confirmation

        if (!confirmed) return;

        const result = buildSystem.cancelConstruction(constructionId, gameState);

        if (result.success) {
          // Remove the DOM item immediately for responsiveness
          const item = queueEl.querySelector(`[data-construction-id="${constructionId}"]`);
          if (item) item.remove();

          // Show empty state if nothing left
          const remaining = queueEl.querySelectorAll('.construction-item');
          if (remaining.length === 0) {
            const list = queueEl.querySelector('.construction-queue__list');
            if (list) {
              list.innerHTML = '<p class="construction-queue__empty-msg">No active constructions.</p>';
            }
            const title = queueEl.querySelector('.construction-queue__title');
            if (title) title.textContent = 'Construction Queue (0)';
          } else {
            const title = queueEl.querySelector('.construction-queue__title');
            if (title) title.textContent = `Construction Queue (${remaining.length})`;
          }

          if (typeof onCancelled === 'function') {
            onCancelled(result);
          }
        } else {
          console.warn('BuildPanelRenderer: cancel failed -', result.message);
        }
      };

      queueEl._cancelClickHandler = cancelClickHandler;
      queueEl.addEventListener('click', cancelClickHandler);
    }
  },
};
