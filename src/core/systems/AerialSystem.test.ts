import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { SimBall, SimPlayer } from "./types";
import { isAerialBallAirborne, resolveAerialContest, predictAerialArrival } from "./AerialSystem";

function player(id: string, team: "home" | "away", role: SimPlayer["role"], position: THREE.Vector3, physical = 70): SimPlayer {
  return {
    id, team, role, number: Number(id.replace(/\D/g, "")) || 1, short: id,
    position, velocity: new THREE.Vector3(), home: position.clone(), hasBall: false,
    stamina: 1, cooldown: 0, intent: role === "GK" ? "keeper" : "hold",
    stats: { pace: 75, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical },
    mesh: new THREE.Group(), body: new THREE.Mesh()
  };
}

function ball(position: THREE.Vector3, velocity: THREE.Vector3): SimBall {
  return { position, velocity, mesh: new THREE.Mesh() };
}

describe("AerialSystem", () => {
  it("predicts one descending contact crossing near a target", () => {
    const result = predictAerialArrival({
      ball: ball(new THREE.Vector3(0, 3, 0), new THREE.Vector3(8, 2, 12)),
      target: new THREE.Vector3(4, 0, 6), contactHeight: 1.28, gravity: 12.5
    });
    expect(result).not.toBeNull();
    expect(result!.point.y).toBeCloseTo(1.28);
    expect(result!.time).toBeGreaterThan(0);
    expect(result!.descending).toBe(true);
  });

  it("resolves a deterministic attacking header and emits a physical outgoing velocity", () => {
    const result = resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 2.1, 4), new THREE.Vector3(0, -1.2, 9)),
      attackingTeam: "home",
      players: [player("home-9", "home", "FWD", new THREE.Vector3(0, 0, 4))],
      goalTarget: new THREE.Vector3(0, 1.8, 56)
    });
    expect(result?.action).toBe("header");
    expect(result?.player.id).toBe("home-9");
    expect(result?.velocity.z).toBeGreaterThan(0);
    expect(result?.velocity.y).toBeGreaterThan(0);
  });

  it("keeps the trajectory contact point when the winner contests from the side", () => {
    const result = resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 2.1, 4), new THREE.Vector3(0, -1.2, 9)),
      attackingTeam: "home",
      players: [player("home-9", "home", "FWD", new THREE.Vector3(1.2, 0, 4))],
      goalTarget: new THREE.Vector3(0, 1.8, 56)
    });
    expect(result).not.toBeNull();
    expect(result!.point.x).toBe(0);
    expect(result!.point.z).toBe(4);
    expect(result!.point.x).not.toBe(result!.player.position.x);
  });

  it("gives a low arrival to a volley and lets a defender make one clearance", () => {
    const volley = resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 1.15, 4), new THREE.Vector3(0, -0.5, 8)),
      attackingTeam: "home",
      players: [player("home-10", "home", "FWD", new THREE.Vector3(0, 0, 4))]
    });
    expect(volley?.action).toBe("volley");

    const clearance = resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 2.1, 4), new THREE.Vector3(0, -1.2, 8)),
      attackingTeam: "home",
      players: [player("away-4", "away", "DEF", new THREE.Vector3(0, 0, 4))]
    });
    expect(clearance?.action).toBe("clearance");
    expect(clearance?.velocity.z).toBeLessThan(0);
  });

  it("allows a nearby opposing keeper to claim an aerial ball", () => {
    const result = resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 2.1, 52), new THREE.Vector3(0, -1.4, 5)),
      attackingTeam: "home",
      players: [player("away-1", "away", "GK", new THREE.Vector3(0, 0, 52), 90)]
    });
    expect(result?.action).toBe("keeperClaim");
    expect(result?.velocity.length()).toBe(0);
  });

  it("does not contest an apex that is still rising or a ball outside the radius", () => {
    expect(resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 3, 4), new THREE.Vector3(0, 2, 5)),
      attackingTeam: "home",
      players: [player("home-9", "home", "FWD", new THREE.Vector3(0, 0, 4))]
    })).toBeNull();
    expect(resolveAerialContest({
      ball: ball(new THREE.Vector3(0, 2, 4), new THREE.Vector3(0, 0.4, 5)),
      attackingTeam: "home",
      players: [player("home-9", "home", "FWD", new THREE.Vector3(0, 0, 4))]
    })).toBeNull();
    expect(resolveAerialContest({
      ball: ball(new THREE.Vector3(8, 2, 4), new THREE.Vector3(0, -1, 5)),
      attackingTeam: "home",
      players: [player("home-9", "home", "FWD", new THREE.Vector3(0, 0, 4))]
    })).toBeNull();
  });

  it("keeps low airborne release out of grounded possession until it settles", () => {
    expect(isAerialBallAirborne(ball(new THREE.Vector3(0, 0.22, 0), new THREE.Vector3(0, 2, 8)))).toBe(true);
    expect(isAerialBallAirborne(ball(new THREE.Vector3(0, 0.27, 0), new THREE.Vector3(0, -0.1, 8)))).toBe(false);
  });
});
