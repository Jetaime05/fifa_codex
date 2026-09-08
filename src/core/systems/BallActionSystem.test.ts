import { describe, expect, it } from "vitest";
import { BallActionSystem, getBallActionTiming } from "./BallActionSystem";

describe("BallActionSystem", () => {
  it("emits preparation at enqueue, contact at wind-up, and a later recovery", () => {
    const timing = getBallActionTiming("pass");
    expect(timing.prepare).toBe(0);
    expect(timing.contact).toBeGreaterThan(timing.prepare);
    expect(timing.recovery).toBeGreaterThan(timing.contact);

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
});
