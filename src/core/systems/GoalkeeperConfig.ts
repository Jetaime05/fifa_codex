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
  /** Seconds of lateral ball velocity considered while setting the angle. */
  anticipationSeconds: number;
  /** Caps velocity anticipation so a deflection cannot drag the keeper away. */
  maxAnticipationOffset: number;
  /** Extra near-post protection when the ball is in a wide channel. */
  nearPostBias: number;
  /** How strongly close central threats encourage the keeper to step out. */
  angleAdvance: number;
  reactionBase: number;
  reactionStatScale: number;
  minReactionTime: number;
  maxReactionTime: number;
  /** Extra recognition time for obscured/deflected shots. */
  perceptionDelay: number;
  anticipationStatScale: number;
  lateReactionPenalty: number;
  diveDuration: number;
  claimDistance: number;
  baseReach: number;
  reachStatScale: number;
  highShotReachPenalty: number;
  centralSaveBonus: number;
  weakShotBonus: number;
  statWeight: number;
  qualityWeight: number;
  timingWeight: number;
  placementDifficultyWeight: number;
  paceDifficultyWeight: number;
  heightDifficultyWeight: number;
  distanceDifficultyWeight: number;
  curveDifficultyWeight: number;
  distributionPressureRadius: number;
  distributionHoldMin: number;
  distributionHoldMax: number;
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
  anticipationSeconds: 0.16,
  maxAnticipationOffset: 2.4,
  nearPostBias: 0.52,
  angleAdvance: 1.15,
  reactionBase: 0.42,
  reactionStatScale: 0.18,
  minReactionTime: 0.12,
  maxReactionTime: 0.65,
  perceptionDelay: 0.09,
  anticipationStatScale: 0.08,
  lateReactionPenalty: 0.34,
  diveDuration: 0.48,
  claimDistance: 3.8,
  baseReach: 2.25,
  reachStatScale: 2.35,
  highShotReachPenalty: 0.42,
  centralSaveBonus: 0.2,
  weakShotBonus: 0.2,
  statWeight: 0.34,
  qualityWeight: 0.32,
  timingWeight: 0.18,
  placementDifficultyWeight: 0.24,
  paceDifficultyWeight: 0.2,
  heightDifficultyWeight: 0.1,
  distanceDifficultyWeight: 0.08,
  curveDifficultyWeight: 0.1,
  distributionPressureRadius: 16,
  distributionHoldMin: 0.45,
  distributionHoldMax: 1.35,
  random: deterministicMidpoint
});

export function resolveGoalkeeperConfig(overrides?: Partial<GoalkeeperConfig>): GoalkeeperConfig {
  return {
    ...DEFAULT_GOALKEEPER_CONFIG,
    ...overrides,
    random: overrides?.random ?? DEFAULT_GOALKEEPER_CONFIG.random
  };
}
