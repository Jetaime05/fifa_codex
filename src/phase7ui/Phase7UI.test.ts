import { describe, expect, it } from "vitest";
import {
  missionProgressPercent,
  normalizePhase7ViewModel,
  reducePhase7UIState,
  seasonAction,
  seasonProgressPercent,
  type Phase7UIState,
} from "./Phase7UI";

describe("Phase7UI view-model helpers", () => {
  it("normalizes root-owned overview, upgrade, mission and season aliases", () => {
    const model = normalizePhase7ViewModel({
      overview: { currency: 1250, experience: 840, teamOvr: 78 },
      season: {
        modeId: "season-alpha",
        status: "active",
        fixtures: [
          { matchId: "m1", played: true, homeTeamName: "Pitch11 FC", awayTeamName: "Northbridge" },
          { matchId: "m2", played: false, homeTeamName: "Harbor", awayTeamName: "Pitch11 FC" },
        ],
        results: { m1: { homeScore: 2, awayScore: 1 } },
        currentFixture: { matchId: "m2", homeTeamName: "Harbor", awayTeamName: "Pitch11 FC" },
      },
      recentReward: { transactionId: "match-1", coins: 240, xp: 170, reason: "win" },
      upgradeChoices: [
        { id: "card-1", name: "Captain", rating: 82, nextOvr: 85, cost: 300, stats: { pace: { current: 80, next: 83 } } },
        { id: "card-1", name: "Duplicate", rating: 1 }
      ],
      objectives: [
        { id: "daily-wins", name: "Win two matches", goal: 2, current: 1, reward: { coins: 100, xp: 50 } },
        { id: "daily-wins", name: "Duplicate", goal: 1, current: 1 }
      ],
    });
    expect(model.coins).toBe(1250);
    expect(model.xp).toBe(840);
    expect(model.teamOverall).toBe(78);
    expect(model.season).toMatchObject({ modeId: "season-alpha", played: 1, total: 2, currentMatchId: "m2", fixtureLabel: "Harbor vs Pitch11 FC" });
    expect(model.lastReward).toMatchObject({ rewardId: "match-1", coins: 240, xp: 170 });
    expect(model.upgrades[0]).toMatchObject({ cardId: "card-1", currentOverall: 82, nextOverall: 85, canAfford: true });
    expect(model.upgrades[0].attributes.pace).toEqual({ current: 80, next: 83 });
    expect(model.missions[0]).toMatchObject({ missionId: "daily-wins", progress: 1, target: 2, claimable: false });
    expect(model.upgrades).toHaveLength(1);
    expect(model.missions).toHaveLength(1);
  });

  it("clamps progress helpers for empty, over-complete and malformed values", () => {
    expect(missionProgressPercent({ progress: 3, target: 2 })).toBe(100);
    expect(missionProgressPercent({ progress: -2, target: 4 })).toBe(0);
    expect(seasonProgressPercent({ played: 1, total: 0 })).toBe(0);
    expect(seasonProgressPercent({ played: 3, total: 4 })).toBe(75);
  });

  it("selects the right season action for the three mode states", () => {
    expect(seasonAction({ status: "idle" })).toBe("start");
    expect(seasonAction({ status: "active" })).toBe("continue");
    expect(seasonAction({ status: "completed" })).toBe("new");
  });

  it("keeps upgrade selection deterministic and toggleable without a DOM", () => {
    const initial: Phase7UIState = { selectedCardId: null };
    const selected = reducePhase7UIState(initial, { type: "select-upgrade", cardId: "card-7" });
    expect(selected).toEqual({ selectedCardId: "card-7" });
    expect(reducePhase7UIState(selected, { type: "select-upgrade", cardId: "card-7" })).toEqual(initial);
    expect(reducePhase7UIState(selected, { type: "clear-selection" })).toEqual(initial);
  });
});
