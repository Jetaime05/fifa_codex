import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { assessShielding, resolveDuel, DuelSystem } from "./DuelSystem";
import type { SimPlayer } from "./types";

const player = (id: string, team: "home" | "away", position: THREE.Vector3, overrides: Partial<SimPlayer> = {}): SimPlayer => ({
  id, team, role: "MID", number: 8, short: id,
  position: position.clone(), velocity: new THREE.Vector3(), home: position.clone(),
  hasBall: false, stamina: 1, cooldown: 0, intent: "hold",
  stats: { pace: 70, shooting: 60, passing: 60, dribbling: 55, defending: 80, physical: 80 },
  mesh: new THREE.Group(), body: new THREE.Mesh(), ...overrides
});

describe("DuelSystem", () => {
  it("treats a body between the challenger and nearby ball as shielding", () => {
    const owner = player("home-owner", "home", new THREE.Vector3(0, 0, 0));
    const challenger = player("away-challenger", "away", new THREE.Vector3(0, 0, -1.1));
    const assessment = assessShielding(owner, challenger, new THREE.Vector3(0, 0, 0.9));
    expect(assessment.shielded).toBe(true);
    expect(assessment.reason).toBe("body-between");
  });

  it("does not call a distant loose ball protected by the owner shielding", () => {
    const owner = player("home-owner", "home", new THREE.Vector3(0, 0, 0));
    const challenger = player("away-challenger", "away", new THREE.Vector3(0, 0, -1));
    const assessment = assessShielding(owner, challenger, new THREE.Vector3(0, 0, 4));
    expect(assessment.shielded).toBe(false);
    expect(assessment.reason).toBe("ball-too-far");
  });

  it("returns a pure duel result and gives a slide its explicit action modifier", () => {
    const owner = player("home-owner", "home", new THREE.Vector3(0, 0, 0), {
      stats: { pace: 55, shooting: 50, passing: 50, dribbling: 40, defending: 30, physical: 40 }
    });
    const challenger = player("away-challenger", "away", new THREE.Vector3(0, 0, 1.1), {
      stats: { pace: 75, shooting: 50, passing: 50, dribbling: 40, defending: 55, physical: 55 }
    });
    const ball = new THREE.Vector3(0, 0.2, 0.85);
    const before = JSON.stringify({ challenger: challenger.position.toArray(), owner: owner.position.toArray(), challengerKeys: Object.keys(challenger) });
    const poke = resolveDuel({ challenger, owner, ballPosition: ball, now: 1, action: "poke", random: 0.5 });
    const slide = resolveDuel({ challenger, owner, ballPosition: ball, now: 1, action: "slide", random: 0.5 });
    expect(slide.challengerScore).toBeGreaterThan(poke.challengerScore);
    expect(JSON.stringify({ challenger: challenger.position.toArray(), owner: owner.position.toArray(), challengerKeys: Object.keys(challenger) })).toBe(before);
  });

  it("blocks the staggered player during recovery and uses the same rule for snapshots", () => {
    const system = new DuelSystem();
    const owner = player("home-owner", "home", new THREE.Vector3(0, 0, 0), {
      stats: { pace: 40, shooting: 40, passing: 40, dribbling: 20, defending: 20, physical: 20 }
    });
    const challenger = player("away-challenger", "away", new THREE.Vector3(0, 0, 1), {
      stats: { pace: 90, shooting: 50, passing: 50, dribbling: 50, defending: 95, physical: 95 }
    });
    const result = system.resolve({ challenger, owner, ballPosition: new THREE.Vector3(0, 0.2, 0.8), now: 10, random: 1 });
    const staggered = result.staggeredPlayerId === owner.id ? owner : challenger;
    const other = staggered === owner ? challenger : owner;
    const blocked = system.eligibility({ challenger: staggered, owner: other, ballPosition: new THREE.Vector3(0, 0.2, 0.8), now: 10.1 });
    expect(blocked.reason).toBe("recovery");
  });

  it("clears cooldown and recovery state on reset", () => {
    const system = new DuelSystem();
    const owner = player("home-owner", "home", new THREE.Vector3(0, 0, 0), {
      stats: { pace: 40, shooting: 40, passing: 40, dribbling: 25, defending: 20, physical: 25 }
    });
    const challenger = player("away-challenger", "away", new THREE.Vector3(0, 0, 0.95), {
      velocity: new THREE.Vector3(0, 0, -2),
      stats: { pace: 88, shooting: 50, passing: 50, dribbling: 40, defending: 95, physical: 95 }
    });
    const input = {
      challenger,
      owner,
      ballPosition: new THREE.Vector3(0, 0.2, 0.84),
      now: 10,
      action: "poke" as const,
      random: 1
    };

    const result = system.resolve(input);
    expect(["won", "lost"]).toContain(result.status);
    const blocked = system.eligibility({ ...input, now: 10.1 });
    expect(blocked.eligible).toBe(false);
    expect(["cooldown", "recovery"]).toContain(blocked.reason);

    system.reset();
    expect(system.eligibility({ ...input, now: 10.1 })).toMatchObject({
      eligible: true,
      reason: "eligible"
    });
  });
});
