// Breakwater Launch Port: assembles terrain, districts, HQs, roads and scatter into a MapBuild.
import * as THREE from 'three';
import { Terrain } from '../../terrain';
import { WorldBuilder } from '../../builder';
import { MAP_SIZE, ZONE_DEFS, HQS, SEA_X, WATER_LEVEL, COMBAT_LIMIT, ROADS, ROAD_HALF_WIDTH } from './layout';
import { terrainHeight, terrainColor, terrainSurface } from './terrainFns';
import { buildGantry, buildMoorings, buildCorePlaza, buildSunfield, buildRidgeline, buildHq, buildRoads, buildScatter } from './districts';
import type { MapBuild } from '../mapBuild';

export function buildBreakwater(onProgress?: (f: number, label: string) => void): MapBuild {
  onProgress?.(0.05, 'Generating terrain');
  const terrain = new Terrain({ size: MAP_SIZE, cell: 4, height: terrainHeight, color: terrainColor, surface: terrainSurface, chunkCells: 50 });
  const b = new WorldBuilder();
  onProgress?.(0.3, 'Building districts');
  const rocket = buildGantry(b);
  buildMoorings(b);
  buildCorePlaza(b);
  buildSunfield(b);
  buildRidgeline(b);
  buildHq(b, 0);
  buildHq(b, 1);
  onProgress?.(0.45, 'Laying roads');
  buildRoads(b, (x, z) => terrain.heightAt(x, z));
  buildScatter(b);
  const hq0 = HQS[0];
  return {
    id: 'breakwater',
    terrain,
    builder: b,
    spawn: new THREE.Vector3(hq0.center.x, terrainHeight(hq0.center.x, hq0.center.z) + 0.2, hq0.center.z - 20),
    spawnYaw: 0,
    laneOrigin: new THREE.Vector3(),
    water: WATER_LEVEL,
    seaX: SEA_X,
    zones: ZONE_DEFS,
    hqs: HQS,
    rocket,
    combatLimit: COMBAT_LIMIT,
    roads: ROADS,
    roadWidth: ROAD_HALF_WIDTH * 2,
    skirmish: { center: ZONE_DEFS[2].center.clone(), radius: 105 },
  };
}
