import { describe, expect, it } from "vitest";
import { createSettingsStore, migrateGameSettings, type SettingsStorage } from "./SettingsStore";

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("Phase 7 settings persistence", () => {
  it("sanitizes legacy and malformed values deterministically", () => {
    expect(migrateGameSettings({
      version: 0,
      difficulty: "impossible",
      matchLength: -5,
      weather: "rain",
      reducedMotion: true,
      volume: 4,
      rules: { offside: true }
    })).toEqual({
      version: 1,
      difficulty: "normal",
      matchLength: 240,
      weather: "rain",
      reducedMotion: true,
      volume: 1,
      rules: { offside: true, advantage: false, injuryTime: false, substitutions: false }
    });
  });

  it("persists settings and reloads them", () => {
    const storage = new MemoryStorage();
    const first = createSettingsStore({ storage, key: "settings-test" });
    first.update({ difficulty: "hard", matchLength: 30, volume: 0.65, rules: { advantage: true } });
    const reloaded = createSettingsStore({ storage, key: "settings-test" });
    expect(reloaded.snapshot.difficulty).toBe("hard");
    expect(reloaded.snapshot.matchLength).toBe(30);
    expect(reloaded.snapshot.volume).toBe(0.65);
    expect(reloaded.snapshot.rules.advantage).toBe(true);
  });

  it("recovers from malformed JSON", () => {
    const storage = new MemoryStorage();
    storage.values.set("broken", "{ nope");
    const store = createSettingsStore({ storage, key: "broken" });
    expect(store.snapshot.version).toBe(1);
    expect(store.diagnostics[0]?.code).toBe("malformed");
  });
});
