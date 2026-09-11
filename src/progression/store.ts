import {
  applyCardProgress,
  createUpgradeQuote,
  purchaseCardUpgrade
} from "./upgrades";
import { calculateMatchReward } from "./rewards";
import {
  cloneProgressionState,
  createDefaultProgressionState,
  isStableId,
  levelForXp,
  migrateProgressionState,
  normalizeCardProgress,
  normalizeCreditInput
} from "./state";
import type {
  CreditedReward,
  CreateProgressionStoreOptions,
  MatchReward,
  MatchRewardInput,
  ProgressionPersistenceDiagnostic,
  ProgressionState,
  ProgressionStatePatch,
  ProgressionStore,
  ProgressionStoreListener,
  RewardCreditInput,
  RewardCreditResult,
  SettlementOptions,
  SettlementResult,
  SettledMatch,
  StorageLike,
  UpgradeConfirmation,
  UpgradeQuote,
  UpgradeQuoteOptions,
  UpgradeResult
} from "./types";
import { PROGRESSION_STATE_VERSION } from "./types";

/** Kept separate from the existing Phase 6 squad key. */
export const DEFAULT_PROGRESSION_STORAGE_KEY = "elite-kickoff:progression:v1";
export const PROGRESSION_STORAGE_KEY = DEFAULT_PROGRESSION_STORAGE_KEY;

const nonNegativeInteger = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : fallback;

const diagnostic = (
  code: ProgressionPersistenceDiagnostic["code"],
  message: string,
  recoverable = true
): ProgressionPersistenceDiagnostic => ({ code, message, recoverable });

const browserStorage = (): StorageLike | undefined => {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage as unknown as StorageLike;
    }
  } catch {
    // localStorage can throw in privacy mode, SSR, or a blocked iframe.
  }
  return undefined;
};

const samePerformance = (first: MatchReward["performance"], second: MatchReward["performance"]): boolean =>
  first.goals === second.goals &&
  first.shots === second.shots &&
  first.completedPasses === second.completedPasses &&
  first.tackles === second.tackles &&
  first.possessionPercent === second.possessionPercent;

const sameMatchInput = (existing: SettledMatch, reward: MatchReward): boolean =>
  existing.matchId === reward.matchId &&
  existing.modeId === reward.modeId &&
  existing.outcome === reward.outcome &&
  samePerformance(existing.reward.performance, reward.performance);

const settledResult = (
  status: SettlementResult["status"],
  state: ProgressionState,
  reward: MatchReward,
  settledMatch?: SettledMatch,
  conflict = false,
  reason?: SettlementResult["reason"]
): SettlementResult => ({
  status,
  applied: status === "applied",
  alreadySettled: status === "already-settled",
  conflict,
  ...(reason ? { reason } : {}),
  reward,
  ...(settledMatch ? { settledMatch } : {}),
  state: cloneProgressionState(state)
});

/**
 * Pure exactly-once match settlement. Match ids are opaque: only exact string
 * equality is used, so a mode can safely choose UUIDs, seeds, or database ids.
 */
export function settleProgression(
  state: ProgressionState,
  input: MatchRewardInput,
  options: SettlementOptions = {}
): SettlementResult {
  const current = cloneProgressionState(state);
  const reward = calculateMatchReward(input);
  if (!isStableId(input?.matchId)) {
    return settledResult("invalid", current, reward, undefined, false, "invalid-match-id");
  }

  const existing = current.settledMatches[input.matchId];
  if (existing) {
    return settledResult(
      "already-settled",
      current,
      existing.reward,
      existing,
      !sameMatchInput(existing, reward)
    );
  }

  const cardId = isStableId(options.cardId) ? options.cardId : undefined;
  const requestedCardXp = options.cardXp === undefined ? reward.xp : options.cardXp;
  const cardXpAwarded = cardId
    ? nonNegativeInteger(requestedCardXp, reward.xp)
    : undefined;
  current.coins += reward.coins;
  current.totalXp += reward.xp;
  if (cardId && cardXpAwarded !== undefined && cardXpAwarded > 0) {
    const progress = normalizeCardProgress(current.cards[cardId]);
    progress.xp += cardXpAwarded;
    progress.level = levelForXp(progress.xp);
    current.cards[cardId] = progress;
  }
  const settledMatch: SettledMatch = {
    matchId: input.matchId,
    modeId: reward.modeId,
    outcome: reward.outcome,
    reward,
    ...(cardId ? { cardId } : {}),
    ...(cardXpAwarded !== undefined ? { cardXpAwarded } : {})
  };
  current.settledMatches[input.matchId] = settledMatch;
  current.settledMatchIds.push(input.matchId);
  return settledResult("applied", current, reward, settledMatch);
}

export const applyMatchReward = settleProgression;
export const settleMatchReward = settleProgression;

/**
 * Pure idempotent credit path for mission/season/tournament rewards. It is
 * intentionally separate from match settlement because those systems have
 * different stable transaction ids and may retry claims after a reload.
 */
export function creditReward(
  state: ProgressionState,
  input: RewardCreditInput
): RewardCreditResult {
  const current = cloneProgressionState(state);
  const normalized = normalizeCreditInput(input);
  const validAmounts =
    typeof input?.coins === "number" && Number.isFinite(input.coins) && input.coins >= 0 &&
    typeof input?.xp === "number" && Number.isFinite(input.xp) && input.xp >= 0;
  const emptyCredit: CreditedReward = {
    transactionId: normalized.transactionId,
    coins: normalized.coins,
    xp: normalized.xp,
    ...(normalized.source ? { source: normalized.source } : {}),
    ...(normalized.cardId ? { cardId: normalized.cardId } : {})
  };
  if (!isStableId(normalized.transactionId)) {
    return {
      status: "invalid",
      applied: false,
      alreadyCredited: false,
      reason: "invalid-transaction-id",
      credit: emptyCredit,
      state: current
    };
  }
  if (!validAmounts) {
    return {
      status: "invalid",
      applied: false,
      alreadyCredited: false,
      reason: "invalid-reward",
      credit: emptyCredit,
      state: current
    };
  }
  const existing = current.creditedRewards[normalized.transactionId];
  if (existing) {
    return {
      status: "already-credited",
      applied: false,
      alreadyCredited: true,
      credit: existing,
      state: current
    };
  }
  const credit: CreditedReward = emptyCredit;
  current.coins += credit.coins;
  current.totalXp += credit.xp;
  if (credit.cardId && credit.xp > 0) {
    const progress = normalizeCardProgress(current.cards[credit.cardId]);
    progress.xp += credit.xp;
    progress.level = levelForXp(progress.xp);
    current.cards[credit.cardId] = progress;
  }
  current.creditedRewards[credit.transactionId] = credit;
  current.creditedRewardIds.push(credit.transactionId);
  return {
    status: "applied",
    applied: true,
    alreadyCredited: false,
    credit,
    state: current
  };
}

export const creditExternalReward = creditReward;
export const applyRewardCredit = creditReward;

const parseVersion = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const root = raw as Record<string, unknown>;
  if (root.state && typeof root.state === "object" && !Array.isArray(root.state)) {
    return (root.state as Record<string, unknown>).version;
  }
  return root.version;
};

export function createProgressionStore(options: CreateProgressionStoreOptions = {}): ProgressionStore {
  const storage = options.storage ?? browserStorage();
  const key = options.key ?? DEFAULT_PROGRESSION_STORAGE_KEY;
  const diagnostics: ProgressionPersistenceDiagnostic[] = [];
  const listeners = new Set<ProgressionStoreListener>();
  const defaults = { initialCoins: options.initialCoins, initialXp: options.initialXp };
  let current = createDefaultProgressionState(options.initialCoins, options.initialXp);
  let revision = 0;
  let loadedFromStorage = false;

  if (storage) {
    try {
      const rawText = storage.getItem(key);
      if (rawText) {
        try {
          const parsed: unknown = JSON.parse(rawText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            diagnostics.push(diagnostic("malformed", "Progression save was not an object; loaded defaults"));
          } else {
            const version = parseVersion(parsed);
            if (version !== PROGRESSION_STATE_VERSION) {
              diagnostics.push(diagnostic("migration", `Migrated progression save ${String(version ?? "legacy")} to version ${PROGRESSION_STATE_VERSION}`));
            }
            current = migrateProgressionState(parsed, defaults);
            loadedFromStorage = true;
          }
        } catch {
          diagnostics.push(diagnostic("malformed", "Progression save contained invalid JSON; loaded defaults"));
        }
      }
    } catch {
      diagnostics.push(diagnostic("read-failed", "Unable to read progression save; using in-memory defaults"));
    }
  }
  if (!loadedFromStorage && options.initialState !== undefined) {
    const version = parseVersion(options.initialState);
    if (version !== undefined && version !== PROGRESSION_STATE_VERSION) {
      diagnostics.push(diagnostic("migration", `Migrated supplied progression state ${String(version)} to version ${PROGRESSION_STATE_VERSION}`));
    }
    current = migrateProgressionState(options.initialState, defaults);
  }

  const persist = (): void => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(current));
    } catch (error) {
      const text = error && typeof error === "object"
        ? `${String((error as { name?: unknown }).name ?? "")} ${String((error as { message?: unknown }).message ?? "")}`
        : String(error);
      const isQuota = /quota|space|storage/i.test(text);
      diagnostics.push(diagnostic(
        isQuota ? "quota" : "write-failed",
        isQuota ? "Progression save exceeded storage quota" : "Unable to persist progression changes"
      ));
    }
  };

  const commit = (next: ProgressionState): ProgressionState => {
    current = cloneProgressionState(next);
    revision += 1;
    persist();
    const snapshot = cloneProgressionState(current);
    for (const listener of listeners) listener(cloneProgressionState(snapshot), revision);
    return snapshot;
  };

  const unchanged = (before: ProgressionState, after: ProgressionState): boolean =>
    JSON.stringify(before) === JSON.stringify(after);

  const store: ProgressionStore = {
    get snapshot() {
      return cloneProgressionState(current);
    },
    get state() {
      return cloneProgressionState(current);
    },
    get revision() {
      return revision;
    },
    get serialized() {
      return JSON.stringify(current);
    },
    get diagnostics() {
      return diagnostics.map((entry) => ({ ...entry }));
    },
    get persistenceDiagnostics() {
      return diagnostics.map((entry) => ({ ...entry }));
    },
    get diagnosticMessages() {
      return diagnostics.map((entry) => entry.message);
    },
    getDiagnostics() {
      return diagnostics.map((entry) => ({ ...entry }));
    },
    settleMatch(input, options = {}) {
      const transition = settleProgression(current, input, options);
      if (!transition.applied) return { ...transition, state: cloneProgressionState(current) };
      const snapshot = commit(transition.state);
      return {
        ...transition,
        state: snapshot,
        settledMatch: snapshot.settledMatches[input.matchId]
      };
    },
    settle(input, options = {}) {
      return this.settleMatch(input, options);
    },
    creditReward(input) {
      const transition = creditReward(current, input);
      if (!transition.applied) return { ...transition, state: cloneProgressionState(current) };
      return { ...transition, state: commit(transition.state) };
    },
    creditExternalReward(input) {
      return this.creditReward(input);
    },
    awardCardXp(cardId, amount) {
      const before = current;
      const next = cloneProgressionState(current);
      if (!isStableId(cardId)) return cloneProgressionState(current);
      const safeAmount = nonNegativeInteger(amount);
      if (safeAmount <= 0) return cloneProgressionState(current);
      const progress = normalizeCardProgress(next.cards[cardId]);
      progress.xp += safeAmount;
      progress.level = levelForXp(progress.xp);
      next.cards[cardId] = progress;
      if (unchanged(before, next)) return cloneProgressionState(current);
      return commit(next);
    },
    addCardXp(cardId, amount) {
      return this.awardCardXp(cardId, amount);
    },
    getCardProgress(cardId) {
      return normalizeCardProgress(current.cards[cardId]);
    },
    quoteUpgrade(cardId, options = {}, card) {
      return createQuoteForStore(current, cardId, options, card);
    },
    upgradeCard(cardId, confirmation, options = {}, card) {
      const result = purchaseCardUpgrade(current, cardId, confirmation, options, card);
      if (!result.applied) return { ...result, state: cloneProgressionState(current) };
      const snapshot = commit(result.state);
      return {
        ...result,
        state: snapshot,
        progress: normalizeCardProgress(snapshot.cards[cardId]),
        ...(card ? { card: applyCardFromSnapshot(card, snapshot, cardId) } : {})
      };
    },
    purchaseUpgrade(cardId, confirmation, options = {}, card) {
      return this.upgradeCard(cardId, confirmation, options, card);
    },
    update(change) {
      const draft = cloneProgressionState(current);
      const result = typeof change === "function" ? change(draft) : change;
      if (result && typeof result === "object") {
        if (result.coins !== undefined) draft.coins = nonNegativeInteger(result.coins);
        if (result.totalXp !== undefined) draft.totalXp = nonNegativeInteger(result.totalXp);
      }
      return commit(draft);
    },
    reset() {
      return commit(createDefaultProgressionState());
    },
    save() {
      persist();
      return cloneProgressionState(current);
    },
    persist() {
      persist();
      return cloneProgressionState(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  return store;
}

const createQuoteForStore = (
  state: ProgressionState,
  cardId: string,
  options: UpgradeQuoteOptions,
  card?: import("../management/types").PlayerCard
): UpgradeQuote => {
  return createUpgradeQuote(cardId, normalizeCardProgress(state.cards[cardId]), options, card);
};

const applyCardFromSnapshot = (
  card: import("../management/types").PlayerCard,
  state: ProgressionState,
  cardId: string
): import("../management/types").PlayerCard => {
  return applyCardProgress(card, state.cards[cardId]);
};
