import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { TeamData } from "../../data/types";
import { updateAI } from "./AISystem";
import type { SimBall, SimPlayer } from "./types";

const teams: Record<"home" | "away", TeamData> = {
  home: { id: "home", name: "Home", short: "H", attackingDirection: 1, primary: 0, secondary: 0, accent: 0, players: [] },
  away: { id: "away", name: "Away", short: "A", attackingDirection: -1, primary: 0, secondary: 0, accent: 0, players: [] }
};

function player(id: string, team: "home" | "away", role: SimPlayer["role"], position: THREE.Vector3): SimPlayer {
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
    stats: { pace: 60, shooting: 50, passing: 60, dribbling: 60, defending: 80, physical: 80 },
    mesh: new THREE.Group(),
    body: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  };
}

const makeBall = (position: THREE.Vector3): SimBall => ({
  position: position.clone(),
  velocity: new THREE.Vector3(),
  mesh: new THREE.Mesh(new THREE.SphereGeometry(0.5))
});

describe("AISystem goalkeeper integration", () => {
  it("uses angle-aware targets for both goalkeeper directions", () => {
    const homeKeeper = player("home-gk", "home", "GK", new THREE.Vector3(0, 0, -50));
    const awayKeeper = player("away-gk", "away", "GK", new THREE.Vector3(0, 0, 50));
    const active = player("active", "home", "FWD", new THREE.Vector3(0, 0, 0));
    const ball = makeBall(new THREE.Vector3(24, 0.55, 18));
    updateAI({
      players: [homeKeeper, awayKeeper, active],
      ball,
      ballOwner: null,
      activePlayer: active,
      teams,
      bounds: { halfWidth: 36, halfLength: 56 },
      playerRadius: 1,
      dt: 0.1,
      random: (min, max) => (min + max) * 0.5
    });

    expect(homeKeeper.intent).toBe("keeper");
    expect(awayKeeper.intent).toBe("keeper");
    expect(homeKeeper.position.z).toBeLessThan(-50);
    expect(awayKeeper.position.z).toBeGreaterThan(50);
  });
});
