/**
 * WeatherSystem - Realistic Whistler-modeled weather simulation.
 *
 * Whistler averages ~1164 cm of snowfall per season. Temperature follows
 * sinusoidal daily cycles (coldest 5 AM, warmest 2 PM). Weather states
 * transition via weighted Markov probabilities. Wind and visibility are
 * derived from the active weather state.
 */

const WEATHER_STATES = [
  'clear',
  'partly-cloudy',
  'overcast',
  'light-snow',
  'heavy-snow',
  'blizzard',
  'freezing-rain',
];

// Markov transition weights — row = current state, columns = next state weights
// Order matches WEATHER_STATES above
const TRANSITION_WEIGHTS = {
  'clear':          [40, 30, 15,  8,  2,  0,  5],
  'partly-cloudy':  [20, 30, 25, 15,  5,  1,  4],
  'overcast':       [ 5, 15, 30, 28, 12,  3,  7],
  'light-snow':     [ 3,  8, 20, 35, 22,  7,  5],
  'heavy-snow':     [ 1,  3, 10, 25, 35, 20,  6],
  'blizzard':       [ 0,  1,  5, 15, 40, 35,  4],
  'freezing-rain':  [10, 15, 30, 20, 10,  5, 10],
};

// Average transition happens every 2-6 game hours
const MIN_STATE_DURATION_MINUTES = 120;
const MAX_STATE_DURATION_MINUTES = 360;

// Whistler monthly average lows/highs (°C)
const MONTHLY_TEMPS = {
  0:  { low: -8,  high: -1 },   // Jan
  1:  { low: -6,  high:  1 },   // Feb
  2:  { low: -4,  high:  4 },   // Mar
  3:  { low: -1,  high:  8 },   // Apr
  4:  { low:  3,  high: 13 },   // May
  5:  { low:  7,  high: 17 },   // Jun
  6:  { low:  9,  high: 21 },   // Jul
  7:  { low:  9,  high: 21 },   // Aug
  8:  { low:  6,  high: 16 },   // Sep
  9:  { low:  2,  high:  9 },   // Oct
  10: { low: -3,  high:  2 },   // Nov
  11: { low: -7,  high: -1 },   // Dec
};

const WIND_PROFILES = {
  'clear':          { base: 5,  max: 20,  gustChance: 0.05 },
  'partly-cloudy':  { base: 8,  max: 30,  gustChance: 0.10 },
  'overcast':       { base: 12, max: 40,  gustChance: 0.15 },
  'light-snow':     { base: 15, max: 45,  gustChance: 0.20 },
  'heavy-snow':     { base: 25, max: 55,  gustChance: 0.30 },
  'blizzard':       { base: 45, max: 80,  gustChance: 0.50 },
  'freezing-rain':  { base: 10, max: 35,  gustChance: 0.15 },
};

const VISIBILITY = {
  'clear':          1.00,
  'partly-cloudy':  0.90,
  'overcast':       0.75,
  'light-snow':     0.60,
  'heavy-snow':     0.40,
  'blizzard':       0.20,
  'freezing-rain':  0.50,
};

const SNOW_RATE_CM_PER_HOUR = {
  'clear':          0,
  'partly-cloudy':  0,
  'overcast':       0,
  'light-snow':     [0.5, 2.0],   // [min, max]
  'heavy-snow':     [3.0, 8.0],
  'blizzard':       [5.0, 12.0],
  'freezing-rain':  0,
};

const WIND_DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class WeatherSystem {
  constructor() {
    this.state = 'overcast';
    this.temperatureC = -5;
    this.windSpeedKmh = 10;
    this.windGustKmh = 12;
    this.windDirection = 'NW';
    this.visibility = 0.75;
    this.snowRateCmPerHour = 0;
    this.snowAccumulatedCm = 0;     // running session accumulation

    this._minutesInCurrentState = 0;
    this._stateDuration = this._randomDuration();
    this._windDirectionIndex = 6;   // start NW

    // Forecast buffer (next 24 hours, hourly)
    this._forecast = [];
    this._forecastStale = true;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Advance the weather simulation.
   * @param {Date} gameDate - current in-game date/time
   * @param {number} dt - elapsed game minutes
   */
  update(gameDate, dt) {
    // Temperature
    this.temperatureC = this._calcTemperature(gameDate);

    // State transitions
    this._minutesInCurrentState += dt;
    if (this._minutesInCurrentState >= this._stateDuration) {
      this._transitionState();
      this._minutesInCurrentState = 0;
      this._stateDuration = this._randomDuration();
      this._forecastStale = true;
    }

    // Wind
    this._updateWind(dt);

    // Visibility
    this.visibility = VISIBILITY[this.state] + (Math.random() - 0.5) * 0.05;
    this.visibility = clamp(this.visibility, 0.1, 1.0);

    // Snow rate
    const rateSpec = SNOW_RATE_CM_PER_HOUR[this.state];
    if (Array.isArray(rateSpec)) {
      this.snowRateCmPerHour = rateSpec[0] + Math.random() * (rateSpec[1] - rateSpec[0]);
    } else {
      this.snowRateCmPerHour = 0;
    }
    this.snowAccumulatedCm += this.snowRateCmPerHour * (dt / 60);
  }

  getConditions() {
    return {
      state: this.state,
      temperatureC: Math.round(this.temperatureC * 10) / 10,
      windSpeedKmh: Math.round(this.windSpeedKmh),
      windGustKmh: Math.round(this.windGustKmh),
      windDirection: this.windDirection,
      windChill: this._calcWindChill(),
      visibility: Math.round(this.visibility * 100) / 100,
      snowRateCmPerHour: Math.round(this.snowRateCmPerHour * 10) / 10,
      snowQuality: this._snowQualityLabel(),
      liftWindHold: this.windGustKmh >= 60 && this.windGustKmh < 80,
      liftClosure: this.windGustKmh >= 80,
    };
  }

  /**
   * Return an hourly forecast for the next `hours` hours.
   * Simplified projection based on current state & transition probabilities.
   */
  getForecast(hours = 24) {
    if (this._forecastStale || this._forecast.length === 0) {
      this._generateForecast(hours);
      this._forecastStale = false;
    }
    return this._forecast.slice(0, hours);
  }

  // ---------------------------------------------------------------------------
  // Temperature model
  // ---------------------------------------------------------------------------

  _calcTemperature(gameDate) {
    const month = gameDate.getMonth();
    const hour = gameDate.getHours() + gameDate.getMinutes() / 60;

    const temps = MONTHLY_TEMPS[month];
    const midTemp = (temps.low + temps.high) / 2;
    const amplitude = (temps.high - temps.low) / 2;

    // Sinusoidal daily cycle — minimum at 5 AM (hour 5), maximum at 2 PM (hour 14)
    // sin peaks at pi/2, so shift: sin((hour - 5) / (14 - 5) * pi - pi/2)
    // Simplified: use cos with offset so min at hour 5
    const phase = ((hour - 14) / 24) * 2 * Math.PI;
    let temp = midTemp + amplitude * Math.cos(phase);

    // Weather modifier
    if (this.state === 'clear') temp += 1;
    if (this.state === 'blizzard') temp -= 3;
    if (this.state === 'heavy-snow') temp -= 1.5;

    // Small random jitter
    temp += (Math.random() - 0.5) * 1.0;

    return clamp(temp, -20, 5);
  }

  // ---------------------------------------------------------------------------
  // Wind model
  // ---------------------------------------------------------------------------

  _updateWind(dt) {
    const profile = WIND_PROFILES[this.state];
    const target = profile.base + Math.random() * (profile.max - profile.base) * 0.5;

    // Smooth approach
    const alpha = Math.min(1, dt / 30); // ~30 min smoothing
    this.windSpeedKmh += (target - this.windSpeedKmh) * alpha;
    this.windSpeedKmh = clamp(this.windSpeedKmh, 0, profile.max);

    // Gusts
    if (Math.random() < profile.gustChance * (dt / 60)) {
      this.windGustKmh = this.windSpeedKmh + 10 + Math.random() * 25;
    } else {
      this.windGustKmh += (this.windSpeedKmh - this.windGustKmh) * 0.1;
    }
    this.windGustKmh = clamp(this.windGustKmh, this.windSpeedKmh, 100);

    // Direction drift
    if (Math.random() < 0.02 * dt) {
      this._windDirectionIndex = (this._windDirectionIndex + (Math.random() < 0.5 ? 1 : -1) + 8) % 8;
      this.windDirection = WIND_DIRECTIONS[this._windDirectionIndex];
    }
  }

  // ---------------------------------------------------------------------------
  // State transitions (Markov)
  // ---------------------------------------------------------------------------

  _transitionState() {
    const weights = TRANSITION_WEIGHTS[this.state];
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        this.state = WEATHER_STATES[i];
        return;
      }
    }
    // fallback
    this.state = WEATHER_STATES[WEATHER_STATES.length - 1];
  }

  // ---------------------------------------------------------------------------
  // Wind chill (Environment Canada formula)
  // ---------------------------------------------------------------------------

  _calcWindChill() {
    const t = this.temperatureC;
    const v = this.windSpeedKmh;
    if (t > 10 || v < 4.8) return Math.round(t * 10) / 10;
    const wc = 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16);
    return Math.round(wc * 10) / 10;
  }

  // ---------------------------------------------------------------------------
  // Snow quality
  // ---------------------------------------------------------------------------

  _snowQualityLabel() {
    const t = this.temperatureC;
    if (t < -12) return 'champagne-powder';
    if (t < -6) return 'powder';
    if (t < -2) return 'packed-powder';
    if (t < 1) return 'wet-snow';
    return 'icy';
  }

  // ---------------------------------------------------------------------------
  // Forecast generation
  // ---------------------------------------------------------------------------

  _generateForecast(hours) {
    this._forecast = [];
    let simState = this.state;
    let remaining = this._stateDuration - this._minutesInCurrentState;

    for (let h = 0; h < hours; h++) {
      // Check if state changes within this hour
      remaining -= 60;
      if (remaining <= 0) {
        const weights = TRANSITION_WEIGHTS[simState];
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0) { simState = WEATHER_STATES[i]; break; }
        }
        remaining = this._randomDuration();
      }

      this._forecast.push({
        hourOffset: h + 1,
        state: simState,
        visibility: VISIBILITY[simState],
        windRange: WIND_PROFILES[simState],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _randomDuration() {
    return MIN_STATE_DURATION_MINUTES + Math.random() * (MAX_STATE_DURATION_MINUTES - MIN_STATE_DURATION_MINUTES);
  }
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
