/**
 * UpgradePanelRenderer.js
 * Renders the upgrade panel and technology-tree UI for Skiville.
 * Exported as a plain object of render / bind functions (mirrors BuildPanelRenderer).
 */

'use strict';

import { UPGRADE_CATEGORIES } from '../engine/UpgradeSystem.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Formats a dollar amount into a compact human-readable string.
 * Examples: 5000000 → "$5M", 1500000 → "$1.5M", 300000 → "$300K"
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
    const years = (days / 365).toFixed(1).replace(/\.0$/, '');
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
 * Escapes text content so it is safe to insert between HTML tags.
 * @param {string} str
 * @returns {string}
 */
function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts a camelCase effects key + numeric value to a concise UI string.
 * Examples:
 *   liftCapacityMultiplier 1.20  → "+20% lift capacity"
 *   guestSatisfactionBonus 10    → "+10% guest satisfaction"
 *   skiableAcresBonus 500        → "+500 skiable acres"
 *
 * @param {string} key
 * @param {*} value
 * @returns {string}
 */
function _formatEffect(key, value) {
  // Boolean flags
  if (typeof value === 'boolean') {
    const labelMap = {
      windResistant:          'Wind-resistant operation',
      corporateEventsEnabled: 'Enables corporate events revenue',
      competitionsEnabled:    'Enables sanctioned competitions',
    };
    return labelMap[key] ?? key;
  }

  // Multipliers — express as percentage change
  if (key.endsWith('Multiplier') && typeof value === 'number') {
    const pct = Math.round((value - 1) * 100);
    const sign = pct >= 0 ? '+' : '';
    const label = key
      .replace('Multiplier', '')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    return `${sign}${pct}% ${label}`;
  }

  // Additive bonuses
  if (key.endsWith('Bonus') && typeof value === 'number') {
    // Decide whether it's a plain number or a percentage
    const label = key
      .replace('Bonus', '')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .trim();
    // Small values (≤ 1) are treated as fractions → display as %
    if (Math.abs(value) <= 1) {
      const pct = Math.round(value * 100);
      const sign = pct >= 0 ? '+' : '';
      return `${sign}${pct}% ${label}`;
    }
    // Larger values are plain numbers
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value} ${label}`;
  }

  // String values (e.g. operatingHoursExtension)
  if (typeof value === 'string') {
    const label = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    return `${label}: ${value}`;
  }

  // Fallback
  return `${key}: ${value}`;
}

/**
 * Renders the list of effect tags for a single upgrade definition.
 * @param {object} effects
 * @returns {string} HTML
 */
function _renderEffectTags(effects) {
  const items = Object.entries(effects)
    .map(([k, v]) => `<span class="upgrade-effect-tag">${_escHtml(_formatEffect(k, v))}</span>`)
    .join('');
  return `<div class="upgrade-effects">${items}</div>`;
}

/**
 * Determines the display state of an upgrade for the current game context.
 *
 * @param {object} upgrade       - Upgrade definition from catalog
 * @param {object} upgradeSystem - UpgradeSystem instance
 * @param {object} catalog       - Full catalog (for prereq name lookup)
 * @returns {'applied'|'active'|'available'|'locked'}
 */
function _upgradeState(upgrade, upgradeSystem, catalog) {
  if (upgradeSystem.isUpgradeApplied(upgrade.id)) return 'applied';

  const active = upgradeSystem.getActiveUpgrades();
  if (active.some(a => a.upgrade.id === upgrade.id)) return 'active';

  // Check prerequisites
  const prereqsMet = (upgrade.prerequisites ?? []).every(pid =>
    upgradeSystem.isUpgradeApplied(pid)
  );
  return prereqsMet ? 'available' : 'locked';
}

// ---------------------------------------------------------------------------
// Card renderers
// ---------------------------------------------------------------------------

/**
 * Renders a single upgrade card.
 *
 * @param {object} upgrade        - Upgrade definition
 * @param {'applied'|'active'|'available'|'locked'} state
 * @param {object} upgradeSystem  - For progress data when state === 'active'
 * @param {object} gameState      - For affordability check
 * @param {object} catalog        - Full catalog (prereq name lookup)
 * @returns {string} HTML
 */
function _renderUpgradeCard(upgrade, state, upgradeSystem, gameState, catalog) {
  const canAfford = (gameState?.money ?? 0) >= upgrade.cost;
  const stateClass = `upgrade-card--${state}`;

  // ---- Header ----
  let statusBadge = '';
  if (state === 'applied') {
    statusBadge = '<span class="upgrade-badge upgrade-badge--applied">&#10003; Applied</span>';
  } else if (state === 'active') {
    statusBadge = '<span class="upgrade-badge upgrade-badge--active">Building...</span>';
  } else if (state === 'locked') {
    statusBadge = '<span class="upgrade-badge upgrade-badge--locked">Locked</span>';
  }

  const header = `
    <div class="upgrade-card-header">
      <span class="upgrade-name">${_escHtml(upgrade.name)}</span>
      ${statusBadge}
    </div>`;

  // ---- Meta row (cost + build time) ----
  const costClass = !canAfford && state === 'available' ? ' upgrade-cost--unaffordable' : '';
  const meta = `
    <div class="upgrade-meta">
      <span class="upgrade-cost${costClass}">${_formatMoney(upgrade.cost)}</span>
      <span class="upgrade-build-time">&#128336; ${_formatBuildTime(upgrade.buildTimeDays)}</span>
    </div>`;

  // ---- Description ----
  const desc = `<p class="upgrade-desc">${_escHtml(upgrade.description)}</p>`;

  // ---- Effects ----
  const effects = _renderEffectTags(upgrade.effects);

  // ---- Prerequisites note (when locked) ----
  let prereqNote = '';
  if (state === 'locked') {
    const missingNames = (upgrade.prerequisites ?? [])
      .filter(pid => !upgradeSystem.isUpgradeApplied(pid))
      .map(pid => catalog[pid]?.name ?? pid)
      .join(', ');
    prereqNote = `<p class="upgrade-prereq-note">Requires: ${_escHtml(missingNames)}</p>`;
  }

  // ---- Progress bar (when active) ----
  let progressBar = '';
  if (state === 'active') {
    const activeList = upgradeSystem.getActiveUpgrades();
    const entry = activeList.find(a => a.upgrade.id === upgrade.id);
    const pct = entry ? entry.progressPct : 0;
    const daysLeft = entry
      ? Math.ceil(entry.totalDays - entry.elapsedDays)
      : upgrade.buildTimeDays;
    progressBar = `
      <div class="upgrade-progress">
        <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <span class="progress-label">${pct}% — ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left</span>
      </div>`;
  }

  // ---- Action button ----
  let actionBtn = '';
  if (state === 'available') {
    const disabled = !canAfford ? ' disabled' : '';
    const label = canAfford ? 'Start Upgrade' : `Need ${_formatMoney(upgrade.cost - (gameState?.money ?? 0))} more`;
    actionBtn = `
      <button
        class="action-btn btn-primary upgrade-start-btn"
        data-upgrade-id="${_escAttr(upgrade.id)}"
        ${disabled}
        aria-label="Start upgrade: ${_escAttr(upgrade.name)}"
      >${_escHtml(label)}</button>`;
  }

  return `
  <div class="upgrade-card ${stateClass}" data-upgrade-id="${_escAttr(upgrade.id)}">
    ${header}
    ${meta}
    ${desc}
    ${effects}
    ${prereqNote}
    ${progressBar}
    ${actionBtn}
  </div>`.trim();
}

// ---------------------------------------------------------------------------
// Tech-tree helpers
// ---------------------------------------------------------------------------

/**
 * Builds an indented tree HTML list showing prerequisite chains for all
 * upgrades within a given category.  Root nodes (no prerequisites) are at
 * the top level; children are nested below their parent.
 *
 * @param {object[]} upgrades     - All upgrade definitions for the category
 * @param {object} upgradeSystem
 * @returns {string} HTML
 */
function _renderTreeForCategory(upgrades, upgradeSystem) {
  // Find roots: upgrades whose prerequisites (if any) are NOT in this category
  const idsInCategory = new Set(upgrades.map(u => u.id));

  const roots = upgrades.filter(u =>
    (u.prerequisites ?? []).every(pid => !idsInCategory.has(pid))
  );

  // Build a child-lookup map
  const childrenOf = {};
  for (const u of upgrades) {
    for (const pid of (u.prerequisites ?? [])) {
      if (!childrenOf[pid]) childrenOf[pid] = [];
      childrenOf[pid].push(u);
    }
  }

  function renderNode(u, depth) {
    const state = upgradeSystem.isUpgradeApplied(u.id)
      ? 'applied'
      : upgradeSystem.getActiveUpgrades().some(a => a.upgrade.id === u.id)
        ? 'active'
        : 'available';

    const stateIcon = state === 'applied' ? '&#10003;'
      : state === 'active' ? '&#9201;'
      : '&#9675;';  // empty circle = not yet started

    const stateClass = `tree-node--${state}`;
    const indent = depth > 0
      ? `<span class="tree-indent" style="padding-left:${depth * 20}px">&#8627; </span>`
      : '';

    const costStr = _formatMoney(u.cost);
    const timeStr = _formatBuildTime(u.buildTimeDays);

    let html = `
      <li class="tree-node ${stateClass}" data-upgrade-id="${_escAttr(u.id)}">
        ${indent}<span class="tree-node-icon">${stateIcon}</span>
        <span class="tree-node-name">${_escHtml(u.name)}</span>
        <span class="tree-node-meta">${costStr} &bull; ${timeStr}</span>
      </li>`;

    const children = childrenOf[u.id] ?? [];
    for (const child of children) {
      html += renderNode(child, depth + 1);
    }
    return html;
  }

  const listItems = roots.map(r => renderNode(r, 0)).join('');
  return `<ul class="tech-tree-list">${listItems}</ul>`;
}

// ---------------------------------------------------------------------------
// Exported renderer object
// ---------------------------------------------------------------------------

export const UpgradePanelRenderer = {

  // Expose for testing
  _formatMoney,
  _formatBuildTime,
  _formatEffect,

  // -------------------------------------------------------------------------
  // renderUpgradePanel
  // -------------------------------------------------------------------------

  /**
   * Renders the full upgrade panel HTML.
   *
   * @param {object} gameState       - Must expose `money` (number)
   * @param {object} upgradeSystem   - UpgradeSystem instance
   * @param {string} [activeTab]     - Category ID of the active tab (default: 'lifts')
   * @returns {string} HTML string
   */
  renderUpgradePanel(gameState, upgradeSystem, activeTab = 'lifts') {
    const catalog = upgradeSystem.getCatalog();
    const money = gameState?.money ?? 0;

    // ---- Summary bar ----
    const appliedCount = upgradeSystem.getAppliedUpgrades().size;
    const totalCount = Object.keys(catalog).length;
    const activeCount = upgradeSystem.getActiveUpgrades().length;

    const summaryHtml = `
      <div class="upgrade-summary-bar">
        <span class="upgrade-summary-stat">
          <strong>${appliedCount}</strong> / ${totalCount} upgrades completed
        </span>
        ${activeCount > 0 ? `<span class="upgrade-summary-stat upgrade-summary-stat--active">
          <strong>${activeCount}</strong> in progress
        </span>` : ''}
        <span class="upgrade-summary-stat upgrade-summary-balance">
          Balance: <strong>${_formatMoney(money)}</strong>
        </span>
      </div>`;

    // ---- Tab bar ----
    const tabBarHtml = UPGRADE_CATEGORIES.map(cat => {
      const isActive = cat.id === activeTab;

      // Count available (unlocked, not yet started) upgrades in this category
      const availableInCat = Object.values(catalog).filter(u =>
        u.category === cat.id &&
        !upgradeSystem.isUpgradeApplied(u.id) &&
        !upgradeSystem.getActiveUpgrades().some(a => a.upgrade.id === u.id)
      ).length;

      const badge = availableInCat > 0
        ? `<span class="tab-badge">${availableInCat}</span>`
        : '';

      return `<button
          class="upgrade-tab${isActive ? ' upgrade-tab--active' : ''}"
          data-upgrade-tab="${_escAttr(cat.id)}"
          aria-selected="${isActive}"
          role="tab"
        >${_escHtml(cat.icon)} ${_escHtml(cat.label)}${badge}</button>`;
    }).join('\n');

    // ---- Tab panels ----
    const tabPanelsHtml = UPGRADE_CATEGORIES.map(cat => {
      const isActive = cat.id === activeTab;

      const upgradesInCat = Object.values(catalog).filter(u => u.category === cat.id);

      if (upgradesInCat.length === 0) {
        return `<div
            class="upgrade-tab-panel${isActive ? ' upgrade-tab-panel--active' : ''}"
            data-upgrade-tab-panel="${_escAttr(cat.id)}"
            role="tabpanel"
          >
          <p class="upgrade-empty">No upgrades available in this category yet.</p>
        </div>`;
      }

      // Sort: applied last, then active, then available, then locked
      const order = { applied: 3, active: 1, available: 0, locked: 2 };
      const sorted = [...upgradesInCat].sort((a, b) => {
        const sa = _upgradeState(a, upgradeSystem, catalog);
        const sb = _upgradeState(b, upgradeSystem, catalog);
        return order[sa] - order[sb];
      });

      const cardsHtml = sorted.map(u => {
        const state = _upgradeState(u, upgradeSystem, catalog);
        return _renderUpgradeCard(u, state, upgradeSystem, gameState, catalog);
      }).join('\n');

      return `<div
          class="upgrade-tab-panel${isActive ? ' upgrade-tab-panel--active' : ''}"
          data-upgrade-tab-panel="${_escAttr(cat.id)}"
          role="tabpanel"
        >
        <div class="upgrade-card-grid">
          ${cardsHtml}
        </div>
      </div>`;
    }).join('\n');

    return `
<div class="upgrade-panel" id="upgrade-panel">
  <div class="upgrade-panel-header">
    <h2 class="upgrade-panel-title">Resort Upgrades</h2>
    <button class="action-btn btn-secondary upgrade-tech-tree-btn" data-action="showTechTree"
      aria-label="View technology tree">Tech Tree</button>
  </div>
  ${summaryHtml}
  <div class="upgrade-tab-bar" role="tablist" aria-label="Upgrade categories">
    ${tabBarHtml}
  </div>
  <div class="upgrade-tab-panels">
    ${tabPanelsHtml}
  </div>
</div>`.trim();
  },

  // -------------------------------------------------------------------------
  // renderTechTree
  // -------------------------------------------------------------------------

  /**
   * Renders the full technology-tree view.  Each category is shown as a
   * section with an indented prerequisite chain list.
   *
   * @param {object} upgradeSystem - UpgradeSystem instance
   * @returns {string} HTML string
   */
  renderTechTree(upgradeSystem) {
    const catalog = upgradeSystem.getCatalog();

    // Legend
    const legendHtml = `
      <div class="tech-tree-legend">
        <span class="legend-item legend-item--applied">&#10003; Applied</span>
        <span class="legend-item legend-item--active">&#9201; In progress</span>
        <span class="legend-item legend-item--available">&#9675; Available</span>
      </div>`;

    const sectionsHtml = UPGRADE_CATEGORIES.map(cat => {
      const upgradesInCat = Object.values(catalog).filter(u => u.category === cat.id);
      if (upgradesInCat.length === 0) return '';

      const treeHtml = _renderTreeForCategory(upgradesInCat, upgradeSystem);

      return `
      <section class="tech-tree-section" data-category="${_escAttr(cat.id)}">
        <h3 class="tech-tree-section-title">${_escHtml(cat.icon)} ${_escHtml(cat.label)}</h3>
        ${treeHtml}
      </section>`;
    }).join('\n');

    return `
<div class="tech-tree-panel" id="tech-tree-panel">
  <div class="tech-tree-header">
    <h2 class="tech-tree-title">Technology Tree</h2>
    <button class="action-btn btn-secondary tech-tree-close-btn" data-action="closeTechTree"
      aria-label="Close technology tree">&#10005; Close</button>
  </div>
  ${legendHtml}
  <div class="tech-tree-body">
    ${sectionsHtml}
  </div>
</div>`.trim();
  },

  // -------------------------------------------------------------------------
  // bindUpgradeActions
  // -------------------------------------------------------------------------

  /**
   * Attaches all click-handler logic to the rendered upgrade panel and tech
   * tree.  Call this after inserting the rendered HTML into the DOM.
   *
   * Handles:
   *   - Tab switching (upgrade-tab buttons)
   *   - Start upgrade (upgrade-start-btn buttons)
   *   - Show / close tech tree overlay
   *
   * @param {object} upgradeSystem  - UpgradeSystem instance
   * @param {object} gameState      - Live game state reference
   * @param {object} [options]
   * @param {Function} [options.onPanelRefresh]   - Called after any state change so the
   *                                               caller can re-render the panel.
   * @param {Function} [options.onNotification]   - Called with (message, type) for toasts.
   * @param {Element}  [options.root=document]    - Root element to scope event listeners.
   */
  bindUpgradeActions(upgradeSystem, gameState, options = {}) {
    const root = options.root ?? document;
    const onPanelRefresh = options.onPanelRefresh ?? (() => {});
    const onNotification = options.onNotification ?? ((msg, type) => {
      if (type === 'error') console.warn('[UpgradePanel]', msg);
      else console.info('[UpgradePanel]', msg);
    });

    // Track which tab is currently active so we can pass it back to re-render
    let activeTab = 'lifts';

    // ------------------------------------------------------------------
    // Helper: re-render and re-bind
    // ------------------------------------------------------------------
    const refresh = () => onPanelRefresh(activeTab);

    // ------------------------------------------------------------------
    // Tab switching — delegate on the tab bar
    // ------------------------------------------------------------------
    const tabBar = root.querySelector('.upgrade-tab-bar');
    if (tabBar) {
      tabBar.addEventListener('click', e => {
        const btn = e.target.closest('[data-upgrade-tab]');
        if (!btn) return;

        activeTab = btn.dataset.upgradeTab;

        // Toggle active class without a full re-render (fast path)
        tabBar.querySelectorAll('.upgrade-tab').forEach(b => {
          b.classList.toggle('upgrade-tab--active', b === btn);
          b.setAttribute('aria-selected', String(b === btn));
        });

        const panels = root.querySelectorAll('[data-upgrade-tab-panel]');
        panels.forEach(panel => {
          const isActive = panel.dataset.upgradeTabPanel === activeTab;
          panel.classList.toggle('upgrade-tab-panel--active', isActive);
        });
      });
    }

    // ------------------------------------------------------------------
    // Start upgrade buttons — delegated on the whole panel
    // ------------------------------------------------------------------
    const panel = root.querySelector('#upgrade-panel');
    if (panel) {
      panel.addEventListener('click', e => {
        const btn = e.target.closest('.upgrade-start-btn');
        if (!btn || btn.disabled) return;

        const upgradeId = btn.dataset.upgradeId;
        if (!upgradeId) return;

        const result = upgradeSystem.startUpgrade(upgradeId, gameState);

        if (result.success) {
          const upgrade = upgradeSystem.getUpgradeById(upgradeId);
          onNotification(
            `Started: ${upgrade?.name ?? upgradeId} — completes in ${_formatBuildTime(upgrade?.buildTimeDays ?? 0)}`,
            'info'
          );
          refresh();
        } else {
          onNotification(result.reason, 'error');
        }
      });
    }

    // ------------------------------------------------------------------
    // Tech tree open / close
    // ------------------------------------------------------------------
    const showTreeBtn = root.querySelector('[data-action="showTechTree"]');
    if (showTreeBtn) {
      showTreeBtn.addEventListener('click', () => {
        let overlay = root.querySelector('#tech-tree-overlay');
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.id = 'tech-tree-overlay';
          overlay.className = 'tech-tree-overlay';
          overlay.innerHTML = this.renderTechTree(upgradeSystem);
          document.body.appendChild(overlay);

          // Close on overlay background click
          overlay.addEventListener('click', e => {
            if (e.target === overlay) overlay.remove();
          });

          // Close button inside the panel
          const closeBtn = overlay.querySelector('[data-action="closeTechTree"]');
          if (closeBtn) {
            closeBtn.addEventListener('click', () => overlay.remove());
          }
        } else {
          // Refresh the tree content in place
          overlay.innerHTML = this.renderTechTree(upgradeSystem);
          overlay.style.display = 'flex';

          const closeBtn = overlay.querySelector('[data-action="closeTechTree"]');
          if (closeBtn) {
            closeBtn.addEventListener('click', () => overlay.remove());
          }
        }
      });
    }

    // ------------------------------------------------------------------
    // Listen for system events to auto-refresh the panel
    // ------------------------------------------------------------------
    upgradeSystem.on('upgradeStarted', () => refresh());
    upgradeSystem.on('upgradeComplete', ({ upgrade }) => {
      onNotification(`Upgrade complete: ${upgrade.name}!`, 'success');
      refresh();
    });
    upgradeSystem.on('upgradeFailed', ({ reason }) => {
      onNotification(reason, 'error');
    });
  },
};
