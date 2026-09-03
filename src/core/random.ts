/** Small deterministic PRNG used by simulation and replay tests. */
export class SeededRandom {
  private state: number;

  constructor(seed = 0x6d2b79f5) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  snapshot(): number { return this.state; }
}

export const createSeededRandom = (seed?: number) => {
  const random = new SeededRandom(seed);
  return (min: number, max: number) => random.range(min, max);
};
