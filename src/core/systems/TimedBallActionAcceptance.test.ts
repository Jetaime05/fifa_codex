import { describe, expect, it } from "vitest";
import {
  BallActionSystem,
  isBallActionContactReachable,
  type BallActionContactPoint,
  type BallActionEvent
} from "./BallActionSystem";

const ballRadius = 0.22;
const atGround = (x = 0, z = 0): BallActionContactPoint => ({ x, y: ballRadius, z });

function contactEvents(system: BallActionSystem, now: number) {
  return system.advance(now).filter((event) => event.phase === "contact");
}

describe("TimedBallActionAcceptance", () => {
  it("pauses mid-wind-up without advancing contact or releasing the ball", () => {
    const system = new BallActionSystem();
    const action = system.queue({ ownerId: "home-8", kind: "pass", now: 10 });
    expect(system.advance(10).map((event) => event.phase)).toEqual(["prepare"]);

    const midWindup = action.queuedAt + action.timing.contact / 2;
    expect(contactEvents(system, midWindup)).toEqual([]);

    // A paused match holds its simulation clock. Re-reading the same clock
    // value must not create a duplicate phase or physical release.
    expect(system.advance(midWindup)).toEqual([]);
    expect(system.activeCount).toBe(1);

    expect(contactEvents(system, action.queuedAt + action.timing.contact)).toHaveLength(1);
  });

  it("cancels a stale wind-up on ownership turnover before contact", () => {
    const system = new BallActionSystem();
    const action = system.queue({ ownerId: "home-7", kind: "shot", now: 0 });
    system.advance(0);

    const cancel = system.cancelOwner("home-7", "ownership-lost", 0.1);
    expect(cancel).toEqual([
      expect.objectContaining({ action, phase: "cancel", timestamp: 0.1, reason: "ownership-lost" })
    ]);
    expect(contactEvents(system, action.queuedAt + action.timing.contact + 1)).toEqual([]);
    expect(system.activeCount).toBe(0);
  });

  it.each(["restart", "squad Play"])("clears queued contacts on %s reset", (resetReason) => {
    const system = new BallActionSystem();
    const stale = system.queue({ ownerId: "home-9", kind: "pass", now: 4 });
    system.advance(4);
    const generation = system.generation;
    const resetEvents = system.reset("cancelled", 4.1);

    expect(resetEvents).toEqual([
      expect.objectContaining({ action: stale, phase: "cancel", timestamp: 4.1, reason: "cancelled" })
    ]);
    expect(system.generation).toBe(generation + 1);
    expect(system.activeCount, `${resetReason} should clear active actions`).toBe(0);
    expect(system.advance(stale.queuedAt + stale.timing.recovery + 1)).toEqual([]);

    const next = system.queue({ ownerId: "home-9", kind: "pass", now: 0 });
    expect(next.id).toBe(1);
    expect(system.advance(next.queuedAt).map((event) => event.phase)).toEqual(["prepare"]);
  });

  it("physically releases once at contact and rejects out-of-reach or high contact", () => {
    const system = new BallActionSystem();
    const action = system.queue({
      ownerId: "home-10",
      kind: "pass",
      now: 2,
      timing: { prepare: 0, contact: 0.2, recovery: 0.5 }
    });
    let physicalReleases = 0;
    const accept = (events: BallActionEvent[], currentOwnerId: string | null, ownerPosition: BallActionContactPoint, ballPosition: BallActionContactPoint) => {
      for (const event of events) {
        if (event.phase !== "contact") continue;
        if (isBallActionContactReachable({
          ownerId: event.action.ownerId,
          currentOwnerId,
          ownerPosition,
          ballPosition,
          ballRadius
        })) physicalReleases += 1;
        else system.cancel(event.action.id, "ownership-lost", event.timestamp);
      }
    };

    accept(system.advance(action.queuedAt), "home-10", atGround(), atGround());
    accept(system.advance(action.queuedAt + action.timing.contact - 0.001), "home-10", atGround(), atGround());
    const contact = system.advance(action.queuedAt + action.timing.contact);
    expect(contact.filter((event) => event.phase === "contact")).toHaveLength(1);
    accept(contact, "home-10", atGround(), atGround());
    // Replaying the same simulation timestamp cannot release twice.
    accept(system.advance(action.queuedAt + action.timing.contact), "home-10", atGround(), atGround());
    expect(physicalReleases).toBe(1);

    const distant = system.queue({ ownerId: "home-10", kind: "pass", now: 4, timing: { prepare: 0, contact: 0, recovery: 0.1 } });
    const distantContact = system.advance(distant.queuedAt).filter((event) => event.phase === "contact");
    accept(distantContact, "home-10", atGround(), atGround(1.71));
    expect(physicalReleases).toBe(1);

    const high = system.queue({ ownerId: "home-10", kind: "pass", now: 6, timing: { prepare: 0, contact: 0, recovery: 0.1 } });
    const highContact = system.advance(high.queuedAt).filter((event) => event.phase === "contact");
    accept(highContact, "home-10", atGround(), { x: 0, y: ballRadius + 1.651, z: 0 });
    expect(physicalReleases).toBe(1);
  });
});
