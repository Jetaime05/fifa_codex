import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { separatePlayers } from "./CollisionSystem";
import type { SimPlayer } from "./types";

const player = (id: string, position: THREE.Vector3): SimPlayer => ({
  id, team: id.startsWith("home") ? "home" : "away", role: "MID", number: 8, short: id,
  position: position.clone(), velocity: new THREE.Vector3(), home: position.clone(), hasBall: false,
  stamina: 1, cooldown: 0, intent: "hold",
  stats: { pace: 70, shooting: 60, passing: 60, dribbling: 60, defending: 60, physical: 60 },
  mesh: new THREE.Group(), body: new THREE.Mesh()
});
describe("CollisionSystem", () => {
  it("separates coincident players with a deterministic finite axis", () => {
    const a = player("home-a", new THREE.Vector3());
    const b = player("away-b", new THREE.Vector3());
    expect(() => separatePlayers({ players: [a, b], activePlayer: a, playerRadius: 0.75 })).not.toThrow();
    expect(a.position.toArray().every(Number.isFinite)).toBe(true);
    expect(b.position.toArray().every(Number.isFinite)).toBe(true);
    expect(a.position.distanceTo(b.position)).toBeGreaterThanOrEqual(0.75 * 1.58 - 0.00001);
    expect(a.mesh.position.equals(a.position)).toBe(true);
    expect(b.mesh.position.equals(b.position)).toBe(true);
  });

  it("gives the same world result when the coincident pair order is reversed", () => {
    const firstA = player("home-a", new THREE.Vector3());
    const firstB = player("away-b", new THREE.Vector3());
    separatePlayers({ players: [firstA, firstB], playerRadius: 0.75 });
    const secondA = player("home-a", new THREE.Vector3());
    const secondB = player("away-b", new THREE.Vector3());
    separatePlayers({ players: [secondB, secondA], playerRadius: 0.75 });
    expect(secondA.position.toArray()).toEqual(firstA.position.toArray());
    expect(secondB.position.toArray()).toEqual(firstB.position.toArray());
  });

  it("separates the selected body symmetrically and clamps pitch bounds", () => {
    const a = player("home-a", new THREE.Vector3(9.9, 0, 0));
    const b = player("away-b", new THREE.Vector3(9.9, 0, 0));
    separatePlayers({ players: [a, b], activePlayer: a, playerRadius: 0.75, bounds: { halfWidth: 10, halfLength: 10 } });
    expect(a.position.x).toBeLessThanOrEqual(9.25);
    expect(b.position.x).toBeLessThanOrEqual(9.25);
    expect(a.position.distanceTo(b.position)).toBeGreaterThanOrEqual(0.75 * 1.58 - 0.00001);
  });
});
