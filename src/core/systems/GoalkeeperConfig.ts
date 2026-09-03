/**
 * Tuning values for the lightweight goalkeeper model.
 *
 * The simulation owns the random source so replays can inject a seeded
 * function.  The default is deliberately constant rather than Math.random;
 * a caller that wants probabilistic saves should provide its match RNG.
 */
export type GoalkeeperRandom = (min: number, max: number) => number;

export type GoalkeeperConfig = {
  goalWidth: number;
  goalHeight: number;
  goalLineInset: number;
  minAdvance: number;
  maxAdvance: number;
  maxThreatDistance: number;
  lateralMargin: number;
  lateralTracking: number;
  reactionBase: number;
  reactionStatScale: number;
  diveDuration: number;
  claimDistance: number;
  centralSaveBonus: number;
  weakShotBonus: number;
  statWeight: number;
  qualityWeight: number;
  timingWeight: number;
  random: GoalkeeperRandom;
};

const deterministicMidpoint: GoalkeeperRandom = (min, max) => (min + max) * 0.5;

export const DEFAULT_GOALKEEPER_CONFIG: Readonly<GoalkeeperConfig> = Object.freeze({
  goalWidth: 13.5,
  goalHeight: 4.8,
  goalLineInset: 1.8,
  minAdvance: 1.5,
  maxAdvance: 7.5,
  maxThreatDistance: 56,
  lateralMargin: 0.7,
  lateralTracking: 0.18,
  reactionBase: 0.42,
  reactionStatScale: 0.18,
  diveDuration: 0.48,
  claimDistance: 3.8,
  centralSaveBonus: 0.2,
  weakShotBonus: 0.2,
  statWeight: 0.34,
  qualityWeight: 0.32,
  timingWeight: 0.18,
  random: deterministicMidpoint
});

export function resolveGoalkeeperConfig(overrides?: Partial<GoalkeeperConfig>): GoalkeeperConfig {
  return {
    ...DEFAULT_GOALKEEPER_CONFIG,
    ...overrides,
    random: overrides?.random ?? DEFAULT_GOALKEEPER_CONFIG.random
  };
}
