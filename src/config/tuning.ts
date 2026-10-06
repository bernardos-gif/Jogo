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
  // Hitboxes (meters above the feet; prone offsets are along the facing direction)
  hitboxes: {
    stand: { head: 1.64, headR: 0.2, torso: [0.92, 1.36] as [number, number], torsoR: 0.29, legs: [0.14, 0.82] as [number, number], legsR: 0.23 },
    crouch: { head: 1.12, headR: 0.2, torso: [0.6, 0.94] as [number, number], torsoR: 0.29, legs: [0.14, 0.5] as [number, number], legsR: 0.24 },
    prone: { headFwd: 0.85, headY: 0.32, headR: 0.2, torsoFwd: [0.55, -0.15] as [number, number], torsoY: 0.3, torsoR: 0.27, legsFwd: [-0.25, -1.05] as [number, number], legsY: 0.18, legsR: 0.18 },
    broadRadius: 1.4,
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
  // Weapons. damage: [max, min] over range [start, end] meters. Recoil pattern: per-shot
  // [vertical, horizontal] degrees (deterministic), plus `random` degrees of seeded noise.
  // Spread in degrees. Times in seconds. Velocity in m/s; drop multiplies world gravity.
  weapons: {
    gravity: 9.81,
    maxProjectileLife: 3,
    tracerEvery: 2,
    defaults: { headMul: 1.6, limbMul: 0.85, armorMul: 1, penetration: 1, pellets: 1, pelletSpread: 0, burst: 3, moveMul: 1, equip: 0.42, gravityMul: 1, vehicleMul: 0.06 },
    list: {
      tern: { damage: [24, 16], range: [15, 60], rpm: 760, modes: ['auto', 'burst', 'single'], mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.7, velocity: 760, adsTime: 0.24, sprintToFire: 0.18, hip: 2.6, ads: 0.14, move: 1.1, bloom: 0.11, bloomHip: 0.32, bloomMax: 1.8, bloomRecover: 6, recoil: { pattern: [[0.42, 0.05], [0.44, -0.08], [0.46, 0.1], [0.4, 0.14], [0.38, -0.12], [0.36, 0.18], [0.36, -0.2], [0.34, 0.12]], random: 0.08, recover: 0.6 }, penetration: 1 },
      lumen: { damage: [22, 17], range: [20, 70], rpm: 680, modes: ['auto', 'single'], mag: 36, reserve: 180, reload: 2.3, reloadEmpty: 2.8, velocity: 1250, gravityMul: 0.2, adsTime: 0.26, sprintToFire: 0.2, hip: 2.4, ads: 0.12, move: 1.0, bloom: 0.09, bloomHip: 0.28, bloomMax: 1.6, bloomRecover: 6.5, recoil: { pattern: [[0.32, 0.12], [0.34, -0.14], [0.33, 0.16], [0.31, -0.18], [0.3, 0.2], [0.3, -0.2]], random: 0.12, recover: 0.65 }, penetration: 1 },
      wasp: { damage: [20, 11], range: [10, 35], rpm: 950, modes: ['auto', 'single'], mag: 32, reserve: 192, reload: 1.9, reloadEmpty: 2.4, velocity: 520, adsTime: 0.18, sprintToFire: 0.12, hip: 2.0, ads: 0.2, move: 0.8, bloom: 0.1, bloomHip: 0.25, bloomMax: 1.6, bloomRecover: 7, recoil: { pattern: [[0.3, 0.1], [0.32, -0.12], [0.3, 0.14], [0.28, -0.16], [0.28, 0.18], [0.26, -0.18]], random: 0.1, recover: 0.7 }, penetration: 0, moveMul: 1.04 },
      flicker: { damage: [18, 12], range: [12, 40], rpm: 880, modes: ['auto', 'burst'], mag: 45, reserve: 225, reload: 2.2, reloadEmpty: 2.6, velocity: 900, gravityMul: 0.3, adsTime: 0.19, sprintToFire: 0.12, hip: 2.1, ads: 0.2, move: 0.8, bloom: 0.08, bloomHip: 0.24, bloomMax: 1.5, bloomRecover: 7, recoil: { pattern: [[0.26, -0.08], [0.27, 0.1], [0.26, -0.12], [0.25, 0.14], [0.25, -0.14]], random: 0.1, recover: 0.7 }, penetration: 0, moveMul: 1.04 },
      anvil: { damage: [25, 18], range: [20, 80], rpm: 620, modes: ['auto'], mag: 100, reserve: 200, reload: 4.6, reloadEmpty: 5.5, velocity: 820, adsTime: 0.38, sprintToFire: 0.3, hip: 3.4, ads: 0.18, move: 1.4, bloom: 0.1, bloomHip: 0.34, bloomMax: 2.2, bloomRecover: 5, recoil: { pattern: [[0.46, 0.1], [0.44, -0.12], [0.42, 0.16], [0.4, -0.18], [0.4, 0.2], [0.38, -0.22]], random: 0.12, recover: 0.55 }, penetration: 2, moveMul: 0.93 },
      torrent: { damage: [19, 15], range: [25, 80], rpm: 780, modes: ['auto'], mag: 0, reserve: 0, reload: 0, reloadEmpty: 0, velocity: 1300, gravityMul: 0.15, adsTime: 0.36, sprintToFire: 0.28, hip: 3.0, ads: 0.16, move: 1.3, bloom: 0.08, bloomHip: 0.3, bloomMax: 2.0, bloomRecover: 5, recoil: { pattern: [[0.3, 0.06], [0.31, -0.08], [0.3, 0.1], [0.29, -0.1]], random: 0.14, recover: 0.6 }, penetration: 1, moveMul: 0.93, heat: { perShot: 0.012, cool: 0.32, coolDelay: 0.35, lockout: 2.4 } },
      sable: { damage: [44, 34], range: [40, 120], rpm: 300, modes: ['single'], mag: 20, reserve: 100, reload: 2.5, reloadEmpty: 3.1, velocity: 880, adsTime: 0.3, sprintToFire: 0.26, hip: 3.2, ads: 0.06, move: 1.6, bloom: 0.25, bloomHip: 0.6, bloomMax: 2.2, bloomRecover: 5, recoil: { pattern: [[0.85, 0.15], [0.8, -0.2], [0.82, 0.22]], random: 0.15, recover: 0.75 }, penetration: 2, headMul: 1.9 },
      prism: { damage: [32, 26], range: [40, 110], rpm: 520, modes: ['burst', 'single'], burst: 3, mag: 18, reserve: 108, reload: 2.4, reloadEmpty: 2.9, velocity: 1400, gravityMul: 0.1, adsTime: 0.3, sprintToFire: 0.26, hip: 3.0, ads: 0.08, move: 1.5, bloom: 0.18, bloomHip: 0.5, bloomMax: 2.0, bloomRecover: 5.5, recoil: { pattern: [[0.55, 0.1], [0.55, -0.12], [0.6, 0.1]], random: 0.12, recover: 0.75 }, penetration: 1, headMul: 1.8 },
      longbow: { damage: [95, 80], range: [60, 250], rpm: 52, modes: ['single'], mag: 5, reserve: 30, reload: 3.0, reloadEmpty: 3.6, velocity: 950, adsTime: 0.45, sprintToFire: 0.35, hip: 6, ads: 0.0, move: 3, bloom: 0.5, bloomHip: 2, bloomMax: 4, bloomRecover: 4, recoil: { pattern: [[2.4, 0.3]], random: 0.4, recover: 0.9 }, penetration: 2, headMul: 2.2, limbMul: 0.8, bolt: 1.0, equip: 0.55 },
      maul: { damage: [14, 3], range: [6, 24], rpm: 72, modes: ['single'], mag: 8, reserve: 40, reload: 0.5, reloadEmpty: 0.5, perShell: true, velocity: 420, adsTime: 0.24, sprintToFire: 0.2, hip: 2.6, ads: 1.6, move: 0.6, bloom: 0.2, bloomHip: 0.3, bloomMax: 1, bloomRecover: 4, recoil: { pattern: [[2.0, 0.2]], random: 0.4, recover: 0.85 }, penetration: 0, pellets: 9, pelletSpread: 3.2, headMul: 1.3, bolt: 0.7 },
      sparrow: { damage: [28, 16], range: [12, 40], rpm: 420, modes: ['single'], mag: 15, reserve: 60, reload: 1.5, reloadEmpty: 1.9, velocity: 380, adsTime: 0.15, sprintToFire: 0.1, hip: 1.6, ads: 0.25, move: 0.6, bloom: 0.25, bloomHip: 0.4, bloomMax: 1.8, bloomRecover: 6, recoil: { pattern: [[0.9, 0.12], [0.9, -0.14]], random: 0.2, recover: 0.85 }, penetration: 0, equip: 0.28, moveMul: 1.05 },
      hammerhead: { damage: [120, 120], range: [0, 1], rpm: 30, modes: ['single'], mag: 1, reserve: 3, reload: 3.4, reloadEmpty: 3.4, velocity: 70, gravityMul: 0.25, adsTime: 0.4, sprintToFire: 0.35, hip: 2.0, ads: 0.2, move: 1.2, bloom: 0, bloomHip: 0, bloomMax: 0, bloomRecover: 3, recoil: { pattern: [[3.2, 0.3]], random: 0.5, recover: 0.6 }, penetration: 0, equip: 0.7, moveMul: 0.95, vehicleMul: 1 },
    },
    rocket: { accel: 160, maxSpeed: 125, splashDamage: 90, splashRadius: 4.5, vehicleDamage: 340, lockTime: 1.2, lockRange: 420, lockCone: 7, turnRate: 1.7, life: 6 },
    /** Spread multipliers by stance and state. */
    stanceSpread: { stand: 1, crouch: 0.8, prone: 0.6, air: 2.2, slide: 1.4 },
    /** Fraction of damage kept after penetrating a thin surface. */
    penetrationKeep: 0.6,
    /** Recoil recovery: seconds after the last shot before the aim drifts back. */
    recoilRecoverDelay: 0.12,
    recoilRecoverRate: 9,
    whizRadius: 3,
    suppressionPerWhiz: 0.25,
    suppressionDecay: 0.6,
  },

  /** Attachment modifiers (multiplicative unless noted). */
  attachments: {
    sights: {
      iron: { zoom: 1.1, adsTime: 1.0, scoped: false },
      holo: { zoom: 1.25, adsTime: 1.0, scoped: false },
      prism2: { zoom: 2, adsTime: 1.06, scoped: false },
      optic4: { zoom: 4, adsTime: 1.15, scoped: true },
      optic8: { zoom: 8, adsTime: 1.3, scoped: true },
      thermal6: { zoom: 6, adsTime: 1.22, scoped: true },
    },
    barrels: {
      standard: { recoilV: 1, recoilH: 1, velocity: 1, range: 1, adsTime: 1, suppressed: false },
      compensator: { recoilV: 0.82, recoilH: 0.9, velocity: 1, range: 1, adsTime: 1, suppressed: false },
      suppressor: { recoilV: 0.92, recoilH: 0.95, velocity: 0.9, range: 0.85, adsTime: 1.04, suppressed: true },
      longBarrel: { recoilV: 0.92, recoilH: 1, velocity: 1.15, range: 1.2, adsTime: 1.1, suppressed: false },
    },
    underbarrels: {
      none: { recoilV: 1, recoilH: 1, adsTime: 1, hip: 1, braced: 1 },
      vgrip: { recoilV: 0.85, recoilH: 1, adsTime: 1.03, hip: 1, braced: 1 },
      agrip: { recoilV: 0.95, recoilH: 1.05, adsTime: 0.85, hip: 1, braced: 1 },
      laser: { recoilV: 1, recoilH: 1, adsTime: 1, hip: 0.65, braced: 1 },
      bipod: { recoilV: 1, recoilH: 1, adsTime: 1.1, hip: 1, braced: 0.55 },
    },
    ammo: {
      standard: { damage: 1, velocity: 1, drop: 1, penetration: 0, armor: 1, range: 1, rpm: 1, mag: 1, heat: 1, spread: 1 },
      piercing: { damage: 0.92, velocity: 1, drop: 1, penetration: 1, armor: 1.45, range: 1, rpm: 1, mag: 1, heat: 1, spread: 1 },
      velocity: { damage: 1, velocity: 1.25, drop: 0.8, penetration: 0, armor: 1, range: 1.05, rpm: 1, mag: 1, heat: 1, spread: 1 },
      overcharge: { damage: 1.12, velocity: 1, drop: 1, penetration: 0, armor: 1.1, range: 1, rpm: 1, mag: 0.8, heat: 1.25, spread: 1.05 },
      focused: { damage: 1, velocity: 1.1, drop: 0.8, penetration: 0, armor: 1, range: 1.25, rpm: 0.9, mag: 1, heat: 0.9, spread: 0.85 },
    },
  },

  throwables: {
    throwSpeed: 18,
    throwUp: 4,
    bounce: 0.38,
    friction: 0.7,
    cooking: false,
    frag: { count: 2, fuse: 2.6, damage: 125, radius: 7.5, innerRadius: 2.2 },
    smoke: { count: 1, fuse: 1.4, duration: 16, radius: 7, puffRate: 7 },
    emp: { count: 1, fuse: 1.6, radius: 9, disable: 6, damage: 10 },
    resupplyEvery: 30,
  },

  melee: { damage: 55, takedownDamage: 200, range: 2.3, cone: 0.6, cooldown: 0.8, windup: 0.18 },

  explosions: {
    /** Damage scale when the blast's line of sight to the target is blocked. */
    occludedMul: 0.35,
    shakePerDamage: 0.006,
    selfDamageMul: 0.6,
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
