// window.__vf: read-only hooks for the Playwright smoke and soak tests.

export interface TestStats {
  state: string;
  matchTime: number;
  frames: number;
  frameMsMedian: number;
  frameMsP95: number;
  simStepMsMedian: number;
  drawCalls: number;
  soldiers: number;
  aliveSoldiers: number;
  kills: number;
  tickets: [number, number];
  vehiclesUsed: number;
  gadgetsUsed: number;
  stormEvents: number;
  notes: string[];
}

export interface TestHookSource {
  readonly state: string;
  testStats(): TestStats;
  resetTestStats(): void;
}

declare global {
  interface Window {
    __vf?: {
      readonly state: string;
      stats(): TestStats;
      resetStats(): void;
    };
  }
}

export function installTestHooks(src: TestHookSource): void {
  window.__vf = {
    get state() {
      return src.state;
    },
    stats: () => src.testStats(),
    resetStats: () => src.resetTestStats(),
  };
}
