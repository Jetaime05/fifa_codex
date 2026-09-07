import { describe, expect, it } from "vitest";
import {
  normalizeSquadViewModel,
  positionFits,
  reduceSelection,
  upgradePreview,
  validateSquadView,
  type SelectionState,
} from "./SquadUI";
import { createSquadStore } from "./SquadSystem";

function completeState() {
  const cards = [
    { id: "gk-1", name: "Keeper <script>alert(1)</script>", position: "GK", rating: 84, stats: { diving: 88 } },
    ...Array.from({ length: 4 }, (_, index) => ({ id: `def-${index}`, name: `Defender ${index}`, position: "DEF", rating: 80 + index })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `mid-${index}`, name: `Midfielder ${index}`, position: "MID", rating: 81 + index })),
    ...Array.from({ length: 3 }, (_, index) => ({ id: `fwd-${index}`, name: `Forward ${index}`, position: "FWD", rating: 82 + index })),
  ];
  const assignments: Record<string, string> = {
    gk: "gk-1",
    lb: "def-0",
    lcb: "def-1",
    rcb: "def-2",
    rb: "def-3",
    lm: "mid-0",
    cm: "mid-1",
    rm: "mid-2",
    lw: "fwd-0",
    st: "fwd-1",
    rw: "fwd-2",
  };
  return { cards, formation: { id: "4-3-3", name: "4-3-3 Control", slots: Object.keys(assignments).map((id) => ({ id, position: id === "gk" ? "GK" : id === "lb" || id === "lcb" || id === "rcb" || id === "rb" ? "DEF" : id === "lm" || id === "cm" || id === "rm" ? "MID" : "FWD", cardId: assignments[id] })) }, assignments };
}

describe("SquadUI pure view helpers", () => {
  it("normalizes cards, formations and team metrics without evaluating card names", () => {
    const model = normalizeSquadViewModel(completeState());
    expect(model.cards).toHaveLength(11);
    expect(model.cards[0].name).toContain("<script>");
    expect(model.startingXI).toHaveLength(11);
    expect(model.startingXI.every((slot) => slot.cardId)).toBe(true);
    expect(model.teamOverall).toBeGreaterThan(0);
  });

  it("flags empty and position-mismatched starting XI slots", () => {
    const model = normalizeSquadViewModel({
      cards: [{ id: "striker", name: "Striker", position: "ST", rating: 80 }],
      formation: { id: "4-3-3", slots: [{ id: "gk", label: "GK", position: "GK", cardId: "striker" }] },
    });
    const result = validateSquadView(model);
    expect(result.valid).toBe(false);
    expect(result.warnings.some((warning) => warning.includes("GK"))).toBe(true);
    expect(result.mismatches).toHaveLength(1);
  });

  it("accepts broad position aliases and rejects unrelated roles", () => {
    expect(positionFits("ST", "FWD")).toBe(true);
    expect(positionFits("central midfielder", "MID")).toBe(true);
    expect(positionFits("GK", "DEF")).toBe(false);
  });

  it("keeps selection changes deterministic for desktop and mobile click assignment", () => {
    const initial: SelectionState = { activeTab: "squad", selectedCardId: null, selectedSlotId: null };
    const card = reduceSelection(initial, { type: "card", cardId: "card-1" });
    expect(card).toEqual({ activeTab: "squad", selectedCardId: "card-1", selectedSlotId: null });
    const slot = reduceSelection(card, { type: "slot", slotId: "st" });
    expect(slot).toEqual({ activeTab: "squad", selectedCardId: null, selectedSlotId: "st" });
    expect(reduceSelection(slot, { type: "tab", tab: "tactics" }).activeTab).toBe("tactics");
  });

  it("caps upgrade previews at 99 and labels them as previews", () => {
    expect(upgradePreview(84)).toEqual({ value: 87, label: "84 → 87 OVR preview" });
    expect(upgradePreview(99)).toEqual({ value: 99, label: "99 OVR (capped at 99)" });
  });

  it("reads and writes the announced SquadStore shape", () => {
    const store = createSquadStore({ storage: { getItem: () => null, setItem: () => undefined } });
    const initial = normalizeSquadViewModel(store.snapshot);
    const captainId = store.snapshot.captainId;
    const cornerId = Object.values(store.snapshot.starters)[1];
    expect(initial.startingXI).toHaveLength(11);
    expect(initial.formation.id).toBe("4-3-3");

    store.setTactics({ defensiveLine: 68, pressingIntensity: 74, buildUpSpeed: 61, attackWidth: 43, passingStyle: "direct" });
    store.setPiece("corner", cornerId ?? null);
    const instructionId = Object.values(store.snapshot.starters).find((id) => id !== store.snapshot.starters.gk);
    if (instructionId) store.setTactics({ instructions: { [instructionId]: { role: "getForward" } } });
    const updated = normalizeSquadViewModel(store.snapshot);
    expect(updated.tactics).toMatchObject({ defensiveLine: 68, pressing: 74, buildUp: 61, attackWidth: 43, passingStyle: "direct" });
    expect(updated.cornerTakerId).toBe(cornerId);
    expect(updated.captainId).toBe(captainId);
    expect(instructionId ? updated.tactics.instructions[instructionId] : undefined).toBe("getForward");
  });

  it("keeps secondary positions when a formation remaps a versatile card", () => {
    const store = createSquadStore({ storage: { getItem: () => null, setItem: () => undefined } });
    store.setFormation("4-4-2");
    const model = normalizeSquadViewModel(store.snapshot);
    expect(model.cards.some((card) => card.positions.length > 1)).toBe(true);
    expect(validateSquadView(model).valid).toBe(true);
  });
});
