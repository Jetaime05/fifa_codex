import { describe, expect, it } from "vitest";
import { createInitialMatchState } from "../match/MatchState";
import { MatchRuleSystem, isGoalCrossed } from "./MatchRuleSystem";

describe("MatchRuleSystem", () => {
  it("scores a goal only once until restart unlock", () => {
    const rules = new MatchRuleSystem(createInitialMatchState(90));
    expect(rules.scoreGoal("home")).toBe(true);
    expect(rules.scoreGoal("home")).toBe(false);
    rules.resetGoalLock();
    expect(rules.scoreGoal("away")).toBe(true);
  });
  it("builds goal descriptions after the score is incremented", () => {
    const state = createInitialMatchState(90);
    const rules = new MatchRuleSystem(state);
    rules.scoreGoal("home", () => `GOAL ${state.score.home}-${state.score.away}`);
    expect(state.events[0]?.description).toBe("GOAL 1-0");
  });
  it("detects both goal directions and rejects the field boundary", () => {
    expect(isGoalCrossed(57, 0, 1, 56, 13.5)).toBe(true);
    expect(isGoalCrossed(-57, 1, 1, 56, 13.5)).toBe(true);
    expect(isGoalCrossed(57, 8, 1, 56, 13.5)).toBe(false);
  });
});
