export type FixedTimestepOptions = {
  step?: number;
  maxSteps?: number;
};

/** Accumulates render time and emits stable simulation steps. */
export class FixedTimestep {
  readonly step: number;
  readonly maxSteps: number;
  private accumulator = 0;

  constructor({ step = 1 / 60, maxSteps = 5 }: FixedTimestepOptions = {}) {
    this.step = step;
    this.maxSteps = maxSteps;
  }

  advance(deltaSeconds: number, update: (dt: number) => void): number {
    this.accumulator += Math.max(0, Math.min(deltaSeconds, 0.25));
    let count = 0;
    while (this.accumulator >= this.step && count < this.maxSteps) {
      update(this.step);
      this.accumulator -= this.step;
      count += 1;
    }
    if (count === this.maxSteps) this.accumulator = Math.min(this.accumulator, this.step);
    return count;
  }

  reset() { this.accumulator = 0; }
  get alpha() { return this.accumulator / this.step; }
}
