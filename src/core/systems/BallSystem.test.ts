import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyBallTrajectory, kickBall, updateBallPhysics } from "./BallSystem";
import type { SimBall } from "./types";

const makeBall = (): SimBall => ({
  position: new THREE.Vector3(0, 0.55, 0),
  velocity: new THREE.Vector3(),
  spin: new THREE.Vector3(),
  mesh: new THREE.Mesh()
});

describe("BallSystem trajectory compatibility", () => {
  it("keeps the legacy kick signature and accepts optional spin", () => {
    const ball = makeBall();
    kickBall(ball, new THREE.Vector3(0, 0, 10), 20, 0.2, { curve: 0.8 });
    expect(ball.velocity.z).toBeGreaterThan(19);
    expect(ball.velocity.y).toBeGreaterThan(-1);
    expect(ball.spin?.y).toBe(0.8);
  });

  it("applies a precomputed trajectory without changing the public ball shape", () => {
    const ball = makeBall();
    applyBallTrajectory(ball, new THREE.Vector3(2, 3, 4), new THREE.Vector3(0.2, -0.4, 0));
    expect(ball.velocity.toArray()).toEqual([2, 3, 4]);
    expect(ball.spin?.toArray()).toEqual([0.2, -0.4, 0]);
  });

  it("bends a spinning ball while retaining the old no-spin path", () => {
    const ball = makeBall();
    ball.velocity.set(0, 0, 20);
    ball.spin!.set(0, 1, 0);
    updateBallPhysics({
      ball,
      ballOwner: null,
      dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 },
      ballRadius: 0.55,
      goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(0, 0, 1),
      onGoal: () => undefined
    });
    expect(Math.abs(ball.velocity.x)).toBeGreaterThan(0);
  });
});
