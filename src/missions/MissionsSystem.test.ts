import { describe, expect, it } from "vitest";
import {
  DEFAULT_MISSION_DEFINITIONS,
  MissionsSystem,
  claimMission,
  createMissionState,
  deserializeMissionState,
  ensureMissionPeriods,
  getMissionMetricValue,
  missionClaimId,
  processMissionEvent,
  serializeMissionState
} from "./index";
import type { MatchCompletedEvent, MissionDefinition } from "./index";

const periods = { dayKey: "2026-09-11", weekKey: "2026-W37" };

const event = (overrides: Partial<MatchCompletedEvent> = {}): MatchCompletedEvent => ({
  type: "matchCompleted",
  matchId: "match-1",
  occurredAt: 1_000,
  outcome: "win",
  modeId: "quick-match",
  goals: 2,
  shots: 7,
  completedPasses: 12,
  tackles: 4,
  ...overrides
});

const definitions: readonly MissionDefinition[] = [
  {
    id: "daily-win",
    scope: "daily",
    title: "Win today",
    description: "Win a match today.",
    metric: "wins",
    target: 2,
    reward: { coins: 25, xp: 40 }
  },
  {
    id: "weekly-goals",
    scope: "weekly",
    title: "Score this week",
    description: "Score three goals this week.",
    metric: "goals",
    target: 3,
    reward: { coins: 80, xp: 120 }
  },
  {
    id: "match-shots",
    scope: "match",
    title: "Shoot on sight",
    description: "Take five shots in this match.",
    metric: "shots",
    target: 5,
    reward: { coins: 10, xp: 15 }
  },
  {
    id: "ranked-win",
    scope: "daily",
    title: "Ranked victory",
    description: "Win a ranked match.",
    metric: "wins",
    target: 1,
    reward: { coins: 50, xp: 60 },
    modeId: "ranked"
  },
  {
    id: "draw-objective",
    scope: "weekly",
    title: "Hold your nerve",
    description: "Draw a match.",
    metric: "draws",
    target: 1,
    reward: { coins: 5, xp: 10 },
    outcome: "draw"
  }
];

describe("mission definitions and serializable state", () => {
  it("ships daily, weekly and per-match defaults with coins and xp rewards", () => {
    expect(new Set(DEFAULT_MISSION_DEFINITIONS.map((mission) => mission.scope))).toEqual(
      new Set(["daily", "weekly", "match"])
    );
    expect(DEFAULT_MISSION_DEFINITIONS.every((mission) => mission.reward.coins >= 0 && mission.reward.xp >= 0)).toBe(true);
  });

  it("creates versioned JSON-safe state and restores it without class-only values", () => {
    const system = new MissionsSystem({ definitions, periodKeys: periods });
    system.processEvent(event(), periods);
    const serialized = system.serialize();
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(parsed.dayKey).toBe(periods.dayKey);
    expect(parsed.weekKey).toBe(periods.weekKey);
    expect(deserializeMissionState(serialized)).toEqual(system.state);
    expect(deserializeMissionState("not-json")).toBeNull();
    expect(deserializeMissionState({ version: 99 })).toBeNull();
  });

  it("migrates an unversioned progress-shaped snapshot and deduplicates entries", () => {
    const restored = deserializeMissionState({
      dailyKey: "day-a",
      weeklyKey: "week-a",
      progress: [
        { instanceId: "daily:d:day-a", missionId: "d", scope: "daily", periodKey: "day-a", metric: "wins", target: 1, progress: 1, reward: { coins: 4, xp: 8 }, completed: true },
        { instanceId: "daily:d:day-a", missionId: "d", scope: "daily", periodKey: "day-a", metric: "wins", target: 1, progress: 1, reward: { coins: 99, xp: 99 }, completed: true }
      ],
      processedMatchIds: ["m-1", "m-1", ""]
    });
    expect(restored?.version).toBe(1);
    expect(restored?.dayKey).toBe("day-a");
    expect(restored?.missions).toHaveLength(1);
    expect(restored?.processedMatchIds).toEqual(["m-1"]);
  });

  it("rolls daily and weekly instances deterministically while retaining old history", () => {
    let state = createMissionState(periods);
    state = ensureMissionPeriods(state, definitions, periods);
    const firstIds = state.missions.map((mission) => mission.instanceId);
    state = ensureMissionPeriods(state, definitions, { dayKey: "2026-09-12", weekKey: "2026-W38" });
    expect(state.dayKey).toBe("2026-09-12");
    expect(state.weekKey).toBe("2026-W38");
    expect(state.missions.map((mission) => mission.instanceId)).toEqual([
      ...firstIds,
      "daily:daily-win:2026-09-12",
      "daily:ranked-win:2026-09-12",
      "weekly:weekly-goals:2026-W38",
      "weekly:draw-objective:2026-W38"
    ]);
  });
});

describe("mission event processing", () => {
  it("uses real result/stat fields to update all three scopes", () => {
    const first = processMissionEvent(createMissionState(periods), event(), definitions, periods);
    expect(first.accepted).toBe(true);
    expect(first.processed).toBe(true);
    expect(first.duplicate).toBe(false);
    expect(first.updatedMissionIds).toEqual([
      "daily:daily-win:2026-09-11",
      "weekly:weekly-goals:2026-W37",
      "match:match-shots:match-1"
    ]);
    expect(first.newlyCompletedMissionIds).toEqual(["match:match-shots:match-1"]);
    const daily = first.state.missions.find((mission) => mission.missionId === "daily-win");
    const weekly = first.state.missions.find((mission) => mission.missionId === "weekly-goals");
    const match = first.state.missions.find((mission) => mission.missionId === "match-shots");
    expect(daily?.progress).toBe(1);
    expect(weekly?.progress).toBe(2);
    expect(match?.progress).toBe(5);
    expect(first.state.processedMatchIds).toEqual(["match-1"]);
  });

  it("is idempotent by matchId even if a replay supplies different stats or period keys", () => {
    const first = processMissionEvent(createMissionState(periods), event(), definitions, periods);
    const duplicate = processMissionEvent(first.state, event({ goals: 100, occurredAt: 9_000 }), definitions, {
      dayKey: "another-day",
      weekKey: "another-week"
    });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.processed).toBe(false);
    expect(duplicate.changed).toBe(false);
    expect(duplicate.state).toEqual(first.state);
  });

  it("applies mode and outcome constraints without letting unrelated matches progress", () => {
    const rankedLoss = processMissionEvent(createMissionState(periods), event({ matchId: "ranked-loss", modeId: "ranked", outcome: "loss" }), definitions, periods);
    const ranked = rankedLoss.state.missions.find((mission) => mission.missionId === "ranked-win");
    const draw = rankedLoss.state.missions.find((mission) => mission.missionId === "draw-objective");
    expect(ranked?.progress).toBe(0);
    expect(draw?.progress).toBe(0);

    const drawMatch = processMissionEvent(rankedLoss.state, event({ matchId: "draw-1", modeId: "quick-match", outcome: "draw", goals: 0 }), definitions, periods);
    expect(drawMatch.state.missions.find((mission) => mission.missionId === "draw-objective")?.progress).toBe(1);
    expect(drawMatch.state.missions.find((mission) => mission.missionId === "ranked-win")?.progress).toBe(0);
  });

  it("rejects malformed events without changing state", () => {
    const state = createMissionState(periods);
    const result = processMissionEvent(state, { type: "matchCompleted", matchId: "", occurredAt: NaN, outcome: "win", modeId: "quick-match", goals: 1, shots: 1, completedPasses: 1, tackles: 1 }, definitions, periods);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("invalid-event");
    expect(result.state).toEqual(state);
  });

  it("exposes deterministic metric extraction", () => {
    const match = event({ outcome: "draw", goals: 3, shots: 8, completedPasses: 14, tackles: 2 });
    expect(getMissionMetricValue(match, "matchesPlayed")).toBe(1);
    expect(getMissionMetricValue(match, "draws")).toBe(1);
    expect(getMissionMetricValue(match, "wins")).toBe(0);
    expect(getMissionMetricValue(match, "goals")).toBe(3);
    expect(getMissionMetricValue(match, "shots")).toBe(8);
    expect(getMissionMetricValue(match, "completedPasses")).toBe(14);
    expect(getMissionMetricValue(match, "tackles")).toBe(2);
  });
});

describe("explicit mission claims", () => {
  it("requires completion and returns a stable exactly-once credit transaction", () => {
    const system = new MissionsSystem({ definitions, periodKeys: periods });
    system.startMatch("match-1", periods);
    const before = system.claimMission("match-shots");
    expect(before.status).toBe("notComplete");
    expect(before.claimed).toBe(false);
    expect(before.claimId).toBe("match:match-shots:match-1:claim");
    expect(before.coins).toBe(10);
    expect(before.xp).toBe(15);

    system.processEvent(event(), periods);
    const claimed = system.claimMission("match:match-shots", { claimedAt: 2_000 });
    expect(claimed.status).toBe("claimed");
    expect(claimed.claimed).toBe(true);
    expect(claimed.claimId).toBe(missionClaimId("match:match-shots:match-1"));
    expect(claimed.transactionId).toBe(claimed.claimId);
    expect(claimed.coins).toBe(10);
    expect(claimed.xp).toBe(15);
    expect(claimed.state.missions.find((mission) => mission.matchId === "match-1")?.claimedAt).toBe(2_000);

    const retry = system.claimMission("match:match-shots:match-1", { claimedAt: 3_000 });
    expect(retry.status).toBe("alreadyClaimed");
    expect(retry.claimed).toBe(false);
    expect(retry.alreadyClaimed).toBe(true);
    expect(retry.claimId).toBe(claimed.claimId);
    expect(retry.transactionId).toBe(claimed.transactionId);
    expect(retry.coins).toBe(claimed.coins);
    expect(retry.xp).toBe(claimed.xp);
    expect(retry.state).toEqual(claimed.state);
  });

  it("supports mission-id convenience, unknown ids, and pure claim state", () => {
    const state = processMissionEvent(createMissionState(periods), event(), definitions, periods).state;
    const result = claimMission(state, "match-shots");
    expect(result.status).toBe("claimed");
    expect(result.missionId).toBe("match-shots");
    expect(state.missions.find((mission) => mission.missionId === "match-shots")?.claimed).toBe(false);
    expect(claimMission(result.state, "does-not-exist").status).toBe("notFound");
  });

  it("does not pay an incomplete daily mission and can claim after a later match", () => {
    const system = new MissionsSystem({ definitions, periodKeys: periods });
    system.processEvent(event({ matchId: "first", goals: 0, outcome: "loss" }), periods);
    expect(system.claimMission("daily-win").status).toBe("notComplete");
    system.processEvent(event({ matchId: "second", goals: 1, outcome: "win" }), periods);
    system.processEvent(event({ matchId: "third", goals: 1, outcome: "win" }), periods);
    const claim = system.claimMission("daily-win");
    expect(claim.status).toBe("claimed");
    expect(claim.coins).toBe(25);
    expect(claim.xp).toBe(40);
  });

  it("keeps claims and processed ids through a serialize/restore round trip", () => {
    const first = new MissionsSystem({ definitions, periodKeys: periods });
    first.processEvent(event(), periods);
    const claimed = first.claimMission("match-shots");
    const restored = new MissionsSystem({ definitions, state: serializeMissionState(claimed.state), periodKeys: periods });
    expect(restored.claimMission("match-shots").status).toBe("alreadyClaimed");
    expect(restored.processEvent(event(), periods).duplicate).toBe(true);
    expect(restored.serialize()).toBe(first.serialize());
  });
});
