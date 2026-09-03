import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { selectGoalTarget } from "./TargetSelection";
import {
  calculateShotAccuracy,
  calculateShotPower,
  createShotPlan,
  executeShot
} from "./ShootingSystem";
import type { SimBall, SimPlayer } from "./types";

const player = (
  id: string,
  team: "home" | "away",
  x: number,
  z: number,
  overrides: Partial<SimPlayer> = {}
) => ({
  id,
  team,
  role: "FWD",
  number: 9,
  short: id,
  position: new THREE.Vector3(x, 0, z),
  velocity: new THREE.Vector3(),
  home: new THREE.Vector3(x, 0, z),
  hasBall: false,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: { pace: 80, shooting: 88, passing: 75, dribbling: 80, defending: 40, physical: 75 },
  mesh: new THREE.Group(),
  body: new THREE.Mesh(),
  ...overrides
} as SimPlayer);

const ball = (): SimBall => ({
  position: new THREE.Vector3(0, 0.55, 30),
  velocity: new THREE.Vector3(),
  spin: new THREE.Vector3(),
  mesh: new THREE.Mesh()
});

const goal = { center: new THREE.Vector3(0, 1.8, 56), width: 13.5, height: 3.6 };

describe("ShootingSystem", () => {
  it("makes power shots stronger than finesse and ground passes", () => {
    const power = calculateShotPower(26, 80, "power");
    const finesse = calculateShotPower(26, 80, "finesse");
    expect(power).toBeGreaterThan(finesse);
    expect(finesse).toBeGreaterThan(20);
    expect(power).toBeGreaterThan(36);
  });

  it("reduces accuracy as pressure rises and stats fall", () => {
    const composed = calculateShotAccuracy(18, 90, 0, "power");
    const pressured = calculateShotAccuracy(18, 48, 1, "power");
    expect(composed).toBeGreaterThan(pressured);
    expect(composed).toBeGreaterThan(0.65);
    expect(pressured).toBeLessThan(0.45);
  });

  it("chooses the corner away from a keeper and exposes a feedback contract", () => {
    const shooter = player("home-striker", "home", 4, 30);
    const keeper = player("away-keeper", "away", -4, 55, { role: "GK", position: new THREE.Vector3(-4, 1.8, 55) });
    const selected = selectGoalTarget({ shooter, goal, goalkeeper: keeper });
    const plan = createShotPlan({ shooter, goal, goalkeeper: keeper, ball: ball(), shotType: "finesse", random: () => 0.5 });
    expect(selected.position.x).toBeGreaterThan(0);
    expect(plan?.selectedTarget.side).toBe(selected.side);
    expect(plan?.trajectory.curl).not.toBe(0);
    expect(plan?.feedback.kind).toBe("shot-feedback");
    expect(plan?.feedback.effect).toBe("finesse-release");
  });

  it("writes power and spin into the shared ball contract", () => {
    const shooter = player("home-striker", "home", 0, 30);
    const kicked = ball();
    const plan = executeShot({ shooter, goal, ball: kicked, shotType: "power", random: () => 0.5 });
    expect(plan).not.toBeNull();
    expect(kicked.velocity.length()).toBeGreaterThan(35);
    expect(kicked.spin?.length()).toBeGreaterThan(0);
    expect(kicked.velocity.y).toBeGreaterThan(1);
  });
});

