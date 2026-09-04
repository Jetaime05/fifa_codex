import { describe, expect, it } from "vitest";
import { AIDecisionDebugStore, formatAIDecisionLabel, type AIDecisionResult } from "./AIDecisionDebug";

const decision = (playerId: string): AIDecisionResult => ({
  playerId,
  timestampMs: 100,
  difficulty: "normal",
  possession: "self",
  action: "pass",
  score: 0.82,
  scores: [],
  reason: "target is available",
  mistakeApplied: false,
  deferred: false,
  reactionDelayMs: 250,
  executeAtMs: 350,
  cooldownMs: 350,
  nextDecisionAtMs: 700
});

describe("AIDecisionDebug", () => {
  it("formats a compact label that explains intent", () => {
    expect(formatAIDecisionLabel(decision("home-8"))).toContain("home-8: PASS 82% - target is available");
  });

  it("records only while the optional debug store is enabled", () => {
    const store = new AIDecisionDebugStore();
    store.record(decision("b"));
    expect(store.list()).toEqual([]);
    store.enabled = true;
    store.record(decision("b"));
    store.record(decision("a"));
    expect(store.list().map((item) => item.playerId)).toEqual(["a", "b"]);
    expect(store.labels()).toHaveLength(2);
    store.clear();
    expect(store.list()).toEqual([]);
  });
});
