/**
 * TerrainEngine.js
 * CesiumJS-based 3D terrain renderer for Whistler Blackcomb ski resort.
 * Handles terrain visualization, camera control, atmosphere, and post-processing.
 */
import * as Cesium from 'cesium';

const WHISTLER_BLACKCOMB = {
  lat: 50.1163,
  lng: -122.9574,
  overviewAltitude: 8000,
};

// Camera presets are built lazily after Cesium is loaded
function buildCameraPresets() {
  return {
    overview: {
      destination: Cesium.Cartesian3.fromDegrees(-122.9574, 50.1163, 8000),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-45),
        roll: 0,
      },
    },
    'whistler-peak': {
      destination: Cesium.Cartesian3.fromDegrees(-122.9486, 50.0595, 3500),
      orientation: {
        heading: Cesium.Math.toRadians(340),
        pitch: Cesium.Math.toRadians(-20),
        roll: 0,
      },
    },
    'blackcomb-peak': {
      destination: Cesium.Cartesian3.fromDegrees(-122.8935, 50.0946, 3500),
      orientation: {
        heading: Cesium.Math.toRadians(200),
        pitch: Cesium.Math.toRadians(-20),
        roll: 0,
      },
    },
    village: {
      destination: Cesium.Cartesian3.fromDegrees(-122.9531, 50.1145, 1200),
      orientation: {
        heading: Cesium.Math.toRadians(10),
        pitch: Cesium.Math.toRadians(-30),
        roll: 0,
      },
    },
    peak2peak: {
      destination: Cesium.Cartesian3.fromDegrees(-122.9200, 50.0770, 3000),
      orientation: {
        heading: Cesium.Math.toRadians(270),
        pitch: Cesium.Math.toRadians(-15),
        roll: 0,
      },
    },
  };
}

const WINTER_SUNRISE_HOUR = 8.0;
const WINTER_SUNSET_HOUR = 16.5;

export class TerrainEngine {
  constructor() {
    this.viewer = null;
    this.scene = null;
    this.camera = null;
    this.clock = null;
    this.postProcessStages = null;
    this._resizeHandler = null;
    this._dayNightCycleEnabled = true;
    this._gameTimeHours = 12;
    this._cameraPresets = null;
  }

  /**
   * Initialize the Cesium viewer, terrain, atmosphere, and post-processing.
   * @returns {Promise<Cesium.Viewer>} The initialized viewer instance.
   */
  async init() {
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlNzYzYzYzNS0wYjQyLTRlMGYtYWFmYi03YmFhMTQzNTFiM2YiLCJpZCI6NDA5NTYwLCJpYXQiOjE3NzQ5Nzc1NTd9.EDmasSi2FWla5znlEiDkuqhZXJ0X4l1ILo8Hlj2GoYY';

    // Build camera presets now that Cesium is available
    this._cameraPresets = buildCameraPresets();

    // Create terrain provider - try multiple approaches for API compatibility
    let terrainProvider;
    try {
      if (Cesium.CesiumTerrainProvider && Cesium.CesiumTerrainProvider.fromIonAssetId) {
        terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
          requestVertexNormals: true,
          requestWaterMask: true,
        });
      } else if (Cesium.createWorldTerrainAsync) {
        terrainProvider = await Cesium.createWorldTerrainAsync({
          requestVertexNormals: true,
          requestWaterMask: true,
        });
      } else if (Cesium.createWorldTerrain) {
        terrainProvider = Cesium.createWorldTerrain({
          requestVertexNormals: true,
          requestWaterMask: true,
        });
      }
    } catch (terrainErr) {
      console.warn('Failed to load world terrain, using ellipsoid:', terrainErr);
      terrainProvider = undefined;
    }

    const viewerOptions = {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: false,
      infoBox: false,
      shouldAnimate: true,
    };

    if (terrainProvider) {
      viewerOptions.terrainProvider = terrainProvider;
    }

    this.viewer = new Cesium.Viewer('cesium-container', viewerOptions);

    this.scene = this.viewer.scene;
    this.camera = this.viewer.camera;
    this.clock = this.viewer.clock;

    this._configureTerrain();
    this._configureAtmosphere();
    this._configureLighting();
    this._configureCameraControls();
    this._configurePostProcessing();
    this._setWinterTime();
    this._bindResizeHandler();

    // Set initial camera to overview of Whistler Blackcomb
    this.setCameraPreset('overview', false);

    return this.viewer;
  }

  _configureTerrain() {
    this.scene.globe.enableLighting = true;
    this.scene.globe.depthTestAgainstTerrain = true;
    if (this.scene.globe.showGroundAtmosphere !== undefined) {
      this.scene.globe.showGroundAtmosphere = true;
    }
  }

  _configureAtmosphere() {
    try {
      this.scene.skyAtmosphere.hueShift = -0.02;
      this.scene.skyAtmosphere.saturationShift = -0.4;
      this.scene.skyAtmosphere.brightnessShift = -0.1;

      this.scene.fog.enabled = true;
      this.scene.fog.density = 0.0004;
      this.scene.fog.minimumBrightness = 0.25;

      this.scene.backgroundColor = new Cesium.Color(0.75, 0.78, 0.82, 1.0);
    } catch (e) {
      console.warn('Atmosphere configuration failed:', e);
    }
  }

  _configureLighting() {
    try {
      this.scene.globe.enableLighting = true;
      if (Cesium.SunLight) {
        this.scene.light = new Cesium.SunLight();
      }
      if (this.viewer.shadowMap) {
        this.viewer.shadowMap.enabled = false; // disable for performance
      }
    } catch (e) {
      console.warn('Lighting configuration failed:', e);
    }
  }

  _configureCameraControls() {
    const controller = this.scene.screenSpaceCameraController;
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;
    controller.inertiaSpin = 0.7;
    controller.inertiaTranslate = 0.7;
    controller.inertiaZoom = 0.6;
    controller.minimumZoomDistance = 50;
    controller.maximumZoomDistance = 30000;
  }

  _configurePostProcessing() {
    try {
      if (this.scene.postProcessStages && this.scene.postProcessStages.ambientOcclusion) {
        const ao = this.scene.postProcessStages.ambientOcclusion;
        ao.enabled = true;
        ao.uniforms.intensity = 4.0;
        ao.uniforms.bias = 0.05;
        ao.uniforms.lengthCap = 0.03;
        ao.uniforms.stepSize = 1.5;
      }
    } catch (e) {
      console.warn('Post-processing setup failed:', e);
    }
  }

  _setWinterTime() {
    const winterDate = Cesium.JulianDate.fromDate(new Date(2026, 0, 15, 20, 0, 0));
    this.clock.currentTime = winterDate;
    this.clock.shouldAnimate = false;
    this.clock.multiplier = 1;
  }

  _bindResizeHandler() {
    this._resizeHandler = () => {
      if (this.viewer && !this.viewer.isDestroyed()) {
        this.viewer.resize();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  update(gameState) {
    if (!this.viewer || this.viewer.isDestroyed()) return;

    if (gameState && gameState.time !== undefined) {
      this._gameTimeHours = gameState.time;
      this._updateDayNightCycle(gameState.time);
    }

    if (gameState && gameState.weather) {
      this._updateWeatherAtmosphere(gameState.weather);
    }
  }

  _updateDayNightCycle(hours) {
    if (!this._dayNightCycleEnabled) return;

    try {
      const winterDate = new Date(2026, 0, 15);
      winterDate.setUTCHours(hours + 8);
      winterDate.setUTCMinutes((hours % 1) * 60);
      this.clock.currentTime = Cesium.JulianDate.fromDate(winterDate);

      const dayProgress = (hours - WINTER_SUNRISE_HOUR) / (WINTER_SUNSET_HOUR - WINTER_SUNRISE_HOUR);

      if (hours < WINTER_SUNRISE_HOUR || hours > WINTER_SUNSET_HOUR) {
        this.scene.skyAtmosphere.brightnessShift = -0.4;
        this.scene.fog.minimumBrightness = 0.05;
      } else if (dayProgress < 0.1 || dayProgress > 0.9) {
        this.scene.skyAtmosphere.brightnessShift = -0.2;
        this.scene.skyAtmosphere.hueShift = 0.02;
        this.scene.fog.minimumBrightness = 0.15;
      } else {
        this.scene.skyAtmosphere.brightnessShift = -0.1;
        this.scene.skyAtmosphere.hueShift = -0.02;
        this.scene.fog.minimumBrightness = 0.25;
      }
    } catch (e) {
      // silently ignore day/night errors
    }
  }

  _updateWeatherAtmosphere(weather) {
    try {
      const { condition, visibility } = weather;

      switch (condition) {
        case 'clear':
          this.scene.fog.density = 0.0002;
          this.scene.skyAtmosphere.saturationShift = -0.2;
          break;
        case 'overcast':
          this.scene.fog.density = 0.0004;
          this.scene.skyAtmosphere.saturationShift = -0.4;
          break;
        case 'snow':
        case 'light-snow':
        case 'heavy-snow':
          this.scene.fog.density = 0.0008;
          this.scene.skyAtmosphere.saturationShift = -0.5;
          break;
        case 'blizzard':
          this.scene.fog.density = 0.002;
          this.scene.skyAtmosphere.saturationShift = -0.6;
          break;
      }

      if (typeof visibility === 'number') {
        this.scene.fog.density = 0.0002 + (1 - visibility) * 0.003;
      }
    } catch (e) {
      // silently ignore weather atmosphere errors
    }
  }

  flyTo(location, duration = 2.0) {
    return new Promise((resolve, reject) => {
      if (!this.viewer || this.viewer.isDestroyed()) {
        reject(new Error('Viewer not initialized'));
        return;
      }

      const { lat, lng, altitude = 3000, heading = 0, pitch = -30 } = location;

      this.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, altitude),
        orientation: {
          heading: Cesium.Math.toRadians(heading),
          pitch: Cesium.Math.toRadians(pitch),
          roll: 0,
        },
        duration,
        complete: resolve,
        cancel: resolve,
      });
    });
  }

  setCameraPreset(name, animate = true) {
    const preset = this._cameraPresets?.[name];
    if (!preset) {
      console.warn(`TerrainEngine: Unknown camera preset "${name}"`);
      return;
    }

    if (animate) {
      return new Promise((resolve) => {
        this.camera.flyTo({
          destination: preset.destination,
          orientation: preset.orientation,
          duration: 2.5,
          complete: resolve,
          cancel: resolve,
        });
      });
    }

    this.camera.setView({
      destination: preset.destination,
      orientation: preset.orientation,
    });
  }

  getViewer() {
    return this.viewer;
  }

  destroy() {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }

    this.viewer = null;
    this.scene = null;
    this.camera = null;
    this.clock = null;
  }
}
