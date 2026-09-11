import { describe, expect, it } from "vitest";
import { buildMatchTeamData, calculateCardOverall, createDefaultSquad, homeSquadCards, teamOverall } from "../management/SquadSystem";
import { createSeasonModeStore } from "../modes";
import { applyProgressionToCards, createProgressionStore } from "../progression";
import { createPersistentMissions } from "./MissionPersistence";
import { createSettingsStore } from "./SettingsStore";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("Phase 7 integrated offline loop", () => {
  it("plays, settles once, claims a mission, upgrades a real squad card, and reloads stronger data", () => {
    const storage = new MemoryStorage();
    const progression = createProgressionStore({ storage, key: "phase7-progression", initialCoins: 50 });
    const timestamp = Date.UTC(2026, 8, 11, 12);
    const missions = createPersistentMissions({ storage, key: "phase7-missions", timestamp, timezoneOffsetMinutes: 420 });
    const squad = createDefaultSquad();
    const captainId = squad.captainId ?? Object.values(squad.starters)[0];
    const input = {
      matchId: "quick-acceptance-1",
      modeId: "quick-match",
      outcome: "win" as const,
      performance: { goals: 3, shots: 8, completedPasses: 24, tackles: 5, possessionPercent: 58 }
    };

    missions.startMatch(input.matchId, timestamp, 420);
    const first = progression.settleMatch(input, { cardId: captainId });
    const duplicate = progression.settleMatch(input, { cardId: captainId });
    expect(first.applied).toBe(true);
    expect(duplicate.alreadySettled).toBe(true);
    expect(duplicate.state.coins).toBe(first.state.coins);

    const missionResult = missions.processMatch({
      type: "matchCompleted",
      matchId: input.matchId,
      occurredAt: timestamp,
      outcome: input.outcome,
      modeId: input.modeId,
      goals: input.performance.goals,
      shots: input.performance.shots,
      completedPasses: input.performance.completedPasses,
      tackles: input.performance.tackles
    }, 420);
    expect(missionResult.accepted).toBe(true);
    const claimable = missions.listCurrent().find((mission) => mission.completed && !mission.claimed);
    expect(claimable).toBeDefined();
    const claim = missions.claim(claimable!.instanceId, { claimedAt: timestamp + 1 });
    const repeatClaim = missions.claim(claimable!.instanceId, { claimedAt: timestamp + 2 });
    expect(claim.claimed).toBe(true);
    expect(repeatClaim.alreadyClaimed).toBe(true);
    const credit = progression.creditExternalReward({
      transactionId: claim.transactionId!,
      coins: claim.coins,
      xp: claim.xp,
      source: "mission"
    });
    expect(credit.applied).toBe(true);
    expect(progression.creditExternalReward({
      transactionId: claim.transactionId!, coins: claim.coins, xp: claim.xp, source: "mission"
    }).alreadyCredited).toBe(true);

    const card = homeSquadCards.find((candidate) => candidate.id === captainId)!;
    const beforeCards = applyProgressionToCards(homeSquadCards, progression.snapshot);
    const beforeCard = beforeCards.find((candidate) => candidate.id === card.id)!;
    const beforeOverall = calculateCardOverall(beforeCard, beforeCard.primaryRole);
    const quote = progression.quoteUpgrade(card.id, {}, card);
    const upgrade = progression.upgradeCard(card.id, {
      confirmed: true,
      confirmationToken: quote.confirmationToken,
      expectedCost: quote.cost
    }, {}, card);
    expect(upgrade.applied).toBe(true);
    const afterCards = applyProgressionToCards(homeSquadCards, progression.snapshot);
    const afterCard = afterCards.find((candidate) => candidate.id === card.id)!;
    expect(calculateCardOverall(afterCard, afterCard.primaryRole)).toBeGreaterThan(beforeOverall);
    expect(teamOverall(squad, afterCards)).toBeGreaterThanOrEqual(teamOverall(squad, beforeCards));
    expect(buildMatchTeamData(squad, afterCards).find((player) => player.id === card.id)?.stats)
      .toEqual(afterCard.attributes);

    const reloaded = createProgressionStore({ storage, key: "phase7-progression" });
    expect(reloaded.snapshot.coins).toBe(progression.snapshot.coins);
    expect(reloaded.snapshot.cards[card.id].upgrades).toBe(1);
    expect(createPersistentMissions({ storage, key: "phase7-missions", timestamp, timezoneOffsetMinutes: 420 })
      .snapshot.processedMatchIds).toContain(input.matchId);
  });

  it("completes and persists a real Season with an exactly-once completion reward", () => {
    const storage = new MemoryStorage();
    const season = createSeasonModeStore({ storage, storageKey: "phase7-season" });
    season.startSeason("season", { fixtureCount: 3 });
    while (season.getCurrentFixture()) {
      const fixture = season.getCurrentFixture()!;
      expect(season.recordResult(fixture.matchId, 2, 0).accepted).toBe(true);
    }
    expect(season.snapshot.status).toBe("completed");
    const claim = season.claimCompletionReward();
    expect(claim.claimed).toBe(true);
    expect(season.claimCompletionReward().duplicate).toBe(true);
    const reloaded = createSeasonModeStore({ storage, storageKey: "phase7-season" });
    expect(reloaded.snapshot.status).toBe("completed");
    expect(reloaded.snapshot.completionRewardClaimed).toBe(true);
  });

  it("persists player settings without replacing the existing squad save", () => {
    const storage = new MemoryStorage();
    storage.setItem("elite-kickoff:squad:v2", "{\"version\":2}");
    const settings = createSettingsStore({ storage, key: "phase7-settings" });
    settings.update({ difficulty: "hard", weather: "rain", rules: { offside: true } });
    expect(createSettingsStore({ storage, key: "phase7-settings" }).snapshot.difficulty).toBe("hard");
    expect(storage.getItem("elite-kickoff:squad:v2")).toBe("{\"version\":2}");
  });
});
