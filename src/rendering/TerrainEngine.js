/**
 * TerrainEngine.js
 * CesiumJS-based 3D terrain renderer for Whistler Blackcomb ski resort.
 * Handles terrain visualization, camera control, atmosphere, and post-processing.
 */

const WHISTLER_BLACKCOMB = {
  lat: 50.1163,
  lng: -122.9574,
  overviewAltitude: 8000,
};

const CAMERA_PRESETS = {
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

const TREELINE_ELEVATION = 1800;

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
    this._snowShadingEnabled = false;
    this._dayNightCycleEnabled = true;
    this._gameTimeHours = 12;
  }

  /**
   * Initialize the Cesium viewer, terrain, atmosphere, and post-processing.
   * @returns {Promise<Cesium.Viewer>} The initialized viewer instance.
   */
  async init() {
    // Use the built-in Cesium Ion default access token.
    // Replace with your own token for production use.
    Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlNzYzYzYzNS0wYjQyLTRlMGYtYWFmYi03YmFhMTQzNTFiM2YiLCJpZCI6NDA5NTYwLCJpYXQiOjE3NzQ5Nzc1NTd9.EDmasSi2FWla5znlEiDkuqhZXJ0X4l1ILo8Hlj2GoYY';

    this.viewer = new Cesium.Viewer('cesium-container', {
      terrainProvider: await Cesium.createWorldTerrainAsync({
        requestVertexNormals: true,
        requestWaterMask: true,
      }),
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      vrButton: false,
      selectionIndicator: true,
      infoBox: false,
      shadows: true,
      shouldAnimate: true,
    });

    this.scene = this.viewer.scene;
    this.camera = this.viewer.camera;
    this.clock = this.viewer.clock;

    this._configureTerrain();
    this._configureAtmosphere();
    this._configureLighting();
    this._configureCameraControls();
    this._configurePostProcessing();
    this._applySnowShader();
    this._setWinterTime();
    this._bindResizeHandler();

    this.setCameraPreset('overview');

    return this.viewer;
  }

  /**
   * Configure terrain rendering options.
   */
  _configureTerrain() {
    this.scene.globe.enableLighting = true;
    this.scene.globe.depthTestAgainstTerrain = true;
    this.scene.globe.showGroundAtmosphere = true;
    this.scene.globe.showWaterEffect = true;
    this.scene.globe.terrainExaggeration = 1.0;
  }

  /**
   * Configure winter atmosphere: overcast sky, fog, and snow feel.
   */
  _configureAtmosphere() {
    // Overcast, muted sky for winter conditions
    this.scene.skyAtmosphere.hueShift = -0.02;
    this.scene.skyAtmosphere.saturationShift = -0.4;
    this.scene.skyAtmosphere.brightnessShift = -0.1;

    // Ground atmosphere with winter haze
    this.scene.globe.atmosphereLightIntensity = 8.0;
    this.scene.globe.atmosphereRayleighScaleHeight = 12000;
    this.scene.globe.atmosphereMieScaleHeight = 4000;

    // Fog for distance atmosphere
    this.scene.fog.enabled = true;
    this.scene.fog.density = 0.0004;
    this.scene.fog.minimumBrightness = 0.25;
    this.scene.fog.screenSpaceErrorFactor = 4.0;

    // Muted sky box for overcast winter look
    this.scene.skyBox.show = true;
    this.scene.backgroundColor = new Cesium.Color(0.75, 0.78, 0.82, 1.0);
  }

  /**
   * Configure lighting and shadows for winter daytime.
   */
  _configureLighting() {
    this.scene.light = new Cesium.SunLight();
    this.scene.globe.enableLighting = true;

    // Softer shadows for overcast winter light
    this.viewer.shadows = true;
    this.viewer.shadowMap.enabled = true;
    this.viewer.shadowMap.softShadows = true;
    this.viewer.shadowMap.darkness = 0.5;
    this.viewer.shadowMap.size = 2048;
    this.viewer.shadowMap.maximumDistance = 5000;
  }

  /**
   * Configure camera controls with orbit, zoom, tilt, and smooth inertia.
   */
  _configureCameraControls() {
    const controller = this.scene.screenSpaceCameraController;

    // Enable all standard interaction modes
    controller.enableRotate = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableLook = true;

    // Smooth inertia for orbit and zoom
    controller.inertiaSpin = 0.7;
    controller.inertiaTranslate = 0.7;
    controller.inertiaZoom = 0.6;

    // Constrain minimum zoom to avoid going underground
    controller.minimumZoomDistance = 50;
    controller.maximumZoomDistance = 30000;

    // Tilt constraints
    controller.minimumCollisionTerrainHeight = 15;
  }

  /**
   * Configure post-processing: ambient occlusion and bloom for snow glare.
   */
  _configurePostProcessing() {
    this.postProcessStages = this.scene.postProcessStages;

    // Ambient occlusion for depth on terrain
    if (this.postProcessStages.ambientOcclusion) {
      const ao = this.postProcessStages.ambientOcclusion;
      ao.enabled = true;
      ao.uniforms.intensity = 4.0;
      ao.uniforms.bias = 0.05;
      ao.uniforms.lengthCap = 0.03;
      ao.uniforms.stepSize = 1.5;
      ao.uniforms.frustumLength = 800;
      ao.uniforms.ambientOcclusionOnly = false;
    }

    // Bloom for snow glare effect
    if (this.postProcessStages.bloom) {
      const bloom = this.postProcessStages.bloom;
      bloom.enabled = true;
      bloom.uniforms.glowOnly = false;
      bloom.uniforms.contrast = 110;
      bloom.uniforms.brightness = 0.02;
      bloom.uniforms.delta = 1.2;
      bloom.uniforms.sigma = 3.0;
      bloom.uniforms.stepSize = 2.0;
    }
  }

  /**
   * Apply a snow shader to tint terrain white above the treeline.
   * Uses a custom globe material to blend snow color at higher elevations.
   */
  _applySnowShader() {
    const snowMaterial = new Cesium.Material({
      fabric: {
        type: 'SnowTerrain',
        uniforms: {
          treelineHeight: TREELINE_ELEVATION,
          snowColor: new Cesium.Color(0.95, 0.96, 0.98, 1.0),
          blendRange: 200.0,
        },
        source: `
          uniform float treelineHeight;
          uniform vec4 snowColor;
          uniform float blendRange;

          czm_material czm_getMaterial(czm_materialInput materialInput) {
            czm_material material = czm_getDefaultMaterial(materialInput);
            float height = materialInput.height;
            float snowFactor = clamp(
              (height - treelineHeight) / blendRange,
              0.0,
              1.0
            );
            material.diffuse = mix(material.diffuse, snowColor.rgb, snowFactor * 0.7);
            material.alpha = 1.0;
            return material;
          }
        `,
      },
    });

    // Apply via globe material if supported; otherwise use a post-process approach
    if (this.scene.globe.material !== undefined) {
      this.scene.globe.material = snowMaterial;
      this._snowShadingEnabled = true;
    }
  }

  /**
   * Set Cesium clock to a winter daytime for good lighting.
   */
  _setWinterTime() {
    // January 15 at noon local time (PST = UTC-8)
    const winterDate = Cesium.JulianDate.fromDate(new Date(2026, 0, 15, 20, 0, 0));
    this.clock.currentTime = winterDate;
    this.clock.shouldAnimate = false;
    this.clock.multiplier = 1;
  }

  /**
   * Bind a window resize handler to keep the viewer properly sized.
   */
  _bindResizeHandler() {
    this._resizeHandler = () => {
      if (this.viewer && !this.viewer.isDestroyed()) {
        this.viewer.resize();
      }
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  /**
   * Update rendering state each frame based on game state.
   * Handles day/night cycle and any dynamic terrain adjustments.
   * @param {Object} gameState - Current game state with time, weather, etc.
   */
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

  /**
   * Update lighting to simulate day/night based on game time.
   * @param {number} hours - Game time in hours (0-24).
   */
  _updateDayNightCycle(hours) {
    if (!this._dayNightCycleEnabled) return;

    // Map game hours to a winter day at Whistler latitude
    const winterDate = new Date(2026, 0, 15);
    winterDate.setUTCHours(hours + 8); // PST offset
    winterDate.setUTCMinutes((hours % 1) * 60);
    this.clock.currentTime = Cesium.JulianDate.fromDate(winterDate);

    // Adjust atmosphere brightness for dawn/dusk transitions
    const dayProgress = (hours - WINTER_SUNRISE_HOUR) / (WINTER_SUNSET_HOUR - WINTER_SUNRISE_HOUR);
    const clamped = Math.max(0, Math.min(1, dayProgress));

    if (hours < WINTER_SUNRISE_HOUR || hours > WINTER_SUNSET_HOUR) {
      // Night time - dim atmosphere
      this.scene.skyAtmosphere.brightnessShift = -0.4;
      this.scene.fog.minimumBrightness = 0.05;
    } else if (clamped < 0.1 || clamped > 0.9) {
      // Dawn/dusk - golden hour tint
      this.scene.skyAtmosphere.brightnessShift = -0.2;
      this.scene.skyAtmosphere.hueShift = 0.02;
      this.scene.fog.minimumBrightness = 0.15;
    } else {
      // Daytime - standard winter overcast
      this.scene.skyAtmosphere.brightnessShift = -0.1;
      this.scene.skyAtmosphere.hueShift = -0.02;
      this.scene.fog.minimumBrightness = 0.25;
    }
  }

  /**
   * Adjust atmosphere rendering based on weather conditions.
   * @param {Object} weather - Weather state { condition, windSpeed, visibility }.
   */
  _updateWeatherAtmosphere(weather) {
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
        this.scene.fog.density = 0.0008;
        this.scene.skyAtmosphere.saturationShift = -0.5;
        this.scene.skyAtmosphere.brightnessShift = -0.15;
        break;
      case 'blizzard':
        this.scene.fog.density = 0.002;
        this.scene.skyAtmosphere.saturationShift = -0.6;
        this.scene.skyAtmosphere.brightnessShift = -0.25;
        break;
      default:
        break;
    }

    if (typeof visibility === 'number') {
      // Scale fog density inversely with visibility (0-1 range)
      this.scene.fog.density = 0.0002 + (1 - visibility) * 0.003;
    }
  }

  /**
   * Smoothly fly the camera to a specific location.
   * @param {Object} location - { lat, lng, altitude, heading, pitch }
   * @param {number} [duration=2.0] - Flight duration in seconds.
   * @returns {Promise<void>} Resolves when the flight completes.
   */
  flyTo(location, duration = 2.0) {
    return new Promise((resolve, reject) => {
      if (!this.viewer || this.viewer.isDestroyed()) {
        reject(new Error('Viewer is not initialized or has been destroyed'));
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
        duration: duration,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: resolve,
        cancel: resolve,
      });
    });
  }

  /**
   * Set the camera to a named preset position.
   * @param {string} name - Preset name: 'overview', 'whistler-peak', 'blackcomb-peak', 'village', 'peak2peak'.
   * @param {boolean} [animate=true] - Whether to animate the transition.
   * @returns {Promise<void>|undefined}
   */
  setCameraPreset(name, animate = true) {
    const preset = CAMERA_PRESETS[name];
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
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
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

  /**
   * Get the underlying Cesium Viewer instance.
   * @returns {Cesium.Viewer|null}
   */
  getViewer() {
    return this.viewer;
  }

  /**
   * Destroy the viewer and clean up all resources.
   */
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
    this.postProcessStages = null;
  }
}
