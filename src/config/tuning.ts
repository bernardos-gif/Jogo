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
  // Soldier movement (meters, seconds)
  movement: {
    gravity: 19,
    walkSpeed: 4.3,
    sprintSpeed: 6.7,
    tacSprintSpeed: 7.9,
    tacSprintMax: 6,
    tacSprintCooldown: 2.5,
    doubleTapWindow: 0.3,
    crouchSpeed: 2.5,
    proneSpeed: 1.05,
    adsSpeedMul: 0.62,
    backwardMul: 0.82,
    strafeMul: 0.9,
    groundAccel: 48,
    groundFriction: 11,
    airAccel: 9,
    airControl: 0.35,
    jumpVelocity: 6.2,
    jumpCooldown: 0.25,
    coyoteTime: 0.12,
    ccOffset: 0.02,
    maxSlopeDeg: 50,
    slideSlopeDeg: 55,
    stepHeight: 0.45,
    stepMinWidth: 0.25,
    snapToGround: 0.4,
    capsuleRadius: 0.36,
    standHalfHeight: 0.56,
    crouchHalfHeight: 0.24,
    proneHalfHeight: 0.0,
    eyeStand: 1.66,
    eyeCrouch: 1.12,
    eyeProne: 0.42,
    stanceBlendRate: 12,
    proneTransition: 0.55,
    slideMinSpeed: 5.6,
    slideBoost: 2.6,
    slideFriction: 3.4,
    slideDuration: 0.9,
    slideCooldown: 0.8,
    slideEndSpeed: 2.6,
    mantleMaxHeight: 2.25,
    vaultMaxHeight: 1.2,
    mantleReach: 0.85,
    mantleAnticipation: 0.12,
    mantleTime: 0.5,
    vaultTime: 0.42,
    ladderSpeed: 3.6,
    ladderGrabRange: 1.2,
    ladderExitBoost: 3,
    ziplineSpeed: 15,
    ziplineAccel: 9,
    ziplineGrabRange: 2.2,
    parachuteMinHeight: 8,
    parachuteDeploySpeed: -9,
    parachuteFallSpeed: 4.6,
    parachuteSpeed: 9.5,
    parachuteAccel: 4,
    wingsuitForward: 24,
    wingsuitSink: 5.5,
    wingsuitTurnRate: 1.4,
    fallDamageMinSpeed: 13,
    fallDamagePerSpeed: 9,
    fallDeathSpeed: 26,
    elevatorSpeed: 3.2,
    elevatorWait: 4,
    mapLimit: 585,
    outOfBoundsSeconds: 10,
  },

  // ---------------------------------------------------------------------------------------------
  // Health, armor, downed state
  health: {
    max: 100,
    regenDelay: 5,
    regenRate: 14,
    armorPlate: 20,
    armorAbsorb: 0.7,
    downedSeconds: 22,
    downedHealth: 35,
    reviveTime: 3.0,
    reviveTimeMedic: 1.6,
    revivedHealth: 30,
    reviveRange: 1.8,
    outOfCombatSeconds: 5,
    headshotExecuteDowned: true,
  },

  // ---------------------------------------------------------------------------------------------
  // First-person camera and feel
  camera: {
    defaultFov: 90,
    minFov: 60,
    maxFov: 110,
    near: 0.06,
    far: 2400,
    sprintFovAdd: 4,
    tacSprintFovAdd: 7,
    slideFovAdd: 6,
    bobAmplitude: 0.035,
    bobRate: 1.0,
    landKick: 0.08,
    shakeDecay: 1.6,
    shakeMaxAngle: 0.05,
    shakeMaxOffset: 0.12,
    explosionShakeRadius: 30,
    leanAngle: 0.0,
    defaultSensitivity: 1.0,
    defaultAdsSensitivity: 0.85,
    defaultVehicleSensitivity: 1.0,
    mouseRadiansPerPixel: 0.0022,
    pitchLimit: 1.5,
    thirdPersonDistance: 4.2,
    deathCamDistance: 6,
  },

  // ---------------------------------------------------------------------------------------------
  // Viewmodel (procedural first-person animation)
  viewmodel: {
    fov: 56,
    hipOffset: [0.16, -0.19, -0.42] as [number, number, number],
    sprintOffset: [0.05, -0.2, -0.26] as [number, number, number],
    adsDepth: -0.24,
    swayAmount: 0.0024,
    swayMax: 0.06,
    swayReturn: 9,
    bobAmount: 0.012,
    recoilKickBack: 0.045,
    recoilKickUp: 0.035,
    recoilStiffness: 160,
    recoilDamping: 14,
    equipTime: 0.45,
    inspectTime: 2.4,
    meleeTime: 0.55,
    throwTime: 0.7,
  },

  // ---------------------------------------------------------------------------------------------
  // Gadgets (expanded in M8)
  gadgets: {
    grapple: { range: 45, pullSpeed: 21, cooldown: 9 },
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
