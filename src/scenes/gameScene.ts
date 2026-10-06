// A top-level scene the App can run (style test, training ground, match).
export interface GameScene {
  /** Once per rendered frame, before the fixed steps (input sampling). */
  frame?(dt: number): void;
  /** Fixed simulation step. */
  update(dt: number): void;
  /** Render with interpolation factor alpha (0..1 between the last two steps). */
  render(alpha: number, frameDt: number): void;
  resize(aspect: number): void;
  dispose(): void;
}
