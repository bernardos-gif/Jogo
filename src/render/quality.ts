// Graphics presets. Low / Medium / High mirror Elemental Brawl's profiles (shadows, pixel ratio,
// particles, MSAA, bloom); the battlefield-specific values (fog, shadow box, view distance,
// crowd detail) are Vector Front's.

export type PresetId = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  shadows: boolean;
  shadowMapSize: number;
  shadowRadius: number;
  pixelRatioCap: number;
  maxParticles: number;
  particleScale: number;
  msaa: number;
  bloom: boolean;
  bloomStrength: number;
  clouds: number;
  fogNear: number;
  fogFar: number;
  viewDistance: number;
  debrisChunks: number;
  decals: number;
  rainDrops: number;
  outlines: boolean;
}

export const PRESETS: Record<PresetId, QualityProfile> = {
  low: {
    shadows: false,
    shadowMapSize: 512,
    shadowRadius: 40,
    pixelRatioCap: 1,
    maxParticles: 900,
    particleScale: 0.45,
    msaa: 0,
    bloom: true,
    bloomStrength: 0.5,
    clouds: 90,
    fogNear: 90,
    fogFar: 600,
    viewDistance: 600,
    debrisChunks: 120,
    decals: 96,
    rainDrops: 600,
    outlines: true,
  },
  medium: {
    shadows: true,
    shadowMapSize: 1024,
    shadowRadius: 45,
    pixelRatioCap: 1.25,
    maxParticles: 1800,
    particleScale: 0.75,
    msaa: 2,
    bloom: true,
    bloomStrength: 0.58,
    clouds: 160,
    fogNear: 130,
    fogFar: 820,
    viewDistance: 900,
    debrisChunks: 240,
    decals: 192,
    rainDrops: 1400,
    outlines: true,
  },
  high: {
    shadows: true,
    shadowMapSize: 2048,
    shadowRadius: 70,
    pixelRatioCap: 1.5,
    maxParticles: 3200,
    particleScale: 1,
    msaa: 4,
    bloom: true,
    bloomStrength: 0.65,
    clouds: 240,
    fogNear: 160,
    fogFar: 1000,
    viewDistance: 1300,
    debrisChunks: 400,
    decals: 256,
    rainDrops: 2400,
    outlines: true,
  },
  ultra: {
    shadows: true,
    shadowMapSize: 4096,
    shadowRadius: 90,
    pixelRatioCap: 2,
    maxParticles: 4800,
    particleScale: 1,
    msaa: 4,
    bloom: true,
    bloomStrength: 0.65,
    clouds: 300,
    fogNear: 180,
    fogFar: 1150,
    viewDistance: 1600,
    debrisChunks: 400,
    decals: 320,
    rainDrops: 3200,
    outlines: true,
  },
};
