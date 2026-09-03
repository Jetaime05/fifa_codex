import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { resolvePossession } from "./PossessionSystem";
import type { SimPlayer } from "./types";

const player = (id: string, team: "home" | "away", x: number, z: number) => ({
  id, team, role: "MID", number: 8, short: id, position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), home: new THREE.Vector3(), hasBall: false, stamina: 1, cooldown: 0, intent: "hold", stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 }, mesh: new THREE.Group(), body: new THREE.Mesh()
} as SimPlayer);

describe("PossessionSystem", () => {
  it("changes possession when a player collects a loose ball", () => {
    const home = player("home-8", "home", 0, 0);
    const away = player("away-8", "away", 20, 20);
    const result = resolvePossession({ players: [home, away], homePlayers: [home], awayPlayers: [away], activePlayer: home, ballOwner: null, ballPosition: new THREE.Vector3(0.5, 0.5, 0), random: () => 0 });
    expect(result?.owner).toBe(home);
    expect(result?.shouldControlOwner).toBe(false);
  });
});
