/**
 * main.js — SkiVille entry point.
 * Wires together all game systems, renderers, and UI.
 */

import { GameEngine } from './engine/GameEngine.js';
import { TerrainEngine } from './rendering/TerrainEngine.js';
import { EntityRenderer } from './rendering/EntityRenderer.js';
import { RunRenderer } from './rendering/RunRenderer.js';
import { LiftAnimator } from './rendering/LiftAnimator.js';
import { GuestVisualizer } from './rendering/GuestVisualizer.js';
import { VisualEffectsRenderer } from './rendering/VisualEffectsRenderer.js';
import { HudManager } from './ui/HudManager.js';
import { PanelManager } from './ui/PanelManager.js';
import { BuildSystem } from './engine/BuildSystem.js';
import { OperationsSystem } from './engine/OperationsSystem.js';
import { UpgradeSystem } from './engine/UpgradeSystem.js';
import { EventSystem } from './engine/EventSystem.js';
import { ActivitySystem } from './engine/ActivitySystem.js';
import { FinanceTracker } from './engine/FinanceTracker.js';
import { generateRunCoords } from './data/runCoords.js';
import {
  LIFTS, RUNS, HOTELS, RESTAURANTS, BARS, SHOPS, CONDOS, PARKING, RESORT_CONFIG,
} from './data/index.js';

// ---------------------------------------------------------------------------
// Loading helpers
// ---------------------------------------------------------------------------

function setLoadingProgress(pct) {
  const bar = document.getElementById('loading-bar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function setLoadingText(msg) {
  const el = document.getElementById('loading-text');
  if (el) el.textContent = msg;
}

function hideLoadingScreen() {
  return new Promise((resolve) => {
    const screen = document.getElementById('loading-screen');
    if (!screen) { resolve(); return; }
    screen.style.transition = 'opacity 0.6s ease';
    screen.style.opacity = '0';
    screen.addEventListener('transitionend', () => {
      screen.style.display = 'none';
      resolve();
    }, { once: true });
    setTimeout(() => { screen.style.display = 'none'; resolve(); }, 800);
  });
}

function showCesiumFallback(err) {
  const container = document.getElementById('cesium-container');
  if (container) {
    container.style.background = 'linear-gradient(135deg, #0d1520 0%, #1a2a3a 40%, #253545 100%)';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#4a90d9;font-family:sans-serif;text-align:center;padding:2rem;max-width:420px';
    msg.innerHTML = `
      <p style="font-size:2rem;margin:0 0 .5rem">🏔️</p>
      <p style="font-size:1.1rem;font-weight:bold;margin:0 0 .75rem">3D Terrain Unavailable</p>
      <p style="font-size:.875rem;opacity:.8;margin:0 0 1rem">
        CesiumJS could not load. The game will run without 3D terrain.
      </p>
      <p style="font-size:.75rem;opacity:.55">${err?.message ?? ''}</p>
    `;
    container.appendChild(msg);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  setLoadingProgress(0);
  setLoadingText('Initializing game engine…');

  try {
    // ── 1. Game Engine + Data ──
    const engine = new GameEngine();
    const state = engine.state;
    state.resort.lifts = LIFTS;
    state.resort.runs = RUNS;
    state.resort.buildings = [...HOTELS, ...RESTAURANTS, ...BARS, ...SHOPS];
    state.resort.name = RESORT_CONFIG.name;

    // ── 2. Engine subsystems ──
    const buildSystem = new BuildSystem();
    const operations = new OperationsSystem();
    const upgrades = new UpgradeSystem();
    const events = new EventSystem();
    const activities = new ActivitySystem();
    const finance = new FinanceTracker();

    // Attach to engine for access
    engine.buildSystem = buildSystem;
    engine.operations = operations;
    engine.upgrades = upgrades;
    engine.events = events;
    engine.activities = activities;
    engine.finance = finance;

    setLoadingProgress(15);
    setLoadingText('Loading terrain…');

    // ── 3. Terrain Engine ──
    const terrain = new TerrainEngine();
    let viewer = null;
    let cesiumOk = false;

    try {
      const initPromise = terrain.init();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Terrain timed out after 15s')), 15000)
      );
      viewer = await Promise.race([initPromise, timeoutPromise]);
      cesiumOk = true;
    } catch (cesiumErr) {
      console.warn('CesiumJS failed:', cesiumErr);
      showCesiumFallback(cesiumErr);
    }

    setLoadingProgress(35);
    setLoadingText('Generating run coordinates…');

    // ── 4. Run GPS Coordinates ──
    const runCoordsMap = generateRunCoords(LIFTS, RUNS);

    setLoadingProgress(45);
    setLoadingText('Building resort entities…');

    // ── 5. Renderers ──
    const entities = new EntityRenderer(viewer);
    entities.init({
      lifts: LIFTS,
      runs: RUNS,
      buildings: [...HOTELS, ...RESTAURANTS, ...BARS, ...SHOPS],
      condos: CONDOS,
      parking: PARKING,
    });

    const runRenderer = new RunRenderer(viewer);
    runRenderer.init(runCoordsMap, RUNS);

    const liftAnimator = new LiftAnimator(viewer);
    liftAnimator.init(LIFTS);

    const guestViz = new GuestVisualizer(viewer);
    guestViz.init(LIFTS);

    const visualFx = new VisualEffectsRenderer(viewer);
    visualFx.init(LIFTS);

    setLoadingProgress(70);
    setLoadingText('Building UI…');

    // ── 6. UI ──
    const hud = new HudManager();
    hud.init();

    const panels = new PanelManager();
    panels.init();

    // Attach extra systems to panels for access in render methods
    panels._buildSystem = buildSystem;
    panels._operations = operations;
    panels._upgrades = upgrades;
    panels._events = events;
    panels._activities = activities;
    panels._finance = finance;

    setLoadingProgress(90);
    setLoadingText('Wiring events…');

    // ── 7. Event Wiring ──

    // Speed controls
    hud.on('speedChange', ({ action, speed }) => {
      if (action === 'pause') {
        engine.state.paused ? engine.resume() : engine.pause();
      } else if (action === 'setSpeed') {
        engine.setSpeed(speed);
        if (engine.state.paused) engine.resume();
      }
    });

    // Tool selection
    hud.on('toolSelected', ({ tool }) => {
      panels.showPanel(tool, engine.getState());
    });

    // Main update loop
    engine.on('update', (s) => {
      // UI updates
      hud.update(s);
      hud.drawMinimap(s);
      panels.update(s);

      // Subsystem updates
      buildSystem.updateConstruction(1 / 60); // rough dt in days
      operations.update(s, 1);
      upgrades.update(1);
      events.update(s, 1);
      activities.update(s, 1);

      // Renderer updates
      entities.update(s);
      runRenderer.update(s);
      liftAnimator.update(s);
      guestViz.update(s);
      visualFx.update(s);

      if (cesiumOk) {
        terrain.update({ time: s.time.hour, weather: s.weather });
      }
    });

    // Daily/monthly reports
    engine.on('dailyReport', (report) => {
      const net = (report.revenue ?? 0) - (report.expenses ?? 0);
      const fmt = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
      hud.showNotification(
        net >= 0 ? 'success' : 'warning',
        'Daily Report',
        `Revenue: ${fmt(report.revenue)} | Expenses: ${fmt(report.expenses)} | Net: ${net >= 0 ? '+' : ''}${fmt(net)}`,
        7000,
      );
      finance.recordDailySnapshot(engine.getState());
    });

    engine.on('monthlyReport', (report) => {
      const rev = report.revenue ?? report.totalRevenue ?? 0;
      const exp = report.expenses ?? report.totalExpenses ?? 0;
      const profit = rev - exp;
      const fmt = (n) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
      hud.showNotification(
        profit >= 0 ? 'success' : 'danger',
        'Monthly P&L',
        `Revenue: ${fmt(rev)} | Expenses: ${fmt(exp)} | Profit: ${profit >= 0 ? '+' : ''}${fmt(profit)}`,
        10000,
      );
      finance.recordMonthlySnapshot(engine.getState());
    });

    // Build system events
    buildSystem.on('constructionComplete', (item) => {
      hud.showNotification('success', 'Construction Complete', `${item.name} is ready!`, 6000);
      // Add to resort data
      if (item.category === 'lift') {
        state.resort.lifts.push({ id: item.id, name: item.name, type: item.type, status: 'open', coords: { base: item.position, peak: item.position } });
      } else {
        state.resort.buildings.push({ id: item.id, name: item.name, type: item.type, coords: item.position });
      }
    });

    // Event system notifications
    events.on('eventTriggered', (event) => {
      const isGood = event.type === 'vip-visit' || event.type === 'powder-day';
      hud.showNotification(
        isGood ? 'success' : 'warning',
        event.title || 'Event',
        event.description || '',
        8000,
      );
    });

    // Upgrade completions
    upgrades.on('upgradeComplete', (upgrade) => {
      hud.showNotification('success', 'Upgrade Complete', `${upgrade.name} is now active!`, 6000);
    });

    // Panel close
    document.getElementById('panel-close')?.addEventListener('click', () => panels.hidePanel());

    // ── 8. Keyboard Shortcuts ──
    document.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          engine.state.paused ? engine.resume() : engine.pause();
          break;
        case '1': engine.setSpeed(1); if (engine.state.paused) engine.resume(); break;
        case '2': engine.setSpeed(2); if (engine.state.paused) engine.resume(); break;
        case '3': engine.setSpeed(3); if (engine.state.paused) engine.resume(); break;
        case 'Escape': panels.hidePanel(); hud.setActiveTool(null); break;
        case 'b': case 'B': panels.showPanel('build', engine.getState()); break;
      }
    });

    // ── 9. Finish ──
    setLoadingProgress(100);
    setLoadingText('Welcome to Skiville!');
    await hideLoadingScreen();

    engine.start();
    engine.pause();

    hud.showNotification(
      'success',
      'Welcome to Skiville!',
      `Managing ${RESORT_CONFIG.name} — ${RESORT_CONFIG.skiableAcres.toLocaleString()} skiable acres. Press Space to start.`,
      8000,
    );

    setTimeout(() => engine.resume(), 1500);

  } catch (err) {
    console.error('SkiVille failed to initialise:', err);
    setLoadingProgress(100);
    setLoadingText('Error — see console.');
    const screen = document.getElementById('loading-screen');
    if (screen) screen.style.display = 'none';
    showCesiumFallback(err);
  }
})();
