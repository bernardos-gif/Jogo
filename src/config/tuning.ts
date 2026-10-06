// Every gameplay number in Vector Front lives in this file: damage, recoil, speeds, timers,
// ticket counts, AI parameters and UI timings. Other modules import TUNING and never hard-code
// gameplay values. Rendering style constants (colors, shader coefficients) live in src/render.

export const TUNING = {
  // ---------------------------------------------------------------------------------------------
  // Simulation loop
  loop: {
    hz: 60,
    maxStepsPerFrame: 5,
    maxFrameSeconds: 0.25,
  },

  // ---------------------------------------------------------------------------------------------
  // Rendering budgets that behave like gameplay timings
  render: {
    dynamicResolution: {
      targetMs: 1000 / 60,
      downThreshold: 1.1,
      upThreshold: 0.78,
      step: 0.1,
      minScale: 0.6,
      cooldown: 1.5,
      smoothing: 0.05,
    },
  },

  // ---------------------------------------------------------------------------------------------
  // Automated tests (smoke and soak)
  test: {
    smokeSeconds: 90,
    soakMinutes: 10,
    bootTimeoutSeconds: 240,
    windowSize: '1280x720',
    minFrames: 120,
    /** Median frame time limit under Xvfb + software WebGL (an M1 GPU runs far below this). */
    maxMedianFrameMs: 250,
    /** The match clock must advance at least this fraction of wall time. */
    minSimRealtimeRatio: 0.5,
    statsWindow: 600,
  },

  // ---------------------------------------------------------------------------------------------
  // UI timings (seconds unless noted)
  ui: {
    bootSplashMin: 1.2,
    scanSweep: 0.42,
    panelIn: 0.22,
    tickUp: 0.6,
    glitch: 0.18,
    hitMarkerIn: 0.06,
    hitMarkerHold: 0.09,
    hitMarkerOut: 0.16,
    killFeedLife: 6,
    killFeedMax: 6,
    scoreEventLife: 2.4,
    scoreEventMax: 5,
    bannerIn: 0.6,
    bannerHold: 4,
    bannerOut: 0.5,
    hudRate: 30,
    minimapRate: 30,
    minimapRadius: 120,
    minimapZoomedRadius: 60,
    compassFov: 140,
    nameplateRange: 60,
    squadNameplateRange: 400,
    spottedMarkerRange: 300,
    pingLife: 8,
    pingEnemyLife: 6,
    killCamSeconds: 3.2,
    damageArcLife: 1.2,
    grenadeIndicatorRange: 12,
    lowAmmoFraction: 0.25,
    lowHealthFraction: 0.35,
    interactRange: 3,
    commsHoldSeconds: 0.25,
  },
};

export type Tuning = typeof TUNING;
