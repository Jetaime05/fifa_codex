import { calculateMatchReward, normalizeMatchPerformance } from "./rewards";
import type {
  CardProgress,
  CreditedReward,
  MatchOutcome,
  MatchPerformance,
  ProgressionState,
  RewardCreditInput,
  SettledMatch
} from "./types";
import { PROGRESSION_STATE_VERSION } from "./types";

export const CARD_XP_PER_LEVEL = 100;
export const MAX_CARD_LEVEL = 30;
export const MAX_CARD_UPGRADES = 25;

export const PLAYER_ATTRIBUTE_KEYS = [
  "pace",
  "shooting",
  "passing",
  "dribbling",
  "defending",
  "physical"
] as const;

type AttributeKey = (typeof PLAYER_ATTRIBUTE_KEYS)[number];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nonNegativeInteger = (value: unknown, fallback = 0): number =>
  Math.max(0, Math.floor(isFiniteNumber(value) ? value : fallback));

const boundedInteger = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.max(min, Math.min(max, Math.floor(isFiniteNumber(value) ? value : fallback)));

export const isStableId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const record = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

export const zeroAttributeBoosts = (): Record<AttributeKey, number> => ({
  pace: 0,
  shooting: 0,
  passing: 0,
  dribbling: 0,
  defending: 0,
  physical: 0
});

export const createEmptyCardProgress = (): CardProgress => ({
  xp: 0,
  level: 1,
  upgrades: 0,
  attributeBoosts: zeroAttributeBoosts()
});

export const levelForXp = (xp: number): number => {
  const safeXp = isFiniteNumber(xp) ? Math.max(0, xp) : 0;
  return Math.max(1, Math.min(MAX_CARD_LEVEL, 1 + Math.floor(safeXp / CARD_XP_PER_LEVEL)));
};

export const normalizeCardProgress = (raw: unknown): CardProgress => {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const xp = nonNegativeInteger(source.xp ?? source.experience ?? source.totalXp);
  const rawBoosts = source.attributeBoosts ?? source.boosts ?? {};
  const boostsSource = rawBoosts && typeof rawBoosts === "object"
    ? rawBoosts as Record<string, unknown>
    : {};
  const attributeBoosts = zeroAttributeBoosts();
  for (const key of PLAYER_ATTRIBUTE_KEYS) {
    attributeBoosts[key] = boundedInteger(boostsSource[key], 0, 100, 0);
  }
  return {
    xp,
    level: levelForXp(xp),
    upgrades: boundedInteger(source.upgrades ?? source.upgradeCount, 0, MAX_CARD_UPGRADES, 0),
    attributeBoosts
  };
};

const clonePerformance = (performance: MatchPerformance): MatchPerformance => ({ ...performance });

const cloneReward = (reward: SettledMatch["reward"]): SettledMatch["reward"] => ({
  ...reward,
  performance: clonePerformance(reward.performance)
});

const cloneCardProgress = (progress: CardProgress): CardProgress => ({
  xp: progress.xp,
  level: progress.level,
  upgrades: progress.upgrades,
  attributeBoosts: { ...progress.attributeBoosts }
});

const cloneSettledMatch = (match: SettledMatch): SettledMatch => ({
  matchId: match.matchId,
  modeId: match.modeId,
  outcome: match.outcome,
  reward: cloneReward(match.reward),
  ...(match.cardId ? { cardId: match.cardId } : {}),
  ...(match.cardXpAwarded !== undefined ? { cardXpAwarded: match.cardXpAwarded } : {})
});

const cloneCreditedReward = (credit: CreditedReward): CreditedReward => ({
  transactionId: credit.transactionId,
  coins: credit.coins,
  xp: credit.xp,
  ...(credit.source ? { source: credit.source } : {}),
  ...(credit.cardId ? { cardId: credit.cardId } : {})
});

/** Deep clone used by store snapshots and pure state transitions. */
export const cloneProgressionState = (state: ProgressionState): ProgressionState => {
  const sourceState = state && typeof state === "object" ? state : createDefaultProgressionState();
  const cards = record<CardProgress>();
  const rawCards = sourceState.cards && typeof sourceState.cards === "object" ? sourceState.cards : {};
  for (const [cardId, progress] of Object.entries(rawCards)) {
    if (isStableId(cardId)) cards[cardId] = cloneCardProgress(progress);
  }
  const settledMatches = record<SettledMatch>();
  const rawMatches = sourceState.settledMatches && typeof sourceState.settledMatches === "object"
    ? sourceState.settledMatches
    : {};
  for (const [matchId, match] of Object.entries(rawMatches)) {
    if (isStableId(matchId)) settledMatches[matchId] = cloneSettledMatch(match);
  }
  const creditedRewards = record<CreditedReward>();
  const rawCredits = sourceState.creditedRewards && typeof sourceState.creditedRewards === "object"
    ? sourceState.creditedRewards
    : {};
  for (const [transactionId, credit] of Object.entries(rawCredits)) {
    if (isStableId(transactionId)) creditedRewards[transactionId] = cloneCreditedReward(credit);
  }
  return {
    version: PROGRESSION_STATE_VERSION,
    coins: nonNegativeInteger(sourceState.coins),
    totalXp: nonNegativeInteger(sourceState.totalXp),
    cards,
    settledMatches,
    settledMatchIds: Array.isArray(sourceState.settledMatchIds)
      ? [...sourceState.settledMatchIds].filter(isStableId)
      : [],
    creditedRewards,
    creditedRewardIds: Array.isArray(sourceState.creditedRewardIds)
      ? [...sourceState.creditedRewardIds].filter(isStableId)
      : []
  };
};

export const createDefaultProgressionState = (initialCoins = 0, initialXp = 0): ProgressionState => ({
  version: PROGRESSION_STATE_VERSION,
  coins: nonNegativeInteger(initialCoins),
  totalXp: nonNegativeInteger(initialXp),
  cards: record<CardProgress>(),
  settledMatches: record<SettledMatch>(),
  settledMatchIds: [],
  creditedRewards: record<CreditedReward>(),
  creditedRewardIds: []
});

const objectSource = (raw: unknown): Record<string, unknown> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const root = raw as Record<string, unknown>;
  if (root.state && typeof root.state === "object" && !Array.isArray(root.state)) {
    return root.state as Record<string, unknown>;
  }
  return root;
};

const normalizeOutcome = (value: unknown): MatchOutcome =>
  value === "win" || value === "draw" || value === "loss" ? value : "loss";

const normalizeModeId = (value: unknown): string => isStableId(value) ? value : "unknown";

const normalizeReward = (
  raw: unknown,
  matchId: string,
  modeId: string,
  outcome: MatchOutcome,
  performance: MatchPerformance
): SettledMatch["reward"] => {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  // Recalculate from the stable input rather than trusting arbitrary stored
  // coin totals. This keeps old/malformed saves safe and deterministic.
  const calculated = calculateMatchReward({ matchId, modeId, outcome, performance });
  const hasRewardShape = isFiniteNumber(source.coins) && isFiniteNumber(source.xp);
  if (!hasRewardShape) return calculated;
  return {
    ...calculated,
    baseCoins: nonNegativeInteger(source.baseCoins, calculated.baseCoins),
    baseXp: nonNegativeInteger(source.baseXp, calculated.baseXp),
    performanceBonus: nonNegativeInteger(source.performanceBonus, calculated.performanceBonus),
    performanceBonusCoins: nonNegativeInteger(source.performanceBonusCoins, calculated.performanceBonusCoins),
    performanceBonusXp: nonNegativeInteger(source.performanceBonusXp, calculated.performanceBonusXp),
    coins: nonNegativeInteger(source.coins),
    xp: nonNegativeInteger(source.xp)
  };
};

const normalizeSettledMatches = (
  source: Record<string, unknown>
): { matches: Record<string, SettledMatch>; ids: string[] } => {
  const matches = record<SettledMatch>();
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (matchId: string, raw: unknown): void => {
    if (!isStableId(matchId) || seen.has(matchId)) return;
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const rewardSource = value.reward && typeof value.reward === "object"
      ? value.reward as Record<string, unknown>
      : value;
    const rawPerformance = rewardSource.performance ?? value.performance;
    const performance = normalizeMatchPerformance(rawPerformance);
    const outcome = normalizeOutcome(rewardSource.outcome ?? value.outcome);
    const modeId = normalizeModeId(rewardSource.modeId ?? value.modeId);
    const reward = normalizeReward(rewardSource, matchId, modeId, outcome, performance);
    const cardId = isStableId(value.cardId) ? value.cardId : undefined;
    const cardXpAwarded = isFiniteNumber(value.cardXpAwarded)
      ? nonNegativeInteger(value.cardXpAwarded)
      : undefined;
    matches[matchId] = {
      matchId,
      modeId,
      outcome,
      reward,
      ...(cardId ? { cardId } : {}),
      ...(cardXpAwarded !== undefined ? { cardXpAwarded } : {})
    };
    seen.add(matchId);
    ids.push(matchId);
  };

  const rawMatches = source.settledMatches ?? source.matches;
  if (Array.isArray(rawMatches)) {
    for (const raw of rawMatches) {
      if (raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        if (isStableId(value.matchId)) add(value.matchId, value);
      }
    }
  } else if (rawMatches && typeof rawMatches === "object") {
    for (const [matchId, raw] of Object.entries(rawMatches)) add(matchId, raw);
  }
  if (Array.isArray(source.settledMatchIds)) {
    // Keep ids from older saves even when a result entry was omitted. An id
    // without result cannot be safely re-rewarded, so it is intentionally not
    // inserted into matches; valid result order remains deterministic above.
    for (const matchId of source.settledMatchIds) {
      if (isStableId(matchId) && !seen.has(matchId)) {
        // There is no reward to return for this orphaned marker. Skipping it
        // is safer than blocking a legitimate future settlement forever.
      }
    }
  }
  return { matches, ids };
};

const normalizeCreditedRewards = (
  source: Record<string, unknown>
): { rewards: Record<string, CreditedReward>; ids: string[] } => {
  const rewards = record<CreditedReward>();
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (transactionId: string, raw: unknown): void => {
    if (!isStableId(transactionId) || seen.has(transactionId)) return;
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const coins = nonNegativeInteger(value.coins);
    const xp = nonNegativeInteger(value.xp);
    const sourceName = isStableId(value.source) ? value.source : undefined;
    const cardId = isStableId(value.cardId) ? value.cardId : undefined;
    rewards[transactionId] = {
      transactionId,
      coins,
      xp,
      ...(sourceName ? { source: sourceName } : {}),
      ...(cardId ? { cardId } : {})
    };
    seen.add(transactionId);
    ids.push(transactionId);
  };
  const rawRewards = source.creditedRewards ?? source.creditedTransactions ?? source.rewardCredits;
  if (Array.isArray(rawRewards)) {
    for (const raw of rawRewards) {
      if (raw && typeof raw === "object") {
        const value = raw as Record<string, unknown>;
        if (isStableId(value.transactionId)) add(value.transactionId, value);
      }
    }
  } else if (rawRewards && typeof rawRewards === "object") {
    for (const [transactionId, raw] of Object.entries(rawRewards)) add(transactionId, raw);
  }
  return { rewards, ids };
};

/**
 * Migrate any historical/plain object into the current JSON-safe schema.
 * Unknown fields are ignored, while valid known records are retained.
 */
export function migrateProgressionState(
  raw: unknown,
  defaults: { initialCoins?: number; initialXp?: number } = {}
): ProgressionState {
  const source = objectSource(raw);
  const fallback = createDefaultProgressionState(defaults.initialCoins, defaults.initialXp);
  // Never reinterpret a save from a newer schema as if it were current. A
  // future app can still migrate the preserved raw save deliberately.
  if (isFiniteNumber(source.version) && source.version > PROGRESSION_STATE_VERSION) {
    return fallback;
  }
  const cards = record<CardProgress>();
  const rawCards = source.cards ?? source.cardProgress ?? source.playerProgress;
  if (rawCards && typeof rawCards === "object" && !Array.isArray(rawCards)) {
    for (const [cardId, rawProgress] of Object.entries(rawCards)) {
      if (isStableId(cardId)) cards[cardId] = normalizeCardProgress(rawProgress);
    }
  }
  const settled = normalizeSettledMatches(source);
  const credited = normalizeCreditedRewards(source);

  return {
    version: PROGRESSION_STATE_VERSION,
    coins: nonNegativeInteger(source.coins, fallback.coins),
    totalXp: nonNegativeInteger(source.totalXp ?? source.xp, fallback.totalXp),
    cards,
    settledMatches: settled.matches,
    settledMatchIds: settled.ids,
    creditedRewards: credited.rewards,
    creditedRewardIds: credited.ids
  };
}

/** Compatibility alias for callers that use normalize rather than migrate. */
export const normalizeProgressionState = migrateProgressionState;

export const createInitialProgressionState = createDefaultProgressionState;

/** Serialize a detached, normalized snapshot for localStorage or a URL. */
export const serializeProgressionState = (state: ProgressionState): string =>
  JSON.stringify(cloneProgressionState(migrateProgressionState(state)));

/** Parse a serialized snapshot without allowing malformed input to escape. */
export function deserializeProgressionState(
  value: unknown,
  defaults: { initialCoins?: number; initialXp?: number } = {}
): ProgressionState {
  if (typeof value === "string") {
    try {
      return migrateProgressionState(JSON.parse(value) as unknown, defaults);
    } catch {
      return createDefaultProgressionState(defaults.initialCoins, defaults.initialXp);
    }
  }
  return migrateProgressionState(value, defaults);
}

export const normalizeCreditInput = (input: RewardCreditInput): RewardCreditInput => ({
  transactionId: typeof input?.transactionId === "string" ? input.transactionId : "",
  coins: nonNegativeInteger(input?.coins),
  xp: nonNegativeInteger(input?.xp),
  ...(isStableId(input?.source) ? { source: input.source } : {}),
  ...(isStableId(input?.cardId) ? { cardId: input.cardId } : {})
});
