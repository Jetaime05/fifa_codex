import { describe, expect, it } from "vitest";
import { advanceMatchClock, createInitialMatchState } from "../match/MatchState";
import { MatchFlowSystem } from "./MatchFlowSystem";

function fixture(config: ConstructorParameters<typeof MatchFlowSystem>[1] = {}) {
  const state = createInitialMatchState(10);
  const flow = new MatchFlowSystem(state, { kickoffSeconds: 3, goalSeconds: 2, halftimeSeconds: 4, restartSeconds: 2, ...config });
  return { state, flow };
}

describe("MatchFlowSystem", () => {
  it("counts down kickoff before advancing any playing time", () => {
    const { state, flow } = fixture();
    expect(flow.update(2)).toEqual([]);
    expect(state.elapsed).toBe(0);
    expect(flow.update(1)).toEqual([{ type: "kickoffReady", reason: "start" }]);
    expect(state.status).toBe("playing");
    flow.update(1);
    expect(state.elapsed).toBe(1);
  });

  it("restores a paused countdown instead of starting playing early", () => {
    const { state, flow } = fixture();
    flow.update(1);
    expect(flow.pause()).toBe(true);
    expect(flow.pause()).toBe(false);
    flow.update(100);
    expect(flow.debugSnapshot.countdownSeconds).toBe(2);
    flow.resume();
    expect(state.status).toBe("kickoff");
    expect(flow.update(1)).toEqual([]);
    expect(flow.update(1)).toEqual([{ type: "kickoffReady", reason: "start" }]);
  });

  it("celebrates a goal then sets up and counts down without changing match totals", () => {
    const { state, flow } = fixture();
    flow.update(3);
    flow.update(2);
    state.score.home = 1;
    flow.beginGoal();
    expect(flow.update(2)).toEqual([{ type: "kickoffSetup", reason: "goal" }]);
    expect(state.status).toBe("kickoff");
    expect(flow.update(3)).toEqual([{ type: "kickoffReady", reason: "goal" }]);
    expect(state.elapsed).toBe(2);
    expect(state.score.home).toBe(1);
  });

  it("restores paused dead-ball status and exact remaining timer", () => {
    const { state, flow } = fixture();
    flow.update(3);
    flow.update(1);
    expect(flow.beginRestart()).toBe(true);
    flow.update(0.5);
    flow.pause();
    expect(flow.beginRestart()).toBe(false);
    flow.update(100);
    flow.resume();
    expect(state.status).toBe("restart");
    expect(flow.debugSnapshot.countdownSeconds).toBe(1.5);
    expect(flow.update(1.5)).toEqual([{ type: "restartReady" }]);
    expect(state.elapsed).toBe(1);
    expect(state.status).toBe("playing");
  });

  it("runs halftime once, supports pause during the break, and reaches full time once", () => {
    const { state, flow } = fixture();
    flow.update(3);
    expect(flow.update(100)).toEqual([{ type: "halftime" }]);
    expect(state.elapsed).toBe(5);
    flow.update(1);
    flow.pause();
    flow.update(100);
    flow.resume();
    expect(state.status).toBe("halftime");
    expect(flow.update(3)).toEqual([{ type: "kickoffSetup", reason: "halftime" }]);
    expect(flow.update(3)).toEqual([{ type: "kickoffReady", reason: "halftime" }]);
    expect(flow.update(5)).toEqual([{ type: "fullTime" }]);
    expect(state.elapsed).toBe(10);
    expect(flow.update(5)).toEqual([]);
    expect(flow.beginGoal()).toBe(false);
    expect(flow.beginRestart()).toBe(false);
    expect(flow.pause()).toBe(false);
  });

  it("awards bounded extra playing time in each half without expiring at regulation time", () => {
    const { state, flow } = fixture({ stoppageTimeEnabled: true, maxStoppageSeconds: 4 });
    flow.addStoppageTime(2);
    flow.update(3);
    expect(flow.update(5)).toEqual([]);
    expect(state.status).toBe("playing");
    expect(flow.update(2)).toEqual([{ type: "halftime" }]);
    flow.update(4);
    flow.update(3);
    flow.addStoppageTime(100);
    expect(state.stoppageTime).toBe(4);
    expect(flow.update(3)).toEqual([]);
    expect(state.elapsed).toBe(10);
    expect(state.status).toBe("playing");
    expect(flow.update(4)).toEqual([{ type: "fullTime" }]);
    expect(state.elapsed).toBe(14);
  });

  it("supports optional halftime and stoppage toggles and resets all flow state", () => {
    const { state, flow } = fixture({ halftimeEnabled: false });
    flow.addStoppageTime(2);
    expect(state.stoppageTime).toBe(0);
    flow.setStoppageTimeEnabled(true);
    flow.addStoppageTime(2);
    flow.setStoppageTimeEnabled(false);
    flow.addStoppageTime(2);
    expect(state.stoppageTime).toBe(2);
    flow.update(3);
    expect(flow.update(12)).toEqual([{ type: "fullTime" }]);
    state.score.away = 1;
    flow.reset();
    expect(state.status).toBe("kickoff");
    expect(state.score).toEqual({ home: 0, away: 0 });
    expect(flow.debugSnapshot).toMatchObject({ period: 1, elapsed: 0, stoppageTime: 0, countdownSeconds: 3, resumeStatus: null });
  });

  it("never advances clocks at stoppages or accepts invalid deltas", () => {
    const { state, flow } = fixture();
    for (const status of ["kickoff", "goal", "halftime", "restart", "paused", "fullTime"] as const) {
      state.status = status;
      advanceMatchClock(state, 1);
      expect(state.elapsed).toBe(0);
    }
    flow.reset();
    for (const dt of [-1, NaN, Infinity]) expect(flow.update(dt)).toEqual([]);
    expect(flow.debugSnapshot.countdownSeconds).toBe(3);
  });
});
