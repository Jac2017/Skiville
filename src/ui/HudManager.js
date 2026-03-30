/**
 * HudManager - Manages all HUD updates, toolbar interactions,
 * notifications, speed controls, and the minimap for Skiville.
 */

const WEATHER_ICONS = {
  'clear':         '\u2600\uFE0F',
  'partly-cloudy': '\u26C5',
  'overcast':      '\u2601\uFE0F',
  'light-snow':    '\uD83C\uDF28\uFE0F',
  'heavy-snow':    '\u2744\uFE0F',
  'blizzard':      '\uD83C\uDF2C\uFE0F',
  'freezing-rain': '\uD83C\uDF27\uFE0F',
};

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const RUN_DIFFICULTY_COLORS = {
  green:        '#4caf50',
  blue:         '#2196f3',
  black:        '#999999',
  'double-black': '#ef5350',
};

const NOTIFICATION_ICONS = {
  success: '\u2705',
  warning: '\u26A0\uFE0F',
  danger:  '\u274C',
  info:    '\u2139\uFE0F',
};

const DEFAULT_NOTIFICATION_DURATION = 5000;

export class HudManager {
  constructor() {
    this._listeners = {};
    this._activeTool = null;
    this._minimapVisible = true;
    this._notificationQueue = [];

    // DOM references (populated in init)
    this._els = {};
  }

  // ---------------------------------------------------------------------------
  // Pub / Sub (toolbar events, tool selection, etc.)
  // ---------------------------------------------------------------------------

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    const cbs = this._listeners[event];
    if (cbs) cbs.forEach(cb => cb(data));
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  init() {
    // Cache frequently-accessed DOM elements
    this._els = {
      gameDate:     document.getElementById('game-date'),
      gameTime:     document.getElementById('game-time'),
      weatherIcon:  document.getElementById('weather-icon'),
      weatherTemp:  document.getElementById('weather-temp'),
      snowDepth:    document.getElementById('snow-depth'),
      gameMoney:    document.getElementById('game-money'),
      guestCount:   document.getElementById('guest-count'),
      resortRating: document.getElementById('resort-rating'),
      speedPause:   document.getElementById('speed-pause'),
      speed1x:      document.getElementById('speed-1x'),
      speed2x:      document.getElementById('speed-2x'),
      speed3x:      document.getElementById('speed-3x'),
      toolbar:      document.getElementById('bottom-toolbar'),
      minimap:      document.getElementById('mini-map'),
      minimapCanvas: document.getElementById('mini-map-canvas'),
      notificationArea: document.getElementById('notification-area'),
    };

    this._initSpeedControls();
    this._initToolbar();
    this._initMinimapCanvas();
  }

  // ---------------------------------------------------------------------------
  // Speed controls
  // ---------------------------------------------------------------------------

  _initSpeedControls() {
    const buttons = {
      pause: this._els.speedPause,
      1:     this._els.speed1x,
      2:     this._els.speed2x,
      3:     this._els.speed3x,
    };

    Object.entries(buttons).forEach(([key, btn]) => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        if (key === 'pause') {
          this.emit('speedChange', { action: 'pause' });
        } else {
          this.emit('speedChange', { action: 'setSpeed', speed: Number(key) });
        }
      });
    });
  }

  /**
   * Highlight the active speed button in the HUD. Call after the game engine
   * processes the speed / pause change so the UI stays in sync.
   */
  _highlightSpeedButton(speed, paused) {
    const allBtns = [
      this._els.speedPause,
      this._els.speed1x,
      this._els.speed2x,
      this._els.speed3x,
    ];
    allBtns.forEach(b => { if (b) b.classList.remove('active'); });

    if (paused) {
      if (this._els.speedPause) this._els.speedPause.classList.add('active');
    } else {
      const map = { 1: this._els.speed1x, 2: this._els.speed2x, 3: this._els.speed3x };
      const target = map[speed];
      if (target) target.classList.add('active');
    }
  }

  // ---------------------------------------------------------------------------
  // Toolbar (bottom bar) — tool selection
  // ---------------------------------------------------------------------------

  _initToolbar() {
    if (!this._els.toolbar) return;

    this._els.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('.toolbar-btn');
      if (!btn) return;

      const tool = btn.dataset.tool;
      if (!tool) return;

      this.setActiveTool(tool);
      this.emit('toolSelected', { tool });
    });
  }

  /**
   * Mark a toolbar button as the active tool (highlighted). Pass `null` to
   * deselect all tools.
   */
  setActiveTool(tool) {
    // Remove active class from all toolbar buttons
    const buttons = this._els.toolbar
      ? this._els.toolbar.querySelectorAll('.toolbar-btn')
      : [];
    buttons.forEach(b => b.classList.remove('active'));

    this._activeTool = tool;

    if (tool) {
      const target = this._els.toolbar
        ? this._els.toolbar.querySelector(`.toolbar-btn[data-tool="${tool}"]`)
        : null;
      if (target) target.classList.add('active');
    }
  }

  // ---------------------------------------------------------------------------
  // HUD update (called every game tick)
  // ---------------------------------------------------------------------------

  update(gameState) {
    if (!gameState) return;

    // Date
    if (this._els.gameDate) {
      this._els.gameDate.textContent = this._formatDate(gameState.date);
    }

    // Time
    if (this._els.gameTime) {
      this._els.gameTime.textContent = this._formatTime(
        gameState.time.hour,
        gameState.time.minute,
      );
    }

    // Weather icon + temperature
    if (this._els.weatherIcon) {
      this._els.weatherIcon.textContent =
        WEATHER_ICONS[gameState.weather.state] || '\u2601\uFE0F';
    }
    if (this._els.weatherTemp) {
      const temp = Math.round(gameState.weather.temperatureC);
      this._els.weatherTemp.textContent = `${temp}\u00B0C`;
    }

    // Snow depth
    if (this._els.snowDepth) {
      const depth = Math.round(gameState.resort.snowDepthCm);
      this._els.snowDepth.textContent = `${depth}cm base`;
    }

    // Money
    if (this._els.gameMoney) {
      this._els.gameMoney.textContent = this._formatMoney(gameState.money);
    }

    // Guest count
    if (this._els.guestCount) {
      const count = gameState.guests.current;
      this._els.guestCount.textContent =
        `${count.toLocaleString()} guest${count !== 1 ? 's' : ''}`;
    }

    // Resort rating (stars)
    if (this._els.resortRating) {
      this._els.resortRating.textContent = gameState.rating.toFixed(1);
    }

    // Speed button highlight
    this._highlightSpeedButton(gameState.speed, gameState.paused);
  }

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------

  _formatMoney(amount) {
    const abs = Math.abs(Math.round(amount));
    const formatted = abs.toLocaleString('en-US');
    return amount < 0 ? `-$${formatted}` : `$${formatted}`;
  }

  _formatDate(date) {
    if (!(date instanceof Date)) return '';
    const month = MONTHS[date.getMonth()];
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  }

  _formatTime(hour, minute) {
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  // ---------------------------------------------------------------------------
  // Notification system
  // ---------------------------------------------------------------------------

  /**
   * Display a temporary notification toast.
   *
   * @param {'success'|'warning'|'danger'|'info'} type
   * @param {string} title
   * @param {string} message
   * @param {number} [duration=5000]  Auto-dismiss time in ms.
   */
  showNotification(type, title, message, duration = DEFAULT_NOTIFICATION_DURATION) {
    const area = this._els.notificationArea;
    if (!area) return;

    const el = document.createElement('div');
    el.className = `notification type-${type}`;
    el.innerHTML = `
      <span class="notification-icon">${NOTIFICATION_ICONS[type] || ''}</span>
      <div class="notification-body">
        <div class="notification-title">${this._escapeHtml(title)}</div>
        <div class="notification-message">${this._escapeHtml(message)}</div>
      </div>
    `;

    area.appendChild(el);

    // Auto-dismiss with fade-out
    const dismiss = () => {
      el.classList.add('fade-out');
      el.addEventListener('animationend', () => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    };

    const timer = setTimeout(dismiss, duration);

    // Allow manual close on click
    el.addEventListener('click', () => {
      clearTimeout(timer);
      dismiss();
    });
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Minimap
  // ---------------------------------------------------------------------------

  _initMinimapCanvas() {
    this._minimapCtx = null;
    if (this._els.minimapCanvas) {
      this._minimapCtx = this._els.minimapCanvas.getContext('2d');
    }
  }

  /**
   * Toggle minimap visibility.
   */
  toggleMinimap() {
    this._minimapVisible = !this._minimapVisible;
    if (this._els.minimap) {
      this._els.minimap.style.display = this._minimapVisible ? 'block' : 'none';
    }
  }

  /**
   * Draw a simplified resort map on the minimap canvas. Lift lines are rendered
   * as white/grey lines; ski runs are colored by difficulty.
   */
  drawMinimap(gameState) {
    const ctx = this._minimapCtx;
    if (!ctx) return;

    const canvas = this._els.minimapCanvas;
    const w = canvas.width;
    const h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Background terrain gradient (dark blue-grey)
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1a2a3a');
    grad.addColorStop(1, '#0d1520');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Draw simple mountain silhouette
    ctx.fillStyle = '#253545';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(40, 40);
    ctx.lineTo(80, 70);
    ctx.lineTo(120, 25);
    ctx.lineTo(160, 55);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();

    const resort = gameState.resort;

    // Draw ski runs
    if (resort.runs && resort.runs.length > 0) {
      resort.runs.forEach((run) => {
        if (!run.path || run.path.length < 2) return;
        ctx.strokeStyle = RUN_DIFFICULTY_COLORS[run.difficulty] || '#888';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        run.path.forEach((pt, i) => {
          const x = (pt.x / 100) * w;
          const y = (pt.y / 100) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }

    // Draw lift lines
    ctx.globalAlpha = 0.9;
    if (resort.lifts && resort.lifts.length > 0) {
      resort.lifts.forEach((lift) => {
        if (!lift.start || !lift.end) return;
        const sx = (lift.start.x / 100) * w;
        const sy = (lift.start.y / 100) * h;
        const ex = (lift.end.x / 100) * w;
        const ey = (lift.end.y / 100) * h;

        ctx.strokeStyle = lift.status === 'open' ? '#ffffff' : '#555555';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small circle at base station
        ctx.fillStyle = lift.status === 'open' ? '#4caf50' : '#f44336';
        ctx.beginPath();
        ctx.arc(sx, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw a rectangle on the minimap representing the current camera viewport.
   *
   * @param {{ x: number, y: number, width: number, height: number }} viewport
   *   Values are percentages (0-100) of the full resort area.
   */
  updateMinimapCamera(viewport) {
    const ctx = this._minimapCtx;
    if (!ctx || !viewport) return;

    const canvas = this._els.minimapCanvas;
    const w = canvas.width;
    const h = canvas.height;

    const rx = (viewport.x / 100) * w;
    const ry = (viewport.y / 100) * h;
    const rw = (viewport.width / 100) * w;
    const rh = (viewport.height / 100) * h;

    ctx.strokeStyle = 'rgba(74, 144, 217, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx, ry, rw, rh);

    // Faint fill
    ctx.fillStyle = 'rgba(74, 144, 217, 0.12)';
    ctx.fillRect(rx, ry, rw, rh);
  }
}
