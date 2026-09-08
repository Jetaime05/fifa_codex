import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { calculatePassStrength, createPassPlan, executePass } from "./PassingSystem";
import { updateBallPhysics } from "./BallSystem";
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
  role: "MID",
  number: 8,
  short: id,
  position: new THREE.Vector3(x, 0, z),
  velocity: new THREE.Vector3(),
  home: new THREE.Vector3(x, 0, z),
  hasBall: false,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
  mesh: new THREE.Group(),
  body: new THREE.Mesh(),
  ...overrides
} as SimPlayer);

const ball = (x = 0, z = 0): SimBall => ({
  position: new THREE.Vector3(x, 0.55, z),
  velocity: new THREE.Vector3(),
  spin: new THREE.Vector3(),
  mesh: new THREE.Mesh()
});

describe("PassingSystem", () => {
  it("scales ground-pass speed with distance while respecting the cap", () => {
    const short = calculatePassStrength(4, 70);
    const long = calculatePassStrength(34, 70);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThanOrEqual(14);
    expect(long).toBeLessThanOrEqual(36);
  });

  it("selects a useful forward target and exposes an intercept window", () => {
    const passer = player("home-passer", "home", 0, 0);
    const forward = player("home-forward", "home", 2, 18, { role: "FWD" });
    const safe = player("home-safe", "home", -16, -4);
    const blocker = player("away-blocker", "away", 1, 9);
    const plan = createPassPlan({
      passer,
      teammates: [forward, safe],
      opponents: [blocker],
      ball: ball(),
      assist: 1,
      random: () => 0.5
    });

    expect(plan?.target).toBe(forward);
    expect(plan?.trajectory.style).toBe("ground");
    expect(plan?.trajectory.velocity.y).toBeLessThan(0.5);
    expect(plan?.interception.interceptable).toBe(true);
    expect(plan?.interception.interceptorId).toBe("away-blocker");
    expect(plan?.feedback.kind).toBe("pass-feedback");
  });

  it("uses injected randomness and applies the same plan deterministically", () => {
    const passer = player("home-passer", "home", 0, 0);
    const target = player("home-target", "home", 0, 20);
    const random = () => 0.5;
    const firstBall = ball();
    const secondBall = ball();
    const first = executePass({ passer, teammates: [target], ball: firstBall, random });
    const second = executePass({ passer, teammates: [target], ball: secondBall, random });
    expect(first?.trajectory.velocity.toArray()).toEqual(second?.trajectory.velocity.toArray());
    expect(firstBall.velocity.toArray()).toEqual(secondBall.velocity.toArray());
    expect(firstBall.velocity.y).toBeGreaterThan(0);
  });

  it("gets less assisted and more pressured passes a wider aim error", () => {
    const passer = player("home-passer", "home", 0, 0);
    const target = player("home-target", "home", 0, 16);
    const defender = player("away-defender", "away", 0, 3);
    const clean = createPassPlan({ passer, teammates: [target], ball: ball(), assist: 1, pressure: 0, random: () => 1 });
    const pressured = createPassPlan({ passer, teammates: [target], opponents: [defender], ball: ball(), assist: 0, pressure: 1, random: () => 1 });
    expect(pressured!.trajectory.target.x).not.toBe(clean!.trajectory.target.x);
    expect(pressured!.feedback.pressure).toBe(1);
    expect(pressured!.feedback.effect).toBe("pass-risk");
  });

  it("keeps an unopposed moving-receiver ETA consistent with BallSystem drag", () => {
    const passer = player("home-passer", "home", 0, 0);
    const receiver = player("home-runner", "home", 0, 18, {
      velocity: new THREE.Vector3(0, 0, 2.2), role: "FWD"
    });
    const kicked = ball();
    kicked.position.y = 0.22;
    const plan = createPassPlan({ passer, teammates: [receiver], opponents: [], ball: kicked, assist: 1, random: () => 0.5 });
    expect(plan).not.toBeNull();
    kicked.velocity.copy(plan!.trajectory.velocity);
    const total = plan!.trajectory.travelTime;
    for (let elapsed = 0; elapsed < total; elapsed += 1 / 120) {
      receiver.position.addScaledVector(receiver.velocity, Math.min(1 / 120, total - elapsed));
      updateBallPhysics({
        ball: kicked, ballOwner: null, dt: Math.min(1 / 120, total - elapsed),
        bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.22, goalWidth: 13.5,
        playerForward: () => new THREE.Vector3(0, 0, 1), onGoal: () => undefined
      });
    }
    expect(kicked.position.distanceTo(plan!.trajectory.target)).toBeLessThan(1.5);
    expect(kicked.velocity.length()).toBeLessThan(plan!.strength);
  });
});
