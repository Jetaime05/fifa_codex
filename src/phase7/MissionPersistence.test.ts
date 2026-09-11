import { describe, expect, it } from "vitest";
import { createPersistentMissions, missionPeriodKeysAt, type MissionStorage } from "./MissionPersistence";

class MemoryStorage implements MissionStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("mission persistence integration", () => {
  it("builds deterministic local day and ISO week keys", () => {
    const timestamp = Date.UTC(2026, 8, 11, 20, 0, 0);
    expect(missionPeriodKeysAt(timestamp, 420)).toEqual({ dayKey: "2026-09-12", weekKey: "2026-W37" });
  });

  it("persists real match progress and rejects a duplicate after reload", () => {
    const storage = new MemoryStorage();
    const timestamp = Date.UTC(2026, 8, 11, 12);
    const event = {
      type: "matchCompleted" as const,
      matchId: "quick-1",
      occurredAt: timestamp,
      outcome: "win" as const,
      modeId: "quick-match",
      goals: 3,
      shots: 7,
      completedPasses: 20,
      tackles: 4
    };
    const first = createPersistentMissions({ storage, key: "missions-test", timestamp, timezoneOffsetMinutes: 420 });
    expect(first.processMatch(event, 420).accepted).toBe(true);
    const reloaded = createPersistentMissions({ storage, key: "missions-test", timestamp, timezoneOffsetMinutes: 420 });
    expect(reloaded.processMatch(event, 420).duplicate).toBe(true);
    expect(reloaded.snapshot.processedMatchIds).toContain("quick-1");
  });
});
