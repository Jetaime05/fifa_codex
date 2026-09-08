import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  clampCameraPosition,
  createCameraState,
  getCameraTargets,
  triggerGoalEmphasis,
  updateCamera
} from "./CameraSystem";
import type { SimBall, SimPlayer } from "./types";

function player(position: THREE.Vector3): SimPlayer {
  return {
    id: "home-7",
    team: "home",
    role: "FWD",
    number: 7,
    short: "Player",
    position: position.clone(),
    velocity: new THREE.Vector3(0, 0, 1),
    home: position.clone(),
    hasBall: false,
    stamina: 1,
    cooldown: 0,
    intent: "hold",
    stats: { pace: 80, shooting: 80, passing: 80, dribbling: 80, defending: 50, physical: 70 },
    mesh: new THREE.Group(),
    body: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  };
}

function ball(position: THREE.Vector3): SimBall {
  return { position: position.clone(), velocity: new THREE.Vector3(), mesh: new THREE.Mesh(new THREE.SphereGeometry(0.5)) };
}

const forward = () => new THREE.Vector3(0, 0, 1);

describe("CameraSystem", () => {
  it("clamps framing without mutating the source vector", () => {
    const source = new THREE.Vector3(100, -5, -100);
    const result = clampCameraPosition(source);
    expect(result.x).toBe(84);
    expect(result.y).toBe(5);
    expect(result.z).toBe(-82);
    expect(source.x).toBe(100);
  });

  it("keeps both the ball and active player in the camera focus", () => {
    const active = player(new THREE.Vector3(-8, 0, 12));
    const targets = getCameraTargets("broadcast", ball(new THREE.Vector3(16, 0.6, 38)), active, forward);
    expect(targets.position.y).toBe(31);
    expect(targets.position.x).toBe(58);
    expect(targets.lookAt.x).toBeGreaterThan(active.position.x);
    expect(targets.lookAt.z).toBeGreaterThan(active.position.z);

    const follow = getCameraTargets("follow", ball(new THREE.Vector3(12, 0.6, 28)), active, forward);
    expect(follow.position.y).toBeCloseTo(7.2);
    expect(follow.position.z).toBeLessThan(active.position.z);
    expect(follow.lookAt.distanceTo(ball(new THREE.Vector3(12, 0.6, 28)).position)).toBeLessThan(30);
  });

  it("keeps the broadcast sideline stable when the active player turns", () => {
    const active = player(new THREE.Vector3(0, 0, 12));
    const matchBall = ball(new THREE.Vector3(2, 0.6, 18));
    const first = getCameraTargets("broadcast", matchBall, active, () => new THREE.Vector3(0, 0, 1));
    active.velocity.set(0, 0, -1);
    const reverse = getCameraTargets("broadcast", matchBall, active, () => new THREE.Vector3(0, 0, -1));
    expect(first.position.x).toBe(reverse.position.x);
    expect(first.position.z).toBe(reverse.position.z);
    expect(first.position.distanceTo(reverse.position)).toBe(0);
    expect(first.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it("anticipates bounded ball travel without sending the camera outside framing", () => {
    const active = player(new THREE.Vector3(0, 0, 0));
    const matchBall = ball(new THREE.Vector3(0, 0.6, 0));
    matchBall.velocity.set(0, 0, 120);
    const targets = getCameraTargets("broadcast", matchBall, active, forward);
    expect(targets.lookAt.z).toBeLessThan(15);
    expect(targets.position.toArray().every(Number.isFinite)).toBe(true);
  });

  it("smooths camera movement and exposes goal emphasis as a timed state", () => {
    const camera = new THREE.PerspectiveCamera(53, 1, 0.1, 600);
    const active = player(new THREE.Vector3(0, 0, 0));
    const matchBall = ball(new THREE.Vector3(0, 0.6, 28));
    const state = createCameraState();
    updateCamera(camera, "broadcast", matchBall, active, forward, 1, { state });
    const before = camera.position.clone();
    matchBall.position.z = -45;
    const emphasis = triggerGoalEmphasis(state, { target: new THREE.Vector3(0, 0, -56), duration: 1, strength: 0.8 });
    expect(emphasis.remaining).toBe(1);
    const result = updateCamera(camera, "broadcast", matchBall, active, forward, 0.1, { state });
    expect(result.emphasis).toBeGreaterThan(0);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
    expect(state.remaining).toBeLessThan(1);
    expect(state.remaining).toBeGreaterThan(0);
  });
});
