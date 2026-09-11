import { describe, expect, it } from "vitest";
import {
  claimSeasonCompletionReward,
  createSeasonModeStore,
  createSeasonSchedule,
  deserializeSeasonState,
  getCurrentFixture,
  getSeasonRewardEligibility,
  migrateSeasonState,
  recordSeasonResult,
  recordSeasonMatch,
  startNewSeason,
  startSeason,
  type SeasonState,
} from "./SeasonMode";

function completeSeason(initial: SeasonState): SeasonState {
  let state = initial;
  for (const fixture of initial.fixtures) {
    const receipt = recordSeasonResult(state, state.modeId, fixture.matchId, 2, 0);
    expect(receipt.accepted).toBe(true);
    state = receipt.state;
  }
  return state;
}

describe("SeasonMode", () => {
  it("builds the same deterministic schedule for the same string mode id", () => {
    const first = createSeasonSchedule("summer-cup", { fixtureCount: 5 });
    const second = createSeasonSchedule("summer-cup", { fixtureCount: 5 });
    const other = createSeasonSchedule("winter-cup", { fixtureCount: 5 });
    expect(second).toEqual(first);
    expect(other.map((fixture) => fixture.matchId)).not.toEqual(first.map((fixture) => fixture.matchId));
    expect(new Set(first.map((fixture) => fixture.matchId)).size).toBe(5);
    expect(first.every((fixture) => fixture.homeTeamId !== fixture.awayTeamId)).toBe(true);
  });

  it("starts a season with a current fixture and preserves the next fixture after a result", () => {
    const state = startSeason("academy-season", { fixtureCount: 3 });
    expect(state.status).toBe("active");
    expect(state.seasonNumber).toBe(1);
    expect(state.fixtures).toHaveLength(3);
    const first = getCurrentFixture(state);
    expect(first?.matchId).toBe(state.fixtures[0].matchId);
    const receipt = recordSeasonResult(state, "academy-season", state.fixtures[0].matchId, "1", "1");
    expect(receipt.accepted).toBe(true);
    expect(receipt.result).toMatchObject({ homeScore: 1, awayScore: 1, outcome: "draw", points: 1 });
    expect(getCurrentFixture(receipt.state)?.matchId).toBe(state.fixtures[1].matchId);
    expect(receipt.state.standings.find((row) => row.teamId === receipt.state.teamId)?.points).toBe(1);
  });

  it("settles a stable match id exactly once and rejects out-of-order fixtures", () => {
    const state = startSeason("exactly-once", { fixtureCount: 3 });
    const second = recordSeasonResult(state, state.modeId, state.fixtures[1].matchId, 2, 1);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe("fixture-not-current");
    const first = recordSeasonResult(state, state.modeId, state.fixtures[0].matchId, 2, 1);
    const duplicate = recordSeasonResult(first.state, first.state.modeId, first.matchId, 0, 9);
    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.result).toEqual(first.result);
    expect(duplicate.state).toEqual(first.state);
    const viaConvenience = recordSeasonMatch(state, state.fixtures[0].matchId, 2, 1);
    expect(viaConvenience.accepted).toBe(true);
    const viaExplicitMode = recordSeasonMatch(state, state.modeId, state.fixtures[0].matchId, 2, 1);
    expect(viaExplicitMode.accepted).toBe(true);
    const directConvenience = recordSeasonResult(state, state.fixtures[0].matchId, 2, 1);
    expect(directConvenience.accepted).toBe(true);
  });

  it("completes with a deterministic final reward and makes the reward claim idempotent", () => {
    const completed = completeSeason(startSeason("finale", { fixtureCount: 4 }));
    expect(completed.status).toBe("completed");
    expect(completed.completion?.champion).toBe(true);
    expect(completed.completion?.placement).toBe(1);
    expect(completed.completion?.reward).toMatchObject({ coins: 750, xp: 350, reason: "season-complete" });
    const eligible = getSeasonRewardEligibility(completed);
    expect(eligible?.rewardId).toBe(`${completed.seasonId}:completion-reward`);
    const firstClaim = claimSeasonCompletionReward(completed, "finale");
    expect(firstClaim.claimed).toBe(true);
    expect(firstClaim.reward).toEqual(eligible);
    expect(firstClaim.state.completion?.rewardEligible).toBe(false);
    const duplicateClaim = claimSeasonCompletionReward(firstClaim.state, "finale");
    expect(duplicateClaim.claimed).toBe(false);
    expect(duplicateClaim.duplicate).toBe(true);
    expect(duplicateClaim.reward).toEqual(eligible);
    expect(getSeasonRewardEligibility(firstClaim.state)).toBeNull();
  });

  it("increments a new season while keeping the deterministic opponent schedule", () => {
    const first = startSeason("repeatable", { fixtureCount: 4 });
    const next = startNewSeason(first, "repeatable");
    expect(next.seasonNumber).toBe(2);
    expect(next.seasonId).not.toBe(first.seasonId);
    expect(next.fixtures.map((fixture) => fixture.opponentId)).toEqual(first.fixtures.map((fixture) => fixture.opponentId));
    expect(next.fixtures.map((fixture) => fixture.matchId)).not.toEqual(first.fixtures.map((fixture) => fixture.matchId));
    expect(next.fixtures.every((fixture) => fixture.matchId.includes(":2:fixture:"))).toBe(true);
    expect(next.status).toBe("active");
    expect(startNewSeason("fresh-season", { fixtureCount: 2 }).seasonNumber).toBe(1);
  });

  it("migrates malformed and legacy JSON safely, only accepting known fixtures and finite scores", () => {
    const source = startSeason("legacy", { fixtureCount: 2 });
    const migrated = migrateSeasonState({
      version: 0,
      modeId: "legacy",
      fixtureCount: 2,
      results: {
        [source.fixtures[0].matchId]: { homeScore: "2", awayScore: 1 },
        "forged-match": { homeScore: 99, awayScore: 0 },
      },
    });
    expect(migrated.version).toBe(1);
    expect(Object.keys(migrated.results)).toEqual([source.fixtures[0].matchId]);
    expect(migrated.results[source.fixtures[0].matchId]).toMatchObject({ homeScore: 2, awayScore: 1 });
    expect(deserializeSeasonState("{not-json", "fallback").status).toBe("idle");
    expect(deserializeSeasonState(JSON.stringify({ version: 999, modeId: "future", status: "active" }), "fallback").status).toBe("idle");
  });

  it("provides a storage-friendly store with subscriptions and duplicate-safe result calls", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const store = createSeasonModeStore({ modeId: "store-season", storage });
    const revisions: number[] = [];
    store.subscribe(() => revisions.push(store.revision));
    store.startSeason("store-season", { fixtureCount: 2 });
    const fixture = store.getCurrentFixture()!;
    const first = store.recordResult(fixture.matchId, 1, 0);
    const duplicate = store.recordResult(fixture.matchId, 8, 0);
    expect(first.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(store.revision).toBe(2);
    expect(revisions).toEqual([1, 2]);
    expect(values.get("elite-kickoff:season:v1")).toContain("store-season");
    const restored = createSeasonModeStore({ storage, modeId: "store-season" });
    expect(restored.snapshot.results[fixture.matchId].homeScore).toBe(1);
    const detached = store.snapshot;
    detached.results[fixture.matchId].homeScore = 99;
    expect(store.snapshot.results[fixture.matchId].homeScore).toBe(1);
  });
});
