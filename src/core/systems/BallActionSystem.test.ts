import { describe, expect, it } from "vitest";
import { BallActionSystem, getBallActionTiming, isBallActionContactReachable } from "./BallActionSystem";

describe("BallActionSystem", () => {
  it("emits preparation at enqueue, contact at wind-up, and a later recovery", () => {
    const timing = getBallActionTiming("pass");
    expect(timing.prepare).toBe(0);
    expect(timing.contact).toBeCloseTo(0.16 + 0.2);
    expect(timing.recovery).toBeCloseTo(0.16 + 0.2 + 0.2);

    const system = new BallActionSystem();
    const action = system.queue({ ownerId: "home-8", kind: "pass", now: 2 });
    expect(system.advance(2).map((event) => event.phase)).toEqual(["prepare"]);
    expect(system.advance(2 + action.timing.contact).map((event) => event.phase)).toEqual(["contact"]);
    expect(system.advance(2 + action.timing.recovery).map((event) => event.phase)).toEqual(["recovery"]);
    expect(system.activeCount).toBe(0);
  });

  it("orders equal-time phases semantically for a zero-duration contact", () => {
    const system = new BallActionSystem();
    system.queue({
      ownerId: "home-9",
      kind: "touch",
      now: 4,
      timing: { prepare: 0, contact: 0, recovery: 0 }
    });
    expect(system.advance(4).map((event) => event.phase)).toEqual(["prepare", "contact", "recovery"]);
  });

  it("makes replacement cancellation observable to event consumers", () => {
    const system = new BallActionSystem({ maxQueuedPerOwner: 1 });
    const first = system.queue({ ownerId: "home-10", kind: "shot", now: 1 });
    const second = system.queue({ ownerId: "home-10", kind: "pass", now: 1.1 });
    const events = system.advance(1.1);
    expect(events.some((event) => event.action.id === first.id && event.phase === "cancel" && event.reason === "replaced")).toBe(true);
    expect(events.some((event) => event.action.id === second.id && event.phase === "prepare")).toBe(true);
  });

  it("cancels an owner's wind-up at the turnover timestamp", () => {
    const system = new BallActionSystem();
    const action = system.queue({ ownerId: "home-11", kind: "shot", now: 2 });
    expect(system.advance(2).map((event) => event.phase)).toEqual(["prepare"]);
    expect(system.cancelOwner("home-11", "ownership-lost", 2.1)).toEqual([
      expect.objectContaining({ action, phase: "cancel", timestamp: 2.1, reason: "ownership-lost" })
    ]);
    expect(system.advance(20)).toEqual([]);
  });

  it("accepts contact only while the owner remains within physical reach and height", () => {
    const base = {
      ownerId: "home-8",
      currentOwnerId: "home-8",
      ownerPosition: { x: 0, y: 0, z: 0 },
      ballPosition: { x: 1.7, y: 0.22, z: 0 },
      ballRadius: 0.22
    };
    expect(isBallActionContactReachable(base)).toBe(true);
    expect(isBallActionContactReachable({ ...base, currentOwnerId: "away-4" })).toBe(false);
    expect(isBallActionContactReachable({ ...base, ballPosition: { x: 1.71, y: 0.22, z: 0 } })).toBe(false);
    expect(isBallActionContactReachable({ ...base, ballPosition: { x: 0, y: 1.87, z: 0 } })).toBe(true);
    expect(isBallActionContactReachable({ ...base, ballPosition: { x: 0, y: 1.871, z: 0 } })).toBe(false);
  });
});
