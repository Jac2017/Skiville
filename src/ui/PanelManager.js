import { BuildPanelRenderer } from './BuildPanelRenderer.js';
import { OperationsPanelRenderer } from './OperationsPanelRenderer.js';
import { UpgradePanelRenderer } from './UpgradePanelRenderer.js';
import { EventPanelRenderer } from './EventPanelRenderer.js';

/**
 * PanelManager - Manages the side panel UI for all toolbar tools.
 * Generates context-specific HTML content for lifts, runs, facilities,
 * finances, staff, and game settings.
 */
export class PanelManager {
  constructor() {
    this._panel = null;
    this._title = null;
    this._content = null;
    this._closeBtn = null;
    this._currentTool = null;
    this._gameState = null;
  }

  init() {
    this._panel = document.getElementById('side-panel');
    this._title = document.getElementById('panel-title');
    this._content = document.getElementById('panel-content');
    this._closeBtn = document.getElementById('panel-close');
    if (this._closeBtn) {
      this._closeBtn.addEventListener('click', () => this.hidePanel());
    }
  }

  showPanel(tool, gameState) {
    this._currentTool = tool;
    this._gameState = gameState;
    if (this._title) this._title.textContent = this._toolTitle(tool);
    if (this._content) this._content.innerHTML = this._renderTool(tool, gameState);
    if (this._panel) this._panel.classList.remove('panel-hidden');
    this._bindPanelActions(tool, gameState);
  }

  hidePanel() {
    if (this._panel) this._panel.classList.add('panel-hidden');
    this._currentTool = null;
  }

  update(gameState) {
    if (!this._currentTool) return;
    this._gameState = gameState;
    if (this._content) {
      this._content.innerHTML = this._renderTool(this._currentTool, gameState);
      this._bindPanelActions(this._currentTool, gameState);
    }
  }

  _toolTitle(tool) {
    const titles = {
      overview: 'Resort Overview', lifts: 'Lift Management', runs: 'Ski Runs',
      snowmaking: 'Snowmaking', grooming: 'Grooming', hotels: 'Hotels & Lodging',
      restaurants: 'Dining', shops: 'Retail & Rentals', condos: 'Condos',
      parking: 'Parking', staff: 'Staff', finance: 'Finances',
      marketing: 'Marketing & Passes', settings: 'Settings',
      build: 'Build Mode', upgrades: 'Upgrades', events: 'Events & Challenges',
      activities: 'Activities', avalanche: 'Avalanche Control',
    };
    return titles[tool] || 'Details';
  }

  _renderTool(tool, gs) {
    const r = {
      overview: () => this._renderOverview(gs),
      lifts: () => this._renderLifts(gs),
      runs: () => this._renderRuns(gs),
      snowmaking: () => this._renderSnowmaking(gs),
      grooming: () => this._renderGrooming(gs),
      hotels: () => this._renderHotels(gs),
      restaurants: () => this._renderRestaurants(gs),
      shops: () => this._renderShops(gs),
      condos: () => this._renderCondos(gs),
      parking: () => this._renderParking(gs),
      staff: () => this._renderStaff(gs),
      finance: () => this._renderFinance(gs),
      marketing: () => this._renderMarketing(gs),
      settings: () => this._renderSettings(gs),
      build: () => BuildPanelRenderer.renderBuildPanel(gs, this._buildSystem) + BuildPanelRenderer.renderConstructionQueue(this._buildSystem),
      upgrades: () => UpgradePanelRenderer.renderUpgradePanel(gs, this._upgrades),
      events: () => EventPanelRenderer.renderEventsPanel(gs, this._events),
      activities: () => this._renderActivities(gs),
      avalanche: () => {
        const ops = this._operations;
        return ops && OperationsPanelRenderer.renderAvalanche ? OperationsPanelRenderer.renderAvalanche(gs, ops) : '<p>Not available.</p>';
      },
    };
    return (r[tool] || (() => '<p>Select a category.</p>'))();
  }

  // ── Overview ──
  _renderOverview(gs) {
    const r = gs.resort;
    const openLifts = (r.lifts || []).filter(l => l.status === 'open').length;
    const totalLifts = (r.lifts || []).length;
    const openRuns = (r.runs || []).filter(x => x.status === 'open').length;
    const totalRuns = (r.runs || []).length;
    return `
      <div class="panel-section">
        <div class="panel-section-title">Resort Status</div>
        <div class="stat-row"><span class="stat-label">Name</span><span class="stat-value">${this._esc(r.name || 'Whistler Blackcomb')}</span></div>
        <div class="stat-row"><span class="stat-label">Season</span><span class="stat-value">${gs.season || '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Rating</span><span class="stat-value">${gs.rating?.toFixed(1) || '—'} / 5.0</span></div>
        <div class="stat-row"><span class="stat-label">Guests Today</span><span class="stat-value">${(gs.guests?.current || 0).toLocaleString()}</span></div>
        <div class="stat-row"><span class="stat-label">Satisfaction</span><span class="stat-value">${Math.round(gs.guests?.satisfaction || 0)}%</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Mountain</div>
        <div class="stat-row"><span class="stat-label">Lifts Open</span><span class="stat-value">${openLifts} / ${totalLifts}</span></div>
        <div class="stat-row"><span class="stat-label">Runs Open</span><span class="stat-value">${openRuns} / ${totalRuns}</span></div>
        <div class="stat-row"><span class="stat-label">Snow Base</span><span class="stat-value">${Math.round(r.snowDepthCm || 0)}cm</span></div>
        <div class="stat-row"><span class="stat-label">Grooming</span><span class="stat-value">${Math.round((r.groomingQuality || 0) * 100)}%</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Weather</div>
        <div class="stat-row"><span class="stat-label">Conditions</span><span class="stat-value">${gs.weather?.state || '—'}</span></div>
        <div class="stat-row"><span class="stat-label">Temperature</span><span class="stat-value">${Math.round(gs.weather?.temperatureC || 0)}°C</span></div>
        <div class="stat-row"><span class="stat-label">Wind</span><span class="stat-value">${Math.round(gs.weather?.windSpeedKmh || 0)} km/h</span></div>
        <div class="stat-row"><span class="stat-label">Visibility</span><span class="stat-value">${Math.round((gs.weather?.visibility || 1) * 100)}%</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Finances</div>
        <div class="stat-row"><span class="stat-label">Balance</span><span class="stat-value" style="color:var(--hud-gold)">${this._money(gs.money)}</span></div>
        <div class="stat-row"><span class="stat-label">Today Revenue</span><span class="stat-value stat-positive">${this._money(gs.financials?.daily?.revenue || 0)}</span></div>
        <div class="stat-row"><span class="stat-label">Today Expenses</span><span class="stat-value stat-negative">${this._money(gs.financials?.daily?.expenses || 0)}</span></div>
      </div>`;
  }

  // ── Lifts ──
  _renderLifts(gs) {
    const lifts = gs.resort?.lifts || [];
    if (!lifts.length) return '<p>No lifts configured.</p>';
    return lifts.map(l => {
      const statusClass = l.status === 'open' ? 'status-open' : l.status === 'hold' ? 'status-hold' : 'status-closed';
      const typeClass = l.type === 'gondola' || l.type === 'peak2peak' ? 'type-gondola' : l.type?.includes('t-bar') ? 'type-tbar' : l.type === 'magic-carpet' ? 'type-magic-carpet' : 'type-chairlift';
      return `<div class="lift-item" data-lift-id="${l.id}">
        <div class="lift-item-header">
          <span class="lift-name"><span class="status-dot ${statusClass}"></span>${this._esc(l.name)}</span>
          <span class="lift-type ${typeClass}">${this._esc(l.type)}</span>
        </div>
        <div class="lift-stats">
          <span>Capacity: ${(l.capacity || 0).toLocaleString()}/hr</span>
          <span>Rise: ${l.verticalRise || 0}m</span>
          <span>Ride: ${l.rideTime || 0} min</span>
          <span>Mountain: ${l.mountain || '—'}</span>
        </div>
        <div class="panel-actions">
          <button class="action-btn btn-lift-toggle" data-lid="${l.id}" data-action="${l.status === 'open' ? 'close' : 'open'}">${l.status === 'open' ? 'Close Lift' : 'Open Lift'}</button>
        </div>
      </div>`;
    }).join('');
  }

  // ── Runs ──
  _renderRuns(gs) {
    const runs = gs.resort?.runs || [];
    if (!runs.length) return '<p>No runs configured.</p>';
    const groups = { green: [], blue: [], black: [], 'double-black': [] };
    runs.forEach(r => { if (groups[r.difficulty]) groups[r.difficulty].push(r); });
    const labels = { green: 'Beginner (Green)', blue: 'Intermediate (Blue)', black: 'Advanced (Black)', 'double-black': 'Expert (Double Black)' };
    let html = '';
    for (const [diff, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const open = list.filter(r => r.status === 'open').length;
      html += `<div class="panel-section"><div class="panel-section-title">${labels[diff]} — ${open}/${list.length} open</div>`;
      html += list.map(r => `<div class="facility-item">
        <div class="facility-header">
          <span class="facility-name"><span class="status-dot ${r.status === 'open' ? 'status-open' : 'status-closed'}"></span>${this._esc(r.name)}</span>
          <span class="run-difficulty-badge badge-${diff}">${diff === 'double-black' ? '◆◆' : diff === 'black' ? '◆' : diff === 'blue' ? '■' : '●'}</span>
        </div>
        <div class="lift-stats">
          <span>${r.length || 0}m long</span>
          <span>Drop: ${r.verticalDrop || 0}m</span>
          <span>${r.groomed ? 'Groomed' : 'Ungroomed'}</span>
        </div>
      </div>`).join('');
      html += '</div>';
    }
    return html;
  }

  // ── Snowmaking ──
  _renderSnowmaking(gs) {
    const r = gs.resort;
    const temp = gs.weather?.temperatureC || 0;
    const canMake = temp < -2;
    const depth = Math.round(r?.snowDepthCm || 0);
    const maxDepth = 400;
    const pct = Math.min(100, (depth / maxDepth) * 100);
    return `
      <div class="panel-section">
        <div class="panel-section-title">Snow Depth</div>
        <div class="stat-row"><span class="stat-label">Current Base</span><span class="stat-value">${depth}cm</span></div>
        <div class="progress-bar"><div class="progress-fill progress-blue" style="width:${pct}%"></div></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Snowmaking System</div>
        <div class="stat-row"><span class="stat-label">Status</span><span class="stat-value">${r?.snowmaking ? '<span class="stat-positive">ACTIVE</span>' : '<span class="stat-negative">OFF</span>'}</span></div>
        <div class="stat-row"><span class="stat-label">Temperature</span><span class="stat-value ${canMake ? 'stat-positive' : 'stat-negative'}">${Math.round(temp)}°C ${canMake ? '(OK)' : '(Too warm)'}</span></div>
        <div class="stat-row"><span class="stat-label">Cost</span><span class="stat-value">$12,000/hr</span></div>
        <div class="panel-actions">
          <button class="action-btn btn-primary" id="btn-snowmaking">${r?.snowmaking ? 'Turn Off' : 'Turn On'}</button>
        </div>
      </div>`;
  }

  // ── Grooming ──
  _renderGrooming(gs) {
    const quality = Math.round((gs.resort?.groomingQuality || 0) * 100);
    const runs = (gs.resort?.runs || []).filter(r => r.status === 'open' && !r.groomed);
    return `
      <div class="panel-section">
        <div class="panel-section-title">Grooming Quality</div>
        <div class="stat-row"><span class="stat-label">Overall</span><span class="stat-value">${quality}%</span></div>
        <div class="progress-bar"><div class="progress-fill ${quality > 70 ? 'progress-green' : quality > 40 ? 'progress-orange' : 'progress-red'}" style="width:${quality}%"></div></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Needs Grooming (${runs.length} runs)</div>
        ${runs.slice(0, 10).map(r => `<div class="stat-row"><span class="stat-label">${this._esc(r.name)}</span><span class="stat-value stat-warning">Ungroomed</span></div>`).join('')}
        ${runs.length > 10 ? `<p style="font-size:11px;opacity:0.5">...and ${runs.length - 10} more</p>` : ''}
        <div class="panel-actions">
          <button class="action-btn btn-primary" id="btn-groom-all">Groom All — ${this._money(runs.length * 2500)}</button>
        </div>
      </div>`;
  }

  // ── Hotels ──
  _renderHotels(gs) {
    const buildings = gs.resort?.buildings || [];
    const hotels = buildings.filter(b => b.type === 'luxury' || b.type === 'mid-range' || b.type === 'budget' || b.rooms);
    if (!hotels.length) return '<p>No hotels.</p>';
    return `<div class="panel-section"><div class="panel-section-title">Hotels & Lodging (${hotels.length})</div>` +
      hotels.map(h => {
        const occ = Math.round((h.occupancyRate || 0) * 100);
        return `<div class="facility-item">
          <div class="facility-header">
            <span class="facility-name">${this._esc(h.name)}</span>
            <span class="lift-type type-chairlift">${h.type || 'hotel'}</span>
          </div>
          <div class="lift-stats">
            <span>${h.rooms || 0} rooms</span>
            <span>${this._money(h.pricePerNight || 0)}/night</span>
          </div>
          <div style="margin-top:4px"><span class="stat-label">Occupancy</span></div>
          <div class="progress-bar"><div class="progress-fill progress-blue" style="width:${occ}%"></div></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ── Restaurants ──
  _renderRestaurants(gs) {
    const buildings = gs.resort?.buildings || [];
    const rests = buildings.filter(b => b.avgSpend && b.peakHours && !b.type?.includes('pub') && !b.type?.includes('nightclub') && !b.type?.includes('apres'));
    if (!rests.length) return '<p>No restaurants.</p>';
    return `<div class="panel-section"><div class="panel-section-title">Restaurants (${rests.length})</div>` +
      rests.map(r => `<div class="facility-item">
        <div class="facility-header">
          <span class="facility-name">${this._esc(r.name)}</span>
          <span class="lift-type type-gondola">${r.type || 'dining'}</span>
        </div>
        <div class="lift-stats">
          <span>Seats: ${r.capacity || 0}</span>
          <span>Avg: ${this._money(r.avgSpend || 0)}</span>
          <span>Revenue: ${this._money(r.revenue || 0)}/day</span>
        </div>
      </div>`).join('') + '</div>';
  }

  // ── Shops ──
  _renderShops(gs) {
    const buildings = gs.resort?.buildings || [];
    const shops = buildings.filter(b => b.type === 'rental' || b.type === 'retail' || b.type === 'gear');
    if (!shops.length) return '<p>No shops.</p>';
    return `<div class="panel-section"><div class="panel-section-title">Shops & Rentals (${shops.length})</div>` +
      shops.map(s => `<div class="facility-item">
        <div class="facility-header">
          <span class="facility-name">${this._esc(s.name)}</span>
          <span class="lift-type type-tbar">${s.type}</span>
        </div>
        <div class="lift-stats">
          <span>Revenue: ${this._money(s.revenue || 0)}/day</span>
          ${s.rentalsPerDay ? `<span>Rentals: ${s.rentalsPerDay}/day</span>` : ''}
        </div>
      </div>`).join('') + '</div>';
  }

  // ── Condos ──
  _renderCondos(gs) {
    const buildings = gs.resort?.buildings || [];
    const condos = buildings.filter(b => b.units && b.avgPrice);
    if (!condos.length) return '<p>No condos.</p>';
    return `<div class="panel-section"><div class="panel-section-title">Condos & Real Estate (${condos.length})</div>` +
      condos.map(c => {
        const occ = Math.round((c.occupancyRate || 0) * 100);
        return `<div class="facility-item">
          <div class="facility-header">
            <span class="facility-name">${this._esc(c.name)}</span>
          </div>
          <div class="lift-stats">
            <span>${c.units} units</span>
            <span>Avg: ${this._money(c.avgPrice || 0)}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill progress-green" style="width:${occ}%"></div></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ── Parking ──
  _renderParking(gs) {
    const buildings = gs.resort?.buildings || [];
    const lots = buildings.filter(b => b.spots);
    if (!lots.length) return '<p>No parking facilities.</p>';
    return `<div class="panel-section"><div class="panel-section-title">Parking (${lots.length} facilities)</div>` +
      lots.map(p => {
        const occ = Math.round((p.currentOccupancy || 0) / (p.spots || 1) * 100);
        return `<div class="facility-item">
          <div class="facility-header">
            <span class="facility-name">${this._esc(p.name)}</span>
            <span class="stat-value">${this._money(p.pricePerDay || 0)}/day</span>
          </div>
          <div class="lift-stats"><span>${p.spots} spots</span><span>${occ}% full</span></div>
          <div class="progress-bar"><div class="progress-fill ${occ > 85 ? 'progress-red' : occ > 60 ? 'progress-orange' : 'progress-green'}" style="width:${occ}%"></div></div>
        </div>`;
      }).join('') + '</div>';
  }

  // ── Staff ──
  _renderStaff(gs) {
    const staff = {
      'Lift Operations': { count: 400, costPerDay: 72000 },
      'Ski Patrol': { count: 120, costPerDay: 28800 },
      'Instructors': { count: 250, costPerDay: 52500 },
      'Grooming Crew': { count: 80, costPerDay: 16000 },
      'Food & Beverage': { count: 350, costPerDay: 56000 },
      'Retail': { count: 150, costPerDay: 22500 },
      'Admin': { count: 100, costPerDay: 22000 },
      'Maintenance': { count: 90, costPerDay: 18000 },
    };
    const totalStaff = Object.values(staff).reduce((s, v) => s + v.count, 0);
    const totalCost = Object.values(staff).reduce((s, v) => s + v.costPerDay, 0);
    return `
      <div class="panel-section">
        <div class="panel-section-title">Staff Overview — ${totalStaff} employees</div>
        <div class="stat-row"><span class="stat-label">Daily Payroll</span><span class="stat-value stat-negative">${this._money(totalCost)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Departments</div>
        ${Object.entries(staff).map(([dept, data]) => `
          <div class="facility-item">
            <div class="facility-header">
              <span class="facility-name">${dept}</span>
              <span class="stat-value">${data.count}</span>
            </div>
            <div class="lift-stats"><span>Cost: ${this._money(data.costPerDay)}/day</span></div>
          </div>`).join('')}
      </div>`;
  }

  // ── Finance ──
  _renderFinance(gs) {
    const f = gs.financials || {};
    const daily = f.daily || {};
    const monthly = f.monthly || {};
    const net = (daily.revenue || 0) - (daily.expenses || 0);
    const mNet = (monthly.revenue || 0) - (monthly.expenses || 0);
    const maxBar = Math.max(daily.revenue || 1, daily.expenses || 1);
    return `
      <div class="panel-section">
        <div class="panel-section-title">Today</div>
        <div class="chart-container">
          <div class="chart-bar">
            <span class="chart-bar-label">Revenue</span>
            <div class="chart-bar-track"><div class="chart-bar-fill progress-green" style="width:${((daily.revenue || 0) / maxBar * 100)}%"></div></div>
            <span class="chart-bar-value stat-positive">${this._money(daily.revenue || 0)}</span>
          </div>
          <div class="chart-bar">
            <span class="chart-bar-label">Expenses</span>
            <div class="chart-bar-track"><div class="chart-bar-fill progress-red" style="width:${((daily.expenses || 0) / maxBar * 100)}%"></div></div>
            <span class="chart-bar-value stat-negative">${this._money(daily.expenses || 0)}</span>
          </div>
        </div>
        <div class="stat-row"><span class="stat-label">Net Today</span><span class="stat-value ${net >= 0 ? 'stat-positive' : 'stat-negative'}">${this._money(net)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">This Month</div>
        <div class="stat-row"><span class="stat-label">Revenue</span><span class="stat-value stat-positive">${this._money(monthly.revenue || 0)}</span></div>
        <div class="stat-row"><span class="stat-label">Expenses</span><span class="stat-value stat-negative">${this._money(monthly.expenses || 0)}</span></div>
        <div class="stat-row"><span class="stat-label">Net</span><span class="stat-value ${mNet >= 0 ? 'stat-positive' : 'stat-negative'}">${this._money(mNet)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Balance</div>
        <div class="stat-row"><span class="stat-label">Cash</span><span class="stat-value" style="color:var(--hud-gold);font-size:16px">${this._money(gs.money)}</span></div>
      </div>`;
  }

  // ── Marketing ──
  _renderMarketing(gs) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Epic Pass</div>
        <div class="stat-row"><span class="stat-label">Season Pass Price</span><span class="stat-value">${this._money(979)}</span></div>
        <div class="stat-row"><span class="stat-label">Day Pass Price</span><span class="stat-value">${this._money(239)}</span></div>
        <div class="stat-row"><span class="stat-label">Half-Day Pass</span><span class="stat-value">${this._money(189)}</span></div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Price Adjustments</div>
        <div class="upgrade-card">
          <div class="upgrade-card-header"><span class="upgrade-name">Increase Ticket Prices 10%</span><span class="upgrade-cost">+Revenue</span></div>
          <div class="upgrade-desc">Higher prices may reduce guest volume but increase per-guest revenue.</div>
          <div class="upgrade-effects">+10% revenue &nbsp; -5% guests</div>
          <button class="action-btn" id="btn-price-up">Apply</button>
        </div>
        <div class="upgrade-card">
          <div class="upgrade-card-header"><span class="upgrade-name">Decrease Ticket Prices 10%</span><span class="upgrade-cost">+Guests</span></div>
          <div class="upgrade-desc">Lower prices attract more guests but reduce per-guest revenue.</div>
          <div class="upgrade-effects">-10% revenue &nbsp; +8% guests</div>
          <button class="action-btn" id="btn-price-down">Apply</button>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Marketing Campaigns</div>
        <div class="upgrade-card">
          <div class="upgrade-card-header"><span class="upgrade-name">Social Media Blitz</span><span class="upgrade-cost">${this._money(50000)}</span></div>
          <div class="upgrade-desc">2-week social media campaign targeting Pacific Northwest skiers.</div>
          <div class="upgrade-effects">+15% weekend guests for 14 days</div>
          <button class="action-btn btn-primary" id="btn-campaign-social">Launch</button>
        </div>
        <div class="upgrade-card">
          <div class="upgrade-card-header"><span class="upgrade-name">Early Bird Season Pass</span><span class="upgrade-cost">${this._money(25000)}</span></div>
          <div class="upgrade-desc">Offer discounted early-bird passes to lock in revenue.</div>
          <div class="upgrade-effects">+${this._money(500000)} upfront revenue</div>
          <button class="action-btn btn-primary" id="btn-campaign-earlybird">Launch</button>
        </div>
      </div>`;
  }

  // ── Settings ──
  _renderSettings(gs) {
    return `
      <div class="panel-section">
        <div class="panel-section-title">Game</div>
        <div class="panel-actions">
          <button class="action-btn btn-primary" id="btn-save">Save Game</button>
          <button class="action-btn" id="btn-load">Load Game</button>
        </div>
        <div class="panel-actions" style="margin-top:8px">
          <button class="action-btn btn-danger" id="btn-new-game">New Game</button>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">Display</div>
        <div class="stat-row"><span class="stat-label">Minimap</span>
          <button class="action-btn" id="btn-toggle-minimap" style="padding:4px 12px;flex:0">Toggle</button>
        </div>
      </div>
      <div class="panel-section">
        <div class="panel-section-title">About</div>
        <div class="stat-row"><span class="stat-label">Version</span><span class="stat-value">1.0.0</span></div>
        <div class="stat-row"><span class="stat-label">Engine</span><span class="stat-value">CesiumJS + Custom</span></div>
        <p style="font-size:11px;color:rgba(180,200,230,0.5);margin-top:10px;line-height:1.5">
          SkiVille — Whistler Blackcomb Tycoon<br>
          Inspired by Winter Resort Simulator 2 & Vail Resorts
        </p>
      </div>`;
  }

  // ── Panel action binding ──
  _bindPanelActions(tool, gs) {
    if (tool === 'snowmaking') {
      const btn = document.getElementById('btn-snowmaking');
      if (btn) btn.addEventListener('click', () => {
        gs.resort.snowmaking = !gs.resort.snowmaking;
        this.showPanel('snowmaking', gs);
      });
    }
    if (tool === 'grooming') {
      const btn = document.getElementById('btn-groom-all');
      if (btn) btn.addEventListener('click', () => {
        (gs.resort.runs || []).forEach(r => { r.groomed = true; });
        gs.resort.groomingQuality = 1.0;
        this.showPanel('grooming', gs);
      });
    }
    if (tool === 'lifts') {
      document.querySelectorAll('.btn-lift-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const lid = e.target.dataset.lid;
          const action = e.target.dataset.action;
          const lift = (gs.resort.lifts || []).find(l => l.id === lid);
          if (lift) {
            lift.status = action;
            this.showPanel('lifts', gs);
          }
        });
      });
    }
    if (tool === 'settings') {
      const saveBtn = document.getElementById('btn-save');
      if (saveBtn) saveBtn.addEventListener('click', () => {
        try {
          const data = { ...gs, date: gs.date?.toISOString?.() || gs.date };
          localStorage.setItem('skiville_save', JSON.stringify(data));
          alert('Game saved!');
        } catch (e) { alert('Save failed: ' + e.message); }
      });
      const newBtn = document.getElementById('btn-new-game');
      if (newBtn) newBtn.addEventListener('click', () => {
        if (confirm('Start a new game? All progress will be lost.')) {
          localStorage.removeItem('skiville_save');
          location.reload();
        }
      });
    }
  }

  // ── Activities ──
  _renderActivities(gs) {
    const sys = this._activities;
    if (!sys) return '<p>Activities not available.</p>';
    const built = sys.getBuiltActivities?.() || [];
    const available = sys.getAvailableActivities?.(gs) || [];
    let html = '<div class="panel-section"><div class="panel-section-title">Active Activities (' + built.length + ')</div>';
    if (built.length === 0) html += '<p style="font-size:12px;opacity:0.5">No activities built yet</p>';
    built.forEach(a => {
      html += `<div class="facility-item"><div class="facility-header"><span class="facility-name">${this._esc(a.name)}</span><span class="stat-value ${a.active ? 'stat-positive' : 'stat-negative'}">${a.active ? 'Open' : 'Closed'}</span></div></div>`;
    });
    html += '</div><div class="panel-section"><div class="panel-section-title">Available to Build (' + available.length + ')</div>';
    available.forEach(a => {
      html += `<div class="upgrade-card"><div class="upgrade-card-header"><span class="upgrade-name">${this._esc(a.name)}</span><span class="upgrade-cost">${this._money(a.buildCost)}</span></div><div class="upgrade-desc">${this._esc(a.description || '')}</div><div class="upgrade-effects">Revenue: ${this._money(a.dailyRevenue)}/day | Cap: ${a.guestCapacity}</div></div>`;
    });
    html += '</div>';
    return html;
  }

  // ── Helpers ──
  _money(n) {
    const abs = Math.abs(Math.round(n));
    if (abs >= 1_000_000) return `${n < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
    return `${n < 0 ? '-' : ''}$${abs.toLocaleString('en-US')}`;
  }

  _esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }
}
