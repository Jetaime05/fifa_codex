import { describe, expect, it } from "vitest";
import {
  buildMatchTeamData,
  calculateCardOverall,
  chemistry,
  createDefaultSquad,
  createSquadStore,
  formations,
  squadCards,
  teamOverall,
  validateSquad
} from "./SquadSystem";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
};

describe("home squad domain", () => {
  it("ships 18 cards with unique ids and shirt numbers", () => {
    expect(squadCards).toHaveLength(18);
    expect(new Set(squadCards.map((card) => card.id)).size).toBe(18);
    expect(new Set(squadCards.map((card) => card.number)).size).toBe(18);
    expect(squadCards.filter((card) => card.id.startsWith("academy-")).length).toBe(7);
  });

  it("creates and validates a complete default squad", () => {
    const squad = createDefaultSquad();
    expect(Object.keys(squad.starters)).toHaveLength(11);
    expect(squad.bench).toHaveLength(7);
    expect(squad.reserves).toHaveLength(0);
    expect(validateSquad(squad).valid).toBe(true);
    expect(validateSquad(squad).warnings).toHaveLength(0);
  });

  it("keeps the snapshot immutable and emits revisions", () => {
    const store = createSquadStore({ storage: memoryStorage() });
    const snapshot = store.snapshot;
    snapshot.bench.splice(0, 1);
    expect(store.snapshot.bench).toHaveLength(7);
    expect(store.revision).toBe(0);
    store.setTactics({ pressingIntensity: 80 });
    expect(store.snapshot.tactics.pressingIntensity).toBe(80);
    expect(store.revision).toBe(1);
  });

  it("moves, swaps, and changes formations without losing an XI", () => {
    const store = createSquadStore();
    const before = store.snapshot;
    const striker = before.starters.st;
    const reserve = before.bench[0];
    store.move(reserve, "st");
    expect(store.snapshot.starters.st).toBe(reserve);
    expect(store.snapshot.bench).toContain(striker);
    store.swap("gk", "rb");
    expect(store.snapshot.starters.gk).toBe(before.starters.rb);
    store.move(striker, "starter");
    expect(Object.keys(store.snapshot.starters)).toHaveLength(11);
    store.setFormation("4-2-3-1");
    expect(Object.keys(store.snapshot.starters)).toHaveLength(11);
    expect(validateSquad(store.snapshot).valid).toBe(true);
  });

  it("persists safely and migrates a v1 save", () => {
    const storage = memoryStorage();
    const first = createSquadStore({ storage, key: "squad" });
    first.setTactics({ attackWidth: 77 });
    const second = createSquadStore({ storage, key: "squad" });
    expect(second.snapshot.tactics.attackWidth).toBe(77);
    storage.setItem("legacy", JSON.stringify({ version: 1, formation: "4-4-2", starters: [] }));
    const migrated = createSquadStore({ storage, key: "legacy" });
    expect(migrated.snapshot.version).toBe(2);
    expect(migrated.snapshot.formationId).toBe("4-4-2");
    expect(migrated.diagnostics.some((entry) => entry.code === "migration")).toBe(true);
  });

  it("falls back from malformed JSON and reports quota failures without throwing", () => {
    const malformed = memoryStorage();
    malformed.setItem("broken", "{ definitely not json");
    const broken = createSquadStore({ storage: malformed, key: "broken" });
    expect(validateSquad(broken.snapshot).valid).toBe(true);
    expect(broken.diagnostics.some((entry) => entry.code === "malformed")).toBe(true);

    const quota = {
      getItem: () => null,
      setItem: () => { throw { name: "QuotaExceededError", message: "storage quota" }; }
    };
    const store = createSquadStore({ storage: quota });
    expect(() => store.setTactics({ attackWidth: 99 })).not.toThrow();
    expect(store.diagnostics.some((entry) => entry.code === "quota")).toBe(true);
  });

  it("builds eleven renderer players and keeps overall/chemistry bounded", () => {
    const squad = createDefaultSquad();
    const players = buildMatchTeamData(squad);
    expect(players).toHaveLength(11);
    expect(new Set(players.map((player) => player.id)).size).toBe(11);
    expect(new Set(players.map((player) => player.number)).size).toBe(11);
    expect(chemistry(squad)).toBeGreaterThanOrEqual(0);
    expect(chemistry(squad)).toBeLessThanOrEqual(100);
    expect(teamOverall(squad)).toBeGreaterThan(0);
    expect(calculateCardOverall(squadCards[0])).toBeGreaterThan(0);
  });

  it("declares missing goalkeeper and duplicate cards invalid but positions warnings only", () => {
    const squad = createDefaultSquad();
    const gkSlot = squad.starters.gk;
    squad.starters.gk = squad.starters.rb;
    squad.bench.push(gkSlot);
    const result = validateSquad(squad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes("noGK"))).toBe(true);
    const outOfPosition = createDefaultSquad();
    outOfPosition.starters.gk = outOfPosition.starters.st;
    outOfPosition.starters.st = gkSlot;
    const warning = validateSquad(outOfPosition);
    expect(warning.errors.some((error) => error.includes("noGK"))).toBe(false);
    expect(warning.warnings.length).toBeGreaterThan(0);
  });

  it("defines eleven slots for every supported formation", () => {
    expect(Object.values(formations).every((formation) => formation.slots.length === 11)).toBe(true);
  });
});
