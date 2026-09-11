import { describe, expect, it } from "vitest";
import { createMissionState, missionClaimId, type MissionProgress } from "../missions";
import { createIdleSeasonState } from "../modes";
import { createProgressionStore } from "../progression";
import { reconcileExternalRewards } from "./ExternalRewardReconciliation";

describe("external reward reconciliation", () => {
  it("recovers durable claims and remains exactly once on every later startup", () => {
    const progression = createProgressionStore({ initialCoins: 10 });
    const missions = createMissionState({ dayKey: "2026-09-11", weekKey: "2026-W37" });
    const claimed: MissionProgress = {
      instanceId: "daily:2026-09-11:play",
      missionId: "play",
      scope: "daily",
      periodKey: "2026-09-11",
      matchId: null,
      title: "Play",
      description: "Play once",
      metric: "matchesPlayed",
      target: 1,
      progress: 1,
      completed: true,
      claimed: true,
      claimId: missionClaimId("daily:2026-09-11:play"),
      reward: { coins: 50, xp: 40 },
      modeId: null,
      outcome: null,
      lastUpdatedAt: 1,
      completedAt: 1,
      claimedAt: 2
    };
    missions.missions.push(claimed);
    const season = createIdleSeasonState();
    expect(reconcileExternalRewards(progression, missions, season)).toEqual({ applied: 1, alreadyCredited: 0 });
    expect(progression.snapshot.coins).toBe(60);
    expect(reconcileExternalRewards(progression, missions, season)).toEqual({ applied: 0, alreadyCredited: 1 });
    expect(progression.snapshot.coins).toBe(60);
  });
});
