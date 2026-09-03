import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  classifySaveZone,
  chooseKeeperDistribution,
  estimateShotQuality,
  getGoalkeeperTargetPosition,
  getKeeperSaveProbability,
  planKeeperReaction,
  resolveKeeperShot
} from "./GoalkeeperSystem";
import type { SimBall, SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };

function player(id: string, team: "home" | "away", role: SimPlayer["role"], position: THREE.Vector3, stats = {}): SimPlayer {
  return {
    id,
    team,
    role,
    number: 1,
    short: id,
    position: position.clone(),
    velocity: new THREE.Vector3(),
    home: position.clone(),
    hasBall: false,
    stamina: 1,
    cooldown: 0,
    intent: role === "GK" ? "keeper" : "hold",
    stats: { pace: 60, shooting: 60, passing: 70, dribbling: 60, defending: 84, physical: 80, ...stats },
    mesh: new THREE.Group(),
    body: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  };
}

function ball(position: THREE.Vector3): SimBall {
  return { position: position.clone(), velocity: new THREE.Vector3(), mesh: new THREE.Mesh(new THREE.SphereGeometry(0.5)) };
}

describe("GoalkeeperSystem", () => {
  it("positions both keepers on the correct side of the goal using the ball angle", () => {
    const homeKeeper = player("home-gk", "home", "GK", new THREE.Vector3(0, 0, -54));
    const awayKeeper = player("away-gk", "away", "GK", new THREE.Vector3(0, 0, 54));
    const targetHome = getGoalkeeperTargetPosition({ keeper: homeKeeper, ball: ball(new THREE.Vector3(20, 0.6, 20)), bounds });
    const targetAway = getGoalkeeperTargetPosition({ keeper: awayKeeper, ball: ball(new THREE.Vector3(20, 0.6, -20)), bounds });

    expect(targetHome.z).toBeGreaterThan(-56);
    expect(targetAway.z).toBeLessThan(56);
    expect(targetHome.x).toBeGreaterThan(0);
    expect(targetAway.x).toBeGreaterThan(0);
    expect(Math.abs(targetHome.x)).toBeLessThanOrEqual(6.05);
  });

  it("classifies central and post zones with vertical readability", () => {
    const origin = new THREE.Vector3(4, 0.6, 20);
    const central = classifySaveZone({ shot: { origin, target: new THREE.Vector3(0, 2.2, 57) } });
    const near = classifySaveZone({ shot: { origin, target: new THREE.Vector3(5.4, 3.8, 57) } });
    const far = classifySaveZone({ shot: { origin, target: new THREE.Vector3(-5.4, 0.7, 57) } });

    expect(central.zone).toBe("central");
    expect(central.horizontal).toBe("center");
    expect(near.zone).toBe("near-post");
    expect(near.vertical).toBe("high");
    expect(far.zone).toBe("far-post");
    expect(far.vertical).toBe("low");
  });

  it("gives weak central shots a materially better save chance than elite corner shots", () => {
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -54));
    const weakCentral = { origin: new THREE.Vector3(0, 0.7, 20), target: new THREE.Vector3(0, 1.8, -57), power: 18, quality: 0.16 };
    const eliteCorner = { origin: new THREE.Vector3(4, 0.7, 20), target: new THREE.Vector3(-6, 3.9, -57), power: 42, quality: 0.9 };

    expect(getKeeperSaveProbability({ keeper, shot: weakCentral })).toBeGreaterThan(getKeeperSaveProbability({ keeper, shot: eliteCorner }));
    expect(estimateShotQuality({ shot: weakCentral })).toBeLessThan(estimateShotQuality({ shot: eliteCorner }));
    expect(planKeeperReaction({ keeper, shot: weakCentral }).action).toBe("claim");
  });

  it("uses one injected deterministic roll for the placeholder save contract", () => {
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -54));
    const shot = { origin: new THREE.Vector3(0, 0.7, 20), target: new THREE.Vector3(0, 1.8, -57), power: 18, quality: 0.16 };

    const saved = resolveKeeperShot({ keeper, shot, random: () => 0 });
    const missed = resolveKeeperShot({ keeper, shot, random: () => 1 });
    expect(saved.saved).toBe(true);
    expect(saved.outcome).toMatch(/save|parry/);
    expect(missed.saved).toBe(false);
    expect(missed.outcome).toBe("goal");
  });

  it("selects a short outlet when a teammate is nearby and clear, otherwise clears", () => {
    const keeper = player("gk", "home", "GK", new THREE.Vector3(0, 0, -54));
    const outlet = player("mid", "home", "MID", new THREE.Vector3(0, 0, -33), { passing: 86 });
    const short = chooseKeeperDistribution({ keeper, teammates: [keeper, outlet], opponents: [] });
    expect(short.mode).toBe("short");
    expect(short.target?.id).toBe("mid");

    const pressure = player("press", "away", "FWD", new THREE.Vector3(0, 0, -34));
    const clearance = chooseKeeperDistribution({ keeper, teammates: [keeper, outlet], opponents: [pressure] });
    expect(clearance.mode).toBe("clearance");
    expect(clearance.target).toBeNull();
  });
});
