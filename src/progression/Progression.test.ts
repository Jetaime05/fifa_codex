import { describe, expect, it } from "vitest";
import { calculateCardOverall, squadCards } from "../management/SquadSystem";
import {
  calculateMatchReward,
  calculateUpgradeCost,
  createDefaultProgressionState,
  createProgressionStore,
  createUpgradeQuote,
  creditReward,
  getXpToNextLevel,
  migrateProgressionState,
  purchaseCardUpgrade,
  settleProgression,
  type ProgressionState,
  type StorageLike
} from "./index";

const performance = {
  goals: 2,
  shots: 9,
  completedPasses: 84,
  tackles: 7,
  possessionPercent: 58
};

const input = (matchId: string, outcome: "win" | "draw" | "loss" = "win") => ({
  matchId,
  modeId: "quick-match",
  outcome,
  performance
});

const memoryStorage = (): StorageLike & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
};

describe("Phase 7 progression rewards", () => {
  it("calculates deterministic performance bonuses with distinct W/D/L baselines", () => {
    const win = calculateMatchReward(input("m-win", "win"));
    const draw = calculateMatchReward(input("m-draw", "draw"));
    const loss = calculateMatchReward(input("m-loss", "loss"));
    expect(calculateMatchReward(input("m-win", "win"))).toEqual(win);
    expect(win.performanceBonus).toBeGreaterThan(0);
    expect(win.coins).toBeGreaterThan(draw.coins);
    expect(draw.coins).toBeGreaterThan(loss.coins);
    expect(win.xp).toBeGreaterThan(draw.xp);
    expect(draw.xp).toBeGreaterThan(loss.xp);
    expect(win.performance).not.toBe(performance);
  });

  it("sanitizes malformed telemetry without producing NaN or negative rewards", () => {
    const reward = calculateMatchReward({
      matchId: "safe-id",
      modeId: "local",
      outcome: "win",
      performance: {
        goals: Number.NaN,
        shots: -8,
        completedPasses: Number.POSITIVE_INFINITY,
        tackles: 1.9,
        possessionPercent: 120
      }
    });
    expect(reward.performance).toEqual({
      goals: 0,
      shots: 0,
      completedPasses: 0,
      tackles: 1,
      possessionPercent: 100
    });
    expect(Number.isFinite(reward.coins)).toBe(true);
    expect(reward.coins).toBeGreaterThan(0);
  });
});

describe("exactly-once settlement", () => {
  it("credits coins/XP once and remembers the original result on conflicting retries", () => {
    const initial = createDefaultProgressionState();
    const first = settleProgression(initial, input("opaque-match", "win"), { cardId: "card-a" });
    expect(first.status).toBe("applied");
    expect(first.state.coins).toBe(first.reward.coins);
    expect(first.state.totalXp).toBe(first.reward.xp);
    expect(first.state.cards["card-a"].xp).toBe(first.reward.xp);
    expect(first.state.settledMatchIds).toEqual(["opaque-match"]);

    const retry = settleProgression(first.state, input("opaque-match", "loss"), { cardId: "card-a" });
    expect(retry.status).toBe("already-settled");
    expect(retry.conflict).toBe(true);
    expect(retry.reward).toEqual(first.reward);
    expect(retry.state.coins).toBe(first.state.coins);
    expect(retry.state.totalXp).toBe(first.state.totalXp);
    expect(retry.state.cards["card-a"].xp).toBe(first.state.cards["card-a"].xp);
  });

  it("rejects an empty match id without touching state", () => {
    const state = createDefaultProgressionState(99, 4);
    const result = settleProgression(state, input(""));
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("invalid-match-id");
    expect(result.state).toEqual(state);
  });
});

describe("external reward credits", () => {
  it("credits a mission/season transaction exactly once, including optional card XP", () => {
    const state = createDefaultProgressionState();
    const credit = { transactionId: "mission:daily:score", coins: 75, xp: 40, source: "daily", cardId: "card-a" };
    const first = creditReward(state, credit);
    const retry = creditReward(first.state, { ...credit, coins: 9, xp: 1 });
    expect(first.status).toBe("applied");
    expect(first.state.coins).toBe(75);
    expect(first.state.totalXp).toBe(40);
    expect(first.state.cards["card-a"].xp).toBe(40);
    expect(first.state.creditedRewardIds).toEqual(["mission:daily:score"]);
    expect(retry.status).toBe("already-credited");
    expect(retry.credit).toEqual(first.credit);
    expect(retry.state.coins).toBe(75);
  });

  it("rejects negative or non-finite external amounts", () => {
    const state = createDefaultProgressionState();
    const result = creditReward(state, { transactionId: "bad", coins: -1, xp: Number.NaN });
    expect(result.status).toBe("invalid");
    expect(result.reason).toBe("invalid-reward");
    expect(result.state).toEqual(state);
  });
});

describe("card XP and upgrades", () => {
  it("quotes and applies a confirmed upgrade while preserving card immutability", () => {
    const card = squadCards[0];
    const initial = createDefaultProgressionState(500);
    const quotedProgress = initial.cards[card.id] ?? {
      xp: 0,
      level: 1,
      upgrades: 0,
      attributeBoosts: { pace: 0, shooting: 0, passing: 0, dribbling: 0, defending: 0, physical: 0 }
    };
    const quote = createUpgradeQuote(card.id, quotedProgress, { attribute: "passing" }, card);
    expect(quote.cost).toBe(calculateUpgradeCost(0));
    expect(quote.boosts.passing).toBe(1);
    expect(quote.boosts.pace).toBe(0);
    const state = purchaseCardUpgrade(initial, card.id, {
      confirmed: true,
      confirmationToken: quote.confirmationToken,
      expectedCost: quote.cost
    }, { attribute: "passing" }, card);
    expect(state.status).toBe("applied");
    expect(state.state.coins).toBe(500 - quote.cost);
    expect(state.progress.attributeBoosts.passing).toBe(1);
    expect(state.card?.attributes.passing).toBe(card.attributes.passing + 1);
    expect(calculateCardOverall(state.card!)).toBeGreaterThanOrEqual(calculateCardOverall(card));
    expect(card.attributes.passing).toBe(squadCards[0].attributes.passing);
  });

  it("requires confirmation, rejects stale quotes, and handles insufficient funds", () => {
    const card = squadCards[1];
    const initial = createDefaultProgressionState(0);
    const quote = createUpgradeQuote(card.id, { xp: 0, level: 1, upgrades: 0, attributeBoosts: {
      pace: 0, shooting: 0, passing: 0, dribbling: 0, defending: 0, physical: 0
    } });
    const needsConfirmation = purchaseCardUpgrade(initial, card.id, { confirmed: false }, {}, card);
    expect(needsConfirmation.status).toBe("confirmation-required");
    const stale = purchaseCardUpgrade(createDefaultProgressionState(500), card.id, {
      confirmed: true,
      confirmationToken: `${quote.confirmationToken}:stale`
    }, {}, card);
    expect(stale.status).toBe("stale-quote");
    const poor = purchaseCardUpgrade(initial, card.id, { confirmed: true }, {}, card);
    expect(poor.status).toBe("insufficient-funds");
    expect(poor.state.coins).toBe(0);
  });

  it("levels card XP deterministically and reports remaining XP", () => {
    const store = createProgressionStore({ initialCoins: 0 });
    store.awardCardXp("academy-card", 205);
    expect(store.getCardProgress("academy-card")).toMatchObject({ xp: 205, level: 3 });
    expect(getXpToNextLevel(205)).toBe(95);
    const snapshot = store.snapshot;
    snapshot.cards["academy-card"].xp = 0;
    expect(store.getCardProgress("academy-card").xp).toBe(205);
  });
});

describe("progression store persistence", () => {
  it("persists progression in its own key and survives reload", () => {
    const storage = memoryStorage();
    const first = createProgressionStore({ storage, initialCoins: 10 });
    first.settleMatch(input("persisted-match"));
    first.creditReward({ transactionId: "season:1:bonus", coins: 25, xp: 5 });
    const second = createProgressionStore({ storage });
    expect(second.snapshot.coins).toBe(first.snapshot.coins);
    expect(second.snapshot.settledMatchIds).toContain("persisted-match");
    expect(second.snapshot.creditedRewardIds).toContain("season:1:bonus");
    expect(second.creditReward({ transactionId: "season:1:bonus", coins: 999, xp: 999 }).status)
      .toBe("already-credited");
    expect(second.snapshot.coins).toBe(first.snapshot.coins);
    expect(storage.values.has("elite-kickoff:squad:v2")).toBe(false);
  });

  it("migrates legacy aliases and gracefully reports malformed/read/write failures", () => {
    const storage = memoryStorage();
    storage.setItem("legacy", JSON.stringify({
      version: 0,
      coins: 88,
      xp: 12,
      cardProgress: { "card-a": { experience: 100, upgradeCount: 2, boosts: { pace: 3 } } },
      creditedTransactions: [{ transactionId: "legacy-tx", coins: 4, xp: 2 }]
    }));
    const migrated = createProgressionStore({ storage, key: "legacy" });
    expect(migrated.snapshot.version).toBe(1);
    expect(migrated.snapshot.coins).toBe(88);
    expect(migrated.snapshot.cards["card-a"]).toMatchObject({ xp: 100, level: 2, upgrades: 2 });
    expect(migrated.diagnostics.some((entry) => entry.code === "migration")).toBe(true);

    storage.setItem("broken", "not-json");
    const broken = createProgressionStore({ storage, key: "broken" });
    expect(broken.snapshot.coins).toBe(0);
    expect(broken.diagnostics.some((entry) => entry.code === "malformed")).toBe(true);

    const unreadable: StorageLike = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    };
    const inaccessible = createProgressionStore({ storage: unreadable });
    expect(() => inaccessible.settleMatch(input("read-failed"))).not.toThrow();
    expect(inaccessible.diagnostics.some((entry) => entry.code === "read-failed")).toBe(true);
    expect(inaccessible.diagnostics.some((entry) => entry.code === "write-failed")).toBe(true);

    const quota: StorageLike = {
      getItem: () => null,
      setItem: () => { throw { name: "QuotaExceededError", message: "storage quota" }; }
    };
    const quotaStore = createProgressionStore({ storage: quota });
    expect(() => quotaStore.settleMatch(input("quota"))).not.toThrow();
    expect(quotaStore.diagnostics.some((entry) => entry.code === "quota")).toBe(true);
  });

  it("keeps pure migration snapshots isolated", () => {
    const state: ProgressionState = migrateProgressionState({ version: 1, coins: 20 });
    const copy = migrateProgressionState(state);
    copy.coins = 99;
    expect(state.coins).toBe(20);
  });
});
