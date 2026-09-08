import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVEMENT_CONFIG,
  updatePlayerMovement
} from "./MovementSystem";
import type { SimPlayer } from "./types";

const createPlayer = (overrides: Partial<SimPlayer> = {}): SimPlayer => {
  const body = new THREE.Mesh();
  return {
    id: "home-7",
    team: "home",
    role: "FWD",
    number: 7,
    short: "Vini",
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    home: new THREE.Vector3(),
    hasBall: false,
    stamina: 1,
    cooldown: 0,
    intent: "hold",
    stats: {
      pace: 80,
      shooting: 80,
      passing: 80,
      dribbling: 80,
      defending: 40,
      physical: 70
    },
    mesh: new THREE.Group(),
    body,
    ...overrides
  };
};

const bounds = { halfWidth: 36, halfLength: 56 };

const move = (
  player: SimPlayer,
  inputDirection: THREE.Vector3,
  sprint: boolean,
  dt: number,
  config = {}
) => updatePlayerMovement({
  player,
  inputDirection,
  sprint,
  dt,
  bounds,
  playerRadius: 0.75,
  isControlled: true,
  hasBall: false,
  now: 0,
  config
});

describe("MovementSystem", () => {
  it("ramps speed with acceleration and decelerates when input stops", () => {
    const player = createPlayer();
    const config = { ...DEFAULT_MOVEMENT_CONFIG, acceleration: 10, deceleration: 8, walkSpeedBase: 10, paceSpeedScale: 0 };

    const first = move(player, new THREE.Vector3(0, 0, 1), false, 0.1, config);
    expect(first.speed).toBeCloseTo(1);
    expect(player.position.z).toBeCloseTo(0.1);

    const second = move(player, new THREE.Vector3(0, 0, 1), false, 0.1, config);
    expect(second.speed).toBeCloseTo(2);

    const stopped = move(player, new THREE.Vector3(), false, 0.1, config);
    expect(stopped.speed).toBeCloseTo(1.2);
  });

  it("limits a sharp direction change per simulation step", () => {
    const player = createPlayer({ velocity: new THREE.Vector3(0, 0, 6) });
    const result = move(
      player,
      new THREE.Vector3(1, 0, 0),
      false,
      0.1,
      { ...DEFAULT_MOVEMENT_CONFIG, acceleration: 0, turnRateRadiansPerSecond: 2 }
    );

    expect(result.turnedByRadians).toBeCloseTo(0.2);
    expect(result.braking).toBe(true);
    expect(result.acceleration).toBeLessThan(0);
    expect(Math.atan2(player.velocity.x, player.velocity.z)).toBeCloseTo(0.2);
    // Rotation follows the same shortest path and never snaps to 90°.
    expect(player.mesh.rotation.y).toBeGreaterThan(0);
    expect(player.mesh.rotation.y).toBeLessThan(0.2);
  });

  it("makes sprint faster, drains stamina, and recovers after sprinting", () => {
    const player = createPlayer();
    const sprint = move(player, new THREE.Vector3(0, 0, 1), true, 0.1);
    expect(sprint.sprinting).toBe(true);
    expect(sprint.maxSpeed).toBeGreaterThan(6.2 + player.stats.pace * 0.052);
    expect(player.stamina).toBeCloseTo(1 - DEFAULT_MOVEMENT_CONFIG.sprintStaminaCost * 0.1);

    const beforeRecovery = player.stamina;
    move(player, new THREE.Vector3(), false, 0.1);
    expect(player.stamina).toBeGreaterThan(beforeRecovery);
  });

  it("does not grant a sprint boost to an exhausted player", () => {
    const player = createPlayer({ stamina: 0.05 });
    const result = move(player, new THREE.Vector3(0, 0, 1), true, 0.1);
    expect(result.sprinting).toBe(false);
    expect(result.maxSpeed).toBeLessThan(
      DEFAULT_MOVEMENT_CONFIG.walkSpeedBase + player.stats.pace * DEFAULT_MOVEMENT_CONFIG.paceSpeedScale
    );
  });

  it("reduces the carrying penalty for a better dribbler and clamps to field bounds", () => {
    const low = createPlayer({ stats: { ...createPlayer().stats, dribbling: 10 } });
    const high = createPlayer({ stats: { ...createPlayer().stats, dribbling: 90 } });
    const lowResult = updatePlayerMovement({ player: low, inputDirection: new THREE.Vector3(0, 0, 1), sprint: false, dt: 1, bounds, playerRadius: 0.75, isControlled: true, hasBall: true, now: 0, config: { acceleration: 100 } });
    const highResult = updatePlayerMovement({ player: high, inputDirection: new THREE.Vector3(0, 0, 1), sprint: false, dt: 1, bounds, playerRadius: 0.75, isControlled: true, hasBall: true, now: 0, config: { acceleration: 100 } });

    expect(highResult.maxSpeed).toBeGreaterThan(lowResult.maxSpeed);
    expect(high.position.z).toBeLessThanOrEqual(bounds.halfLength - 0.75);
  });
});
