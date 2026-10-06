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
    wadeMul: 0.62,
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
  // Destruction
  destruction: {
    bulletMul: 1,
    explosionDamageMul: 1.6,
    explosionRadiusMul: 1.15,
    fuelTank: { radius: 12, damage: 150, inner: 4, vehicleDamage: 420 },
  },

  // ---------------------------------------------------------------------------------------------
  // Gadgets (expanded in M8)
  gadgets: {
    grapple: { range: 45, pullSpeed: 21, cooldown: 9 },
  },

  // ---------------------------------------------------------------------------------------------
  // Sector Control (capture, tickets, squads, spawning, round flow)
  sector: {
    tickets: 600,
    ticketsPerDeath: 1,
    /** Tickets per second the minority team loses, indexed by the zone-count lead (0..5). */
    bleed: [0, 0.22, 0.45, 0.75, 1.05, 1.5],
    /** Seconds for one attacker to take a zone from neutral to owned. */
    captureSeconds: 24,
    /** Each extra attacker adds this fraction of the base rate, up to maxCaptureMul. */
    capturePerExtra: 0.35,
    maxCaptureMul: 2.6,
    /** Owned zones with nobody inside drift back to full control at this fraction of the base rate. */
    regainMul: 0.5,
    teamSizeMin: 8,
    teamSizeMax: 32,
    squadSize: 4,
    respawnDelay: 8,
    deployCountdown: 3,
    hqSpawnRadius: 22,
    zoneSpawnMinRadius: 14,
    zoneSpawnMaxRadius: 30,
    /** A squadmate is a valid spawn when out of combat this long and no enemy is this close. */
    squadSpawnCombatSeconds: 6,
    squadSpawnEnemyRadius: 30,
    /** Spawning on a zone needs it owned and not contested. */
    spawnProtect: 1.5,
    endScreenSeconds: 12,
    killcamSeconds: 3.2,
    score: { kill: 100, headshotBonus: 25, assist: 50, revive: 80, capture: 200, neutralize: 150, captureAssist: 100, defend: 60, spot: 10, squadSpawnUse: 10, vehicleKill: 250, destroyProp: 5 },
  },

  // ---------------------------------------------------------------------------------------------
  // Skirmish (team deathmatch on the fenced Core Plaza)
  skirmish: {
    teamSize: 8,
    killTarget: 75,
    respawnDelay: 4,
    timeLimit: 900,
  },

  // ---------------------------------------------------------------------------------------------
  // Bots
  ai: {
    /**
     * Per-difficulty aim and decision quality. Aim errors are meters at the target (so they read
     * the same at any range): trackingFloor is the steady wander, rangeError adds per 100 m,
     * moveError adds per 5 m/s of target speed, initialError is the miss on first sight.
     * Times in seconds, turn speed in degrees per second, fov in degrees.
     */
    difficulty: {
      recruit: { reaction: 0.62, reactionJitter: 0.3, initialError: 3.6, trackingFloor: 0.55, errorDecay: 1.6, turnSpeed: 210, rangeError: 0.75, moveError: 0.5, headBias: 0.04, fov: 100, viewDistance: 190, burstMul: 0.75, pauseMul: 1.4, grenadeChance: 0.25, flankChance: 0.2, coverChance: 0.45, strafe: 0.6 },
      veteran: { reaction: 0.4, reactionJitter: 0.22, initialError: 2.6, trackingFloor: 0.34, errorDecay: 2.4, turnSpeed: 320, rangeError: 0.5, moveError: 0.34, headBias: 0.1, fov: 115, viewDistance: 240, burstMul: 1, pauseMul: 1, grenadeChance: 0.45, flankChance: 0.35, coverChance: 0.65, strafe: 0.85 },
      elite: { reaction: 0.26, reactionJitter: 0.14, initialError: 1.9, trackingFloor: 0.22, errorDecay: 3.3, turnSpeed: 460, rangeError: 0.32, moveError: 0.22, headBias: 0.2, fov: 125, viewDistance: 290, burstMul: 1.2, pauseMul: 0.75, grenadeChance: 0.6, flankChance: 0.5, coverChance: 0.8, strafe: 1 },
    },
    /** Level of detail by distance to the camera: think and perception intervals per bucket. */
    lod: {
      nearRange: 90,
      midRange: 230,
      think: [0.1, 0.22, 0.5] as [number, number, number],
      perceive: [0.15, 0.32, 0.7] as [number, number, number],
      /** Path requests the director serves per sim tick. */
      pathBudget: 6,
      /** Seconds between level-of-detail reassignments. */
      refresh: 0.25,
    },
    perception: {
      /** Enemies this close are noticed in any direction. */
      closeAwareness: 14,
      hearShots: 80,
      hearSuppressed: 18,
      /** Spotted enemies are seen this much further. */
      spottedRangeMul: 1.5,
      forgetAfter: 7,
      /** Line-of-sight checks per perception tick. */
      losChecks: 4,
      /** Stickiness: the current target's score is multiplied by this. */
      targetKeep: 1.35,
    },
    combat: {
      /** Effective engagement range by weapon category (bots prefer to close beyond it). */
      engageRange: { ar: 110, smg: 45, lmg: 120, dmr: 170, sniper: 260, shotgun: 18, sidearm: 30, launcher: 90 } as Record<string, number>,
      /** Burst length (shots) by category for automatic fire. */
      burst: { ar: [3, 7], smg: [4, 10], lmg: [6, 14], dmr: [1, 2], sniper: [1, 1], shotgun: [1, 1], sidearm: [1, 3], launcher: [1, 1] } as Record<string, [number, number]>,
      /** Pause between bursts (seconds), stretched with range. */
      pause: [0.16, 0.45] as [number, number],
      pausePer100m: 0.35,
      /** Semi-automatic cadence (seconds between trigger pulls). */
      semiInterval: [0.22, 0.42] as [number, number],
      /** Fire only when the aim is within this many target radii of the target. */
      fireTolerance: 2.2,
      adsBeyond: 16,
      crouchBeyond: 45,
      strafeInterval: [0.5, 1.4] as [number, number],
      reloadBelow: 0.4,
      /** Seconds to keep firing at the last known position after losing sight. */
      suppressFor: 1.6,
      finishDownedChance: 0.5,
      /** Largest first-sight miss (degrees). */
      maxInitialError: 12,
    },
    cover: {
      searchRadius: 20,
      peek: [0.9, 2.0] as [number, number],
      hide: [0.6, 1.5] as [number, number],
      /** Suppression or missing health above this sends the bot to cover. */
      seekSuppression: 0.45,
      seekHealth: 55,
      tallSideStep: 1.1,
      holdSeconds: [6, 12] as [number, number],
    },
    suppression: {
      perNearMiss: 0.16,
      perHit: 0.3,
      nearMissRadius: 3.5,
      /** Shots farther than this along the line no longer suppress. */
      maxShotRange: 300,
      decay: 0.4,
      /** Aim error multiplier at full suppression. */
      maxErrorMul: 2.4,
    },
    grenades: {
      minRange: 10,
      maxRange: 30,
      cooldown: 14,
      /** Evade live frags within this radius. */
      evadeRadius: 8,
    },
    revive: {
      searchRange: 30,
      medicSearchRange: 55,
      /** Skip the revive when an enemy is visible closer than this. */
      threatRange: 25,
    },
    movement: {
      waypointRadius: 1.1,
      arriveRadius: 2.2,
      repathEvery: 6,
      stuckSeconds: 1.1,
      stuckMinMove: 0.35,
      sprintBeyond: 14,
      tacSprintChance: 0.25,
      jumpGapChance: 0.0,
      /** Seconds between idle look-around turns. */
      lookAround: [1.5, 3.5] as [number, number],
    },
    squad: {
      evalEvery: 6,
      /** A new objective must beat the current one by this much. */
      hysteresis: 0.25,
      distanceWeight: 0.55,
      /** Value by ownership state. */
      neutral: 1.1,
      enemyOwned: 1.0,
      ownContested: 1.5,
      ownThreatened: 1.2,
      ownSafe: 0.25,
      /** Losing on tickets raises the value of zones that flip the bleed. */
      ticketPressure: 0.6,
      /** Known enemies near a zone: value drop per enemy beyond the squad's strength. */
      threatPerEnemy: 0.08,
      /** Value drop per other friendly squad already assigned. */
      crowding: 0.35,
      spreadRadius: 9,
      flankOffset: 50,
      regroupDistance: 90,
      regroupChance: 0.15,
      /** Squad evaluations per sim tick (staggered). */
      evalsPerTick: 2,
      /** Chance a respawning bot picks a squadmate over the best zone. */
      squadSpawnChance: 0.45,
      defendRadius: 0.8,
    },
    spotting: {
      cooldown: 6,
      duration: 6,
      pingChance: 0.25,
    },
    /** Soldier-brain heuristics. */
    brain: {
      /** Random stretch of think and perception intervals (fraction). */
      intervalJitter: 0.3,
      targetDownedMul: 0.25,
      targetAttackerMul: 2,
      targetPlayerMul: 1.05,
      /** Seconds out of sight before a re-sighting counts as a new engagement. */
      reacquireAfter: 1.5,
      evadeSeconds: 1.6,
      crouchChance: 0.5,
      /** Approach when farther than this fraction of the weapon's engage range; back off (marksmen) inside backOffWithin. */
      approachBeyond: 0.9,
      backOffWithin: 0.25,
      strafeWeight: 0.8,
      /** Fraction of the target's velocity times flight time added as lead. */
      leadFactor: 0.85,
      /** Fire once the aim is within the tracking floor times this. */
      settleMul: 1.8,
      throwRelease: 0.25,
      throwHold: 1.1,
      throwTurnMul: 1.5,
      /** Chance to throw at a fully exposed target (hidden targets always qualify). */
      grenadeExposedChance: 0.3,
      /** Cooldown fraction after deciding not to throw. */
      grenadeRetryMul: 0.3,
      coverFacingMin: 0.55,
      coverFacingWeight: 6,
      coverInvalidFacing: 0.25,
      coverMinThreatDist: 8,
      coverDistanceWeight: 0.4,
      coverTallBonus: 0.5,
      defendCoverMin: 0.3,
      /** Squadmates count as this fraction of their distance when picking whom to revive. */
      squadReviveBias: 0.6,
      idlePitch: -0.03,
      lookTurnMul: 0.6,
      lookSpread: 1.2,
      stanceInterval: 0.4,
      /** Bursts shorten with range (meters for the full reduction, max reduction). */
      burstRangeShrink: 300,
      burstMaxShrink: 0.6,
      /** Semi-auto cadence stretches by 1 + dist / this. */
      semiRangeStretch: 220,
      burstModeMul: 1.6,
      flankArrive: 15,
    },
    /** Bot roster: class mix and per-class weapon and throwable pools. */
    loadout: {
      classWeights: { assault: 0.34, engineer: 0.22, support: 0.24, recon: 0.2 },
      weapons: {
        assault: ['tern', 'lumen', 'wasp', 'flicker', 'maul'],
        engineer: ['wasp', 'flicker', 'tern', 'anvil'],
        support: ['anvil', 'torrent', 'lumen', 'tern'],
        recon: ['sable', 'prism', 'longbow', 'lumen'],
      },
      throwables: { assault: ['frag', 'frag', 'smoke'], engineer: ['frag', 'emp'], support: ['frag', 'smoke'], recon: ['frag', 'emp', 'smoke'] },
      /** Chance each attachment slot rolls a random option instead of the default. */
      attachmentRandom: 0.5,
    },
    /** A downed bot with no teammate within helpRange gives up after this many seconds. */
    downedGiveUp: 8,
    downedHelpRange: 45,
    /** Simplified resolution for far bots shooting far targets (no projectile simulation). */
    farCombat: {
      /** Probability scale for a hit roll (multiplied by angular target size vs. aim error). */
      hitScale: 0.85,
      headChance: 0.08,
      tracerEvery: 3,
    },
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
