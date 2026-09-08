import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { applyBallTrajectory, kickBall, updateBallPhysics } from "./BallSystem";
import type { SimBall, SimPlayer } from "./types";
import type { RestartPlan } from "./RestartSystem";

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

  it.each([1, -1])("lets a normal 60 Hz shot cross the open goal mouth (direction %s)", (direction) => {
    const ball = makeBall();
    ball.position.z = 54 * direction;
    ball.velocity.z = 18 * direction;
    let scored: string | null = null;
    for (let frame = 0; frame < 60 && !scored; frame++) {
      updateBallPhysics({ ball, ballOwner: null, dt: 1 / 60,
        bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
        playerForward: () => new THREE.Vector3(0, 0, direction), onGoal: (team) => { scored = team; } });
    }
    expect(scored).toBe(direction === 1 ? "home" : "away");
  });

  it.each([{ x: 10, y: 0.55 }, { x: 0, y: 6 }])("still rebounds outside the goal opening: %o", ({ x, y }) => {
    const ball = makeBall();
    ball.position.set(x, y, 55.4);
    ball.velocity.z = 18;
    let scored = false;
    updateBallPhysics({ ball, ballOwner: null, dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(0, 0, 1), onGoal: () => { scored = true; } });
    expect(scored).toBe(false);
    expect(ball.position.z).toBeCloseTo(55.45);
    expect(ball.velocity.z).toBeLessThan(0);
  });

  it("opts into out-of-play without rebounding and reports the last-touch opponent", () => {
    const ball = makeBall();
    ball.position.x = 36.4;
    ball.velocity.x = 20;
    const restarts: RestartPlan[] = [];
    updateBallPhysics({ ball, ballOwner: null, dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(0, 0, 1), onGoal: () => undefined,
      lastTouchTeam: "away", onOutOfPlay: (restart) => restarts.push(restart) });
    expect(restarts).toHaveLength(1);
    expect(restarts[0]).toMatchObject({ kind: "throwIn", team: "home" });
    expect(ball.velocity.x).toBeGreaterThan(0);
    expect(ball.position.x).toBeGreaterThan(36.55);
  });

  it("detects a carried ball leaving the pitch and attributes the carrier's last touch", () => {
    const ball = makeBall();
    ball.position.x = 36.4;
    const owner = { team: "home", position: new THREE.Vector3(36, 0, 0) } as SimPlayer;
    const restarts: RestartPlan[] = [];
    updateBallPhysics({ ball, ballOwner: owner, dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(1, 0, 0), onGoal: () => undefined,
      lastTouchTeam: "away", onOutOfPlay: (restart) => restarts.push(restart) });
    expect(restarts[0]).toMatchObject({ kind: "throwIn", team: "away" });
  });

  it("lets the caller freeze play after a boundary callback without duplicate restart", () => {
    const ball = makeBall();
    ball.position.set(12, 0.55, 56.4);
    ball.velocity.z = 20;
    let paused = false;
    let count = 0;
    for (let i = 0; i < 10; i++) {
      if (paused) continue;
      updateBallPhysics({ ball, ballOwner: null, dt: 1 / 60,
        bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
        playerForward: () => new THREE.Vector3(0, 0, 1), onGoal: () => undefined,
        lastTouchTeam: "home", onOutOfPlay: () => { paused = true; count++; } });
    }
    expect(paused).toBe(true);
    expect(count).toBe(1);
  });

  it("sweeps a high-speed ball into a post and reflects from the first surface", () => {
    const ball = makeBall();
    ball.position.set(-2, 0.55, 0);
    ball.velocity.set(300, 0, 0);
    const result = updateBallPhysics({
      ball, ballOwner: null, dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(1, 0, 0), onGoal: () => undefined,
      collisionHooks: { posts: [new THREE.Vector3(0, 0.55, 0)], postRadius: 0.14 }
    });
    expect(result.collisions[0]?.kind).toBe("post");
    expect(ball.velocity.x).toBeLessThan(0);
    expect(ball.position.x).toBeLessThan(-0.55);
    expect([...ball.position.toArray(), ...ball.velocity.toArray()].every(Number.isFinite)).toBe(true);
  });

  it("detects a grazing capsule/body contact with the same swept path", () => {
    const ball = makeBall();
    ball.position.set(-2, 0.8, 0.6);
    ball.velocity.set(240, 0, 0);
    const result = updateBallPhysics({
      ball, ballOwner: null, dt: 1 / 60,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.55, goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(1, 0, 0), onGoal: () => undefined,
      collisionHooks: { bodies: [{ id: "away-7", position: new THREE.Vector3(0, 0, 0), radius: 0.42, height: 1.8 }] }
    });
    expect(result.collisions.some((collision) => collision.kind === "body")).toBe(true);
    expect(ball.velocity.x).toBeGreaterThan(0);
    expect(ball.velocity.x).toBeLessThan(240);
    expect(ball.velocity.z).toBeGreaterThan(0);
  });
});
