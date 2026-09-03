import { describe, expect, it } from "vitest";
import { addGoal, advanceMatchClock, createInitialMatchState, switchCameraMode } from "./MatchState";

describe("MatchState", () => {
  it("increments match clock and clamps to duration", () => {
    const state = createInitialMatchState(10);
    advanceMatchClock(state, 2.5); advanceMatchClock(state, 20);
    expect(state.elapsed).toBe(10);
  });
  it("updates score after home and away goals", () => {
    const state = createInitialMatchState(90);
    addGoal(state, "home"); addGoal(state, "away");
    expect(state.score).toEqual({ home: 1, away: 1 });
  });
  it("switches camera mode", () => {
    const state = createInitialMatchState(90);
    expect(switchCameraMode(state)).toBe("follow");
    expect(switchCameraMode(state)).toBe("broadcast");
  });
});
