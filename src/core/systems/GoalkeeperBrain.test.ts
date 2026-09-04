import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  GoalkeeperSystem,
  isBallApproachingGoal,
  createKeeperBrainSnapshot,
  evaluateKeeperSave,
  evaluateShotDifficulty,
  getGoalkeeperPositioning,
  getKeeperReactionTiming,
  type KeeperShot
} from "./GoalkeeperSystem";
import type { SimBall, SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };

function player(id: string, team: "home" | "away", role: SimPlayer["role"], position: THREE.Vector3, stats = {}): SimPlayer {
  return {
    id, team, role, number: 1, short: id, position: position.clone(), velocity: new THREE.Vector3(),
    home: position.clone(), hasBall: false, stamina: 1, cooldown: 0,
    intent: role === "GK" ? "keeper" : "hold",
    stats: { pace: 60, shooting: 60, passing: 70, dribbling: 60, defending: 84, physical: 80, ...stats },
    mesh: new THREE.Group(), body: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  };
}

function ball(position: THREE.Vector3, velocity = new THREE.Vector3()): SimBall {
  return { position: position.clone(), velocity: velocity.clone(), mesh: new THREE.Mesh(new THREE.SphereGeometry(0.5)) };
}

describe("Phase 3 goalkeeper brain", () => {
  it("does not classify a rebound travelling away from the goal as an incoming shot", () => {
    expect(isBallApproachingGoal(ball(new THREE.Vector3(), new THREE.Vector3(0, 0, -20)), "home")).toBe(true);
    expect(isBallApproachingGoal(ball(new THREE.Vector3(), new THREE.Vector3(0, 0, 20)), "home")).toBe(false);
    expect(isBallApproachingGoal(ball(new THREE.Vector3(), new THREE.Vector3(0, 0, 20)), "away")).toBe(true);
    expect(isBallApproachingGoal(ball(new THREE.Vector3(), new THREE.Vector3(0, 0, -20)), "away")).toBe(false);
    expect(isBallApproachingGoal(ball(new THREE.Vector3()), "away")).toBe(false);
  });
  it("mirrors angle positioning for both ends and anticipates lateral ball motion", () => {
    const home = player("home-gk", "home", "GK", new THREE.Vector3(0, 0, -54));
    const away = player("away-gk", "away", "GK", new THREE.Vector3(0, 0, 54));
    const movingHome = getGoalkeeperPositioning({
      keeper: home, ball: ball(new THREE.Vector3(12, 0.6, 18), new THREE.Vector3(6, 0, 0)), bounds
    });
    const staticHome = getGoalkeeperPositioning({ keeper: home, ball: ball(new THREE.Vector3(12, 0.6, 18)), bounds });
    const mirroredAway = getGoalkeeperPositioning({
      keeper: away, ball: ball(new THREE.Vector3(12, 0.6, -18), new THREE.Vector3(6, 0, 0)), bounds
    });

    expect(movingHome.targetPosition.x).toBeGreaterThan(staticHome.targetPosition.x);
    expect(movingHome.targetPosition.x).toBeCloseTo(mirroredAway.targetPosition.x, 6);
    expect(movingHome.targetPosition.z).toBeCloseTo(-mirroredAway.targetPosition.z, 6);
    expect(movingHome.threat).toBeCloseTo(mirroredAway.threat, 6);
  });

  it("applies recognition delay to screened and deflected close-range shots", () => {
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -53));
    const clear: KeeperShot = {
      origin: new THREE.Vector3(0, 0.7, -47), target: new THREE.Vector3(0, 1.8, -57), power: 42,
      visibility: 1, deflection: 0
    };
    const obscured = { ...clear, visibility: 0, deflection: 1 };
    const clearTiming = getKeeperReactionTiming({ keeper, shot: clear });
    const obscuredTiming = getKeeperReactionTiming({ keeper, shot: obscured });

    expect(obscuredTiming.reactionTime).toBeGreaterThan(clearTiming.reactionTime);
    expect(obscuredTiming.readiness).toBeLessThan(clearTiming.readiness);
    expect(evaluateKeeperSave({ keeper, shot: obscured }).probability)
      .toBeLessThan(evaluateKeeperSave({ keeper, shot: clear }).probability);
  });

  it("explains why an elite corner shot is harder than a weak central shot", () => {
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -53));
    const weak: KeeperShot = {
      origin: new THREE.Vector3(0, 0.7, -25), target: new THREE.Vector3(0, 1.2, -57), power: 17, quality: 0.1
    };
    const hard: KeeperShot = {
      origin: new THREE.Vector3(3, 0.7, -39), target: new THREE.Vector3(-6.2, 4.1, -57),
      power: 48, quality: 0.94, spin: new THREE.Vector3(0, 2, 0)
    };
    const weakDifficulty = evaluateShotDifficulty({ keeper, shot: weak });
    const hardDifficulty = evaluateShotDifficulty({ keeper, shot: hard });

    expect(hardDifficulty.overall).toBeGreaterThan(weakDifficulty.overall);
    expect(hardDifficulty.placement).toBeGreaterThan(weakDifficulty.placement);
    expect(hardDifficulty.curve).toBeGreaterThan(weakDifficulty.curve);
  });

  it("produces distribution timing and JSON-safe keeper telemetry", () => {
    const system = new GoalkeeperSystem();
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -53));
    const outlet = player("rb", "home", "DEF", new THREE.Vector3(12, 0, -36), { passing: 82 });
    const positioning = system.getPositioning({ keeper, ball: ball(new THREE.Vector3(8, 0.6, 2)), bounds });
    const distribution = system.chooseDistribution(keeper, [keeper, outlet]);
    const snapshot = createKeeperBrainSnapshot({ keeper, positioning, distribution });

    expect(distribution.mode).toBe("short");
    expect(distribution.releaseDelay).toBeGreaterThan(0);
    expect(distribution.intentLabel).toContain("rb");
    expect(snapshot.intentLabel).toBe(distribution.intentLabel);
    expect(snapshot.position?.target).toEqual(expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) }));
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects a blocked route even when the receiving teammate is open", () => {
    const system = new GoalkeeperSystem();
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -53));
    const outlet = player("outlet", "home", "DEF", new THREE.Vector3(0, 0, -30));
    const blocker = player("blocker", "away", "FWD", new THREE.Vector3(0, 0, -42));
    const choice = system.chooseDistribution(keeper, [keeper, outlet], [blocker]);
    expect(choice.mode).toBe("clearance");
    expect(choice.reason).toContain("lane is blocked");
    const alternative = player("wide", "home", "DEF", new THREE.Vector3(15, 0, -38));
    expect(system.chooseDistribution(keeper, [keeper, outlet, alternative], [blocker]).target?.id).toBe("wide");
  });
});
