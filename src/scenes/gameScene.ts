// A top-level scene the App can run (style test, firing range, match).
export interface GameScene {
  update(dt: number): void;
  render(alpha: number): void;
  resize(aspect: number): void;
  dispose(): void;
}
