import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { cameraRelativeDirection, MatchController } from "./MatchController";

describe("MatchController", () => {
  it("routes normalized actions to gameplay handlers", () => {
    const received: string[] = [];
    const controller = new MatchController({ pass: () => received.push("pass"), pause: () => received.push("pause") });
    controller.dispatch([{ type: "pass" }, { type: "pause" }]);
    expect(received).toEqual(["pass", "pause"]);
  });

  it("keeps WASD aligned with the screen for the sideline camera", () => {
    const forward = new THREE.Vector3(-1, -0.3, 0).normalize();
    const right = cameraRelativeDirection(new THREE.Vector3(1, 0, 0), forward);
    const up = cameraRelativeDirection(new THREE.Vector3(0, 0, 1), forward);
    expect(right.y).toBeCloseTo(0);
    expect(right.dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.99);
    expect(up.dot(forward.clone().setY(0).normalize())).toBeGreaterThan(0.99);
  });
});
