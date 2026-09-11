import type {
  MatchOutcome,
  MatchPerformance,
  MatchReward,
  MatchRewardInput
} from "./types";

/** Baselines intentionally make W/D/L materially different at equal form. */
export const MATCH_OUTCOME_REWARDS: Record<MatchOutcome, { coins: number; xp: number }> = {
  win: { coins: 250, xp: 150 },
  draw: { coins: 160, xp: 100 },
  loss: { coins: 80, xp: 60 }
};

export const MAX_PERFORMANCE_BONUS = 120;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nonNegativeInteger = (value: unknown): number =>
  Math.max(0, Math.floor(isFiniteNumber(value) ? value : 0));

const possession = (value: unknown): number => {
  const numeric = isFiniteNumber(value) ? value : 50;
  return Math.round(Math.max(0, Math.min(100, numeric)) * 10) / 10;
};

const validOutcome = (value: unknown): value is MatchOutcome =>
  value === "win" || value === "draw" || value === "loss";

/**
 * Make telemetry safe at the match boundary. This is deliberately a pure
 * copy: callers can reuse their mutable match-stat object after rewarding.
 */
export function normalizeMatchPerformance(value: unknown): MatchPerformance {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    goals: nonNegativeInteger(source.goals),
    shots: nonNegativeInteger(source.shots),
    completedPasses: nonNegativeInteger(source.completedPasses),
    tackles: nonNegativeInteger(source.tackles),
    possessionPercent: possession(source.possessionPercent)
  };
}

/**
 * Calculate a deterministic match reward. No clock, randomness, or global
 * state is consulted, which makes the preview exactly match settlement.
 */
export function calculateMatchReward(input: MatchRewardInput): MatchReward {
  const performance = normalizeMatchPerformance(input?.performance);
  const outcome: MatchOutcome = validOutcome(input?.outcome) ? input.outcome : "loss";
  const matchId = typeof input?.matchId === "string" ? input.matchId : "";
  const modeId = typeof input?.modeId === "string" ? input.modeId : "unknown";
  const baseline = MATCH_OUTCOME_REWARDS[outcome];

  // Goals and shots reward attacking intent; passes/tackles reward all-round
  // play. Possession is centred on 50%, so either dominant side gets credit
  // for a clear performance without making a draw artificially mandatory.
  const possessionEdge = Math.abs(performance.possessionPercent - 50);
  const performanceScore =
    performance.goals * 18 +
    performance.shots * 2 +
    performance.completedPasses * 0.35 +
    performance.tackles * 2.5 +
    possessionEdge * 0.8;
  const performanceBonus = Math.max(0, Math.min(MAX_PERFORMANCE_BONUS, Math.round(performanceScore)));
  const performanceBonusCoins = Math.round(performanceBonus * 0.85);
  const performanceBonusXp = Math.round(performanceBonus * 0.75);

  return {
    matchId,
    modeId,
    outcome,
    performance,
    baseCoins: baseline.coins,
    baseXp: baseline.xp,
    performanceBonus,
    performanceBonusCoins,
    performanceBonusXp,
    coins: baseline.coins + performanceBonusCoins,
    xp: baseline.xp + performanceBonusXp
  };
}

/** Short alias for callers that use reward as a verb. */
export const calculateReward = calculateMatchReward;
export const getMatchReward = calculateMatchReward;
