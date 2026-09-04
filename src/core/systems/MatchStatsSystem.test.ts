import { describe, expect, it } from "vitest";
import { MatchStatsSystem, type MatchStatEvent } from "./MatchStatsSystem";

describe("MatchStatsSystem", () => {
  it("keeps independent team totals for all supported events", () => {
    const stats = new MatchStatsSystem();
    const events: MatchStatEvent[] = ["passes", "completedPasses", "shots", "goals", "tackles", "fouls", "yellowCards", "redCards", "corners", "throwIns", "goalKicks", "saves", "clearances"];
    for (const event of events) {
      stats.record("home", event);
      expect(stats.snapshot.home[event]).toBe(1);
      expect(stats.snapshot.away[event]).toBe(0);
    }
  });

  it("computes possession and pass accuracy and ignores loose-ball time", () => {
    const stats = new MatchStatsSystem();
    expect(stats.snapshot.home.possessionPercent).toBe(50);
    stats.addPossession("home", 3);
    stats.addPossession("away", 1);
    stats.addPossession(null, 100);
    stats.record("home", "passes", 4);
    stats.record("home", "completedPasses", 3);
    expect(stats.snapshot.home.possessionPercent).toBe(75);
    expect(stats.snapshot.away.possessionPercent).toBe(25);
    expect(stats.snapshot.home.passAccuracyPercent).toBe(75);
  });

  it("returns detached snapshots, rejects invalid inputs, and resets only explicitly", () => {
    const stats = new MatchStatsSystem();
    stats.record("away", "goals", 2);
    stats.snapshot.away.goals = 100;
    stats.record("home", "passes", NaN);
    stats.record("home", "passes", -1);
    stats.addPossession("home", Infinity);
    expect(stats.snapshot.away.goals).toBe(2);
    expect(stats.snapshot.home.passes).toBe(0);
    expect(stats.snapshot.home.possessionSeconds).toBe(0);
    stats.reset();
    expect(stats.snapshot.away.goals).toBe(0);
  });
});
