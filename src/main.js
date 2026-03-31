/**
 * main.js — SkiVille entry point.
 *
 * Wires together all game systems: terrain rendering, entity display,
 * HUD, panels, and the core game engine. Handles loading sequencing,
 * event plumbing, keyboard shortcuts, and first-launch startup.
 *
 * Side-effect module — exports nothing.
 */

import { GameEngine }    from './engine/GameEngine.js';
import { TerrainEngine } from './rendering/TerrainEngine.js';
import { EntityRenderer } from './rendering/EntityRenderer.js';
import { HudManager }    from './ui/HudManager.js';
import { PanelManager }  from './ui/PanelManager.js';
import {
  LIFTS,
  RUNS,
  HOTELS,
  RESTAURANTS,
  BARS,
  SHOPS,
  CONDOS,
  PARKING,
  RESORT_CONFIG,
} from './data/index.js';

// ---------------------------------------------------------------------------
// Loading screen helpers
// ---------------------------------------------------------------------------

/** @param {number} pct  0-100 */
function setLoadingProgress(pct) {
  const bar = document.getElementById('loading-bar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

/** @param {string} msg */
function setLoadingText(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

/**
 * Fade out the loading screen and reveal the game container.
 * @returns {Promise<void>}
 */
function hideLoadingScreen() {
  return new Promise((resolve) => {
    const screen = document.getElementById('loading-screen');
    const game   = document.getElementById('game-container');

    if (game) game.style.display = 'block';

    if (!screen) { resolve(); return; }

    screen.style.transition = 'opacity 0.6s ease';
    screen.style.opacity    = '0';

    screen.addEventListener('transitionend', () => {
      screen.style.display = 'none';
      resolve();
    }, { once: true });

    // Safety fallback in case transitionend never fires
    setTimeout(resolve, 800);
  });
}

// ---------------------------------------------------------------------------
// Cesium fallback — show dark background when Ion token is missing
// ---------------------------------------------------------------------------

function showCesiumFallback(err) {
  const container = document.getElementById('cesium-container');
  if (container) {
    container.style.background =
      'linear-gradient(135deg, #0d1520 0%, #1a2a3a 40%, #253545 100%)';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';

    const msg = document.createElement('div');
    msg.style.cssText =
      'color:#4a90d9;font-family:sans-serif;text-align:center;padding:2rem;max-width:420px';
    msg.innerHTML = `
      <p style="font-size:2rem;margin:0 0 .5rem">🏔️</p>
      <p style="font-size:1.1rem;font-weight:bold;margin:0 0 .75rem">
        3D Terrain Unavailable
      </p>
      <p style="font-size:.875rem;opacity:.8;margin:0 0 1rem">
        CesiumJS could not load the terrain viewer. Set a valid
        <code>CESIUM_ION_ACCESS_TOKEN</code> to enable 3D terrain.
      </p>
      <p style="font-size:.75rem;opacity:.55">${err?.message ?? ''}</p>
    `;
    container.appendChild(msg);
  }
}

// ---------------------------------------------------------------------------
// Main async IIFE
// ---------------------------------------------------------------------------

(async () => {
  // ── 0 · Boot ─────────────────────────────────────────────────────────────
  setLoadingProgress(0);
  setLoadingText('Initializing game engine…');

  try {
    // ── 1 · Game Engine ────────────────────────────────────────────────────
    const engine = new GameEngine();
    const state  = engine.state;

    // Seed resort data from static data files
    state.resort.lifts     = LIFTS;
    state.resort.runs      = RUNS;
    state.resort.buildings = [...HOTELS, ...RESTAURANTS, ...BARS, ...SHOPS];
    state.resort.name      = RESORT_CONFIG.name;

    setLoadingProgress(15);
    setLoadingText('Loading terrain data…');

    // ── 2 · Terrain Engine ─────────────────────────────────────────────────
    const terrain = new TerrainEngine();
    let viewer    = null;
    let cesiumOk  = false;

    try {
      viewer   = await terrain.init();
      cesiumOk = true;
    } catch (cesiumErr) {
      console.warn('CesiumJS failed to initialise — running without 3D terrain.', cesiumErr);
      showCesiumFallback(cesiumErr);
    }

    setLoadingProgress(45);
    setLoadingText('Building resort entities…');

    // ── 3 · Entity Renderer ────────────────────────────────────────────────
    const entities = new EntityRenderer(viewer);
    entities.init({
      lifts:     LIFTS,
      runs:      RUNS,
      buildings: [...HOTELS, ...RESTAURANTS, ...BARS, ...SHOPS],
      condos:    CONDOS,
      parking:   PARKING,
    });

    setLoadingProgress(65);
    setLoadingText('Building HUD…');

    // ── 4 · HUD Manager ────────────────────────────────────────────────────
    const hud = new HudManager();
    hud.init();

    setLoadingProgress(80);
    setLoadingText('Preparing panels…');

    // ── 5 · Panel Manager ─────────────────────────────────────────────────
    const panels = new PanelManager();
    panels.init();

    setLoadingProgress(95);
    setLoadingText('Starting simulation…');

    // ── 6 · Wire events ───────────────────────────────────────────────────

    // HUD speed/pause controls → engine
    hud.on('speedChange', ({ action, speed }) => {
      if (action === 'pause') {
        if (engine.state.paused) {
          engine.resume();
        } else {
          engine.pause();
        }
      } else if (action === 'setSpeed') {
        engine.setSpeed(speed);
        if (engine.state.paused) engine.resume();
      }
    });

    // HUD tool selection → panel
    hud.on('toolSelected', ({ tool }) => {
      panels.showPanel(tool, engine.getState());
    });

    // Engine update → all renderers
    engine.on('update', (updatedState) => {
      hud.update(updatedState);
      hud.drawMinimap(updatedState);
      entities.update(updatedState);
      panels.update(updatedState);

      if (cesiumOk) {
        terrain.update({
          time:    updatedState.time.hour,
          weather: updatedState.weather,
        });
      }
    });

    // Daily financial report notification
    engine.on('dailyReport', (report) => {
      const net    = (report.revenue ?? 0) - (report.expenses ?? 0);
      const sign   = net >= 0 ? '+' : '';
      const type   = net >= 0 ? 'success' : 'warning';
      const fmt    = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
      hud.showNotification(
        type,
        'Daily Report',
        `Revenue: ${fmt(report.revenue)}  |  Expenses: ${fmt(report.expenses)}  |  Net: ${sign}${fmt(net)}`,
        7000,
      );
    });

    // Monthly P&L notification
    engine.on('monthlyReport', (report) => {
      const revenue  = report.revenue  ?? report.totalRevenue  ?? 0;
      const expenses = report.expenses ?? report.totalExpenses ?? 0;
      const profit   = revenue - expenses;
      const sign     = profit >= 0 ? '+' : '';
      const type     = profit >= 0 ? 'success' : 'danger';
      const fmt      = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
      hud.showNotification(
        type,
        'Monthly P&L',
        `Revenue: ${fmt(revenue)}  |  Expenses: ${fmt(expenses)}  |  Profit: ${sign}${fmt(profit)}`,
        10000,
      );
    });

    // Panel close button
    const closeBtnEl = document.getElementById('panel-close');
    if (closeBtnEl) {
      closeBtnEl.addEventListener('click', () => panels.hidePanel());
    }

    // ── 7 · Keyboard shortcuts ────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      // Ignore shortcuts when the user is typing in an input
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (engine.state.paused) {
            engine.resume();
          } else {
            engine.pause();
          }
          break;

        case '1':
          engine.setSpeed(1);
          if (engine.state.paused) engine.resume();
          break;

        case '2':
          engine.setSpeed(2);
          if (engine.state.paused) engine.resume();
          break;

        case '3':
          engine.setSpeed(3);
          if (engine.state.paused) engine.resume();
          break;

        case 'Escape':
          panels.hidePanel();
          hud.setActiveTool(null);
          break;
      }
    });

    // ── 8 · Finish loading ────────────────────────────────────────────────
    setLoadingProgress(100);
    setLoadingText('Welcome to Skiville!');

    await hideLoadingScreen();

    // ── 9 · Start simulation ──────────────────────────────────────────────
    engine.start(); // loads save if present, marks paused = false internally,
                    // but we want to start paused so the player sees the welcome

    // Hold paused momentarily so the welcome notification is readable,
    // then let the simulation run
    engine.pause();

    hud.showNotification(
      'success',
      'Welcome to Skiville!',
      `Managing ${RESORT_CONFIG.name} — ${RESORT_CONFIG.skiableAcres.toLocaleString()} skiable acres. Press Space to unpause.`,
      8000,
    );

    // Brief delay then resume
    setTimeout(() => engine.resume(), 1500);

  } catch (err) {
    // ── Fatal error ───────────────────────────────────────────────────────
    console.error('SkiVille failed to initialise:', err);

    setLoadingProgress(100);
    setLoadingText('Error — see console for details.');

    // Still show the UI so the player isn't stuck on a blank loading screen
    const screen = document.getElementById('loading-screen');
    const game   = document.getElementById('game-container');

    if (game)   game.style.display = 'block';
    if (screen) screen.style.display = 'none';

    showCesiumFallback(err);

    // Surface the error in the notification area if the HUD happened to init
    const area = document.getElementById('notification-area');
    if (area) {
      const el = document.createElement('div');
      el.className = 'notification type-danger';
      el.innerHTML = `
        <span class="notification-icon">❌</span>
        <div class="notification-body">
          <div class="notification-title">Initialization Error</div>
          <div class="notification-message">${err?.message ?? String(err)}</div>
        </div>
      `;
      area.appendChild(el);
    }
  }
})();
