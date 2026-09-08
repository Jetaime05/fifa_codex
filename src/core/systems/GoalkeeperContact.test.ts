import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { adjudicateKeeperGoalLine, sweptKeeperContactBeforeGoalPlane } from "./GoalkeeperContact";

describe("GoalkeeperContact", () => {
  const base = {
    keeperCenter: new THREE.Vector3(0, 1.25, 55.1),
    reach: 1.6,
    goalSide: 1,
    wholeBallGoalPlane: 56.22,
    maxContactHeight: 4.8
  };

  it("finds the first swept contact before the whole-ball goal plane", () => {
    const result = sweptKeeperContactBeforeGoalPlane({
      ...base,
      // Start outside the keeper's reach, then cross the swept sphere before
      // the whole-ball line.
      start: new THREE.Vector3(0, 1.25, 53.2),
      end: new THREE.Vector3(0, 1.25, 56.8)
    });
    expect(result).not.toBeNull();
    expect(result!.point.z).toBeLessThan(base.wholeBallGoalPlane);
    expect(result!.time).toBeLessThan(result!.planeTime);
  });

  it("rejects a segment that starts after the plane so it cannot teleport to the keeper", () => {
    const result = sweptKeeperContactBeforeGoalPlane({
      ...base,
      keeperCenter: new THREE.Vector3(0, 1.25, 57),
      reach: 0.4,
      start: new THREE.Vector3(0, 1.25, 56.4),
      end: new THREE.Vector3(0, 1.25, 58)
    });
    expect(result).toBeNull();
  });

  it("rejects contact after the line and contact above the reachable height", () => {
    const afterPlane = sweptKeeperContactBeforeGoalPlane({
      ...base,
      keeperCenter: new THREE.Vector3(0, 1.25, 57),
      reach: 0.4,
      start: new THREE.Vector3(0, 1.25, 54),
      end: new THREE.Vector3(0, 1.25, 58)
    });
    expect(afterPlane).toBeNull();
    // This segment intersects the keeper sphere geometrically, but the
    // contact is above the configured reachable height.
    expect(sweptKeeperContactBeforeGoalPlane({
      ...base,
      start: new THREE.Vector3(0, 2.6, 53.2),
      end: new THREE.Vector3(0, 2.6, 56.8),
      maxContactHeight: 2
    })).toBeNull();
  });

  it("adjudicates a reachable save contact before the whole-ball line", () => {
    const decision = adjudicateKeeperGoalLine({
      ...base,
      start: new THREE.Vector3(0, 1.25, 53.2),
      end: new THREE.Vector3(0, 1.25, 56.8)
    });
    expect(decision.kind).toBe("keeper-contact");
    if (decision.kind === "keeper-contact") {
      expect(decision.contact.point.z).toBeLessThan(base.wholeBallGoalPlane);
      expect(decision.goalPosition.z).toBe(56.8);
    }
  });

  it("adjudicates an out-of-reach trajectory as a goal", () => {
    const decision = adjudicateKeeperGoalLine({
      ...base,
      keeperCenter: new THREE.Vector3(4, 1.25, 55.1),
      start: new THREE.Vector3(0, 1.25, 53.2),
      end: new THREE.Vector3(0, 1.25, 56.8)
    });
    expect(decision).toEqual({ kind: "goal", contact: null, goalPosition: new THREE.Vector3(0, 1.25, 56.8) });
  });

  it("adjudicates an already-past ball as a goal even if the keeper sphere overlaps later", () => {
    const decision = adjudicateKeeperGoalLine({
      ...base,
      keeperCenter: new THREE.Vector3(0, 1.25, 56.8),
      reach: 1.6,
      start: new THREE.Vector3(0, 1.25, 56.4),
      end: new THREE.Vector3(0, 1.25, 57.5)
    });
    expect(decision.kind).toBe("goal");
    expect(decision.contact).toBeNull();
  });
});
