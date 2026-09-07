import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { realMadrid } from "../data/teams";
import type { TeamData } from "../data/types";
import { planTeamSpatialAI } from "../core/systems/SpatialAISystem";
import type { SimPlayer } from "../core/systems/types";
import {
  buildMatchTeamData,
  createDefaultSquad,
  createSquadStore,
  validateSquad,
  type StorageLike
} from "./SquadSystem";

const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
};

const finite = (value: number): boolean => Number.isFinite(value);

const toSimPlayer = (
  player: {
    id: string;
    name: string;
    short: string;
    role: SimPlayer["role"];
    number: number;
    formation: { x: number; z: number };
    stats: SimPlayer["stats"];
  },
  team: "home" | "away"
): SimPlayer => {
  const home = new THREE.Vector3(player.formation.x, 0, player.formation.z);
  return {
    id: player.id,
    team,
    role: player.role,
    number: player.number,
    short: player.short,
    position: home.clone(),
    velocity: new THREE.Vector3(),
    home: home.clone(),
    hasBall: false,
    stamina: 1,
    cooldown: 0,
    intent: "hold",
    stats: { ...player.stats },
    mesh: new THREE.Group(),
    body: new THREE.Mesh()
  };
};

const fullTactics = (overrides: Partial<{
  defensiveLine: number;
  pressingIntensity: number;
  buildUpSpeed: number;
  passingStyle: "short" | "balanced" | "direct";
  attackWidth: number;
}> = {}) => ({
  defensiveLine: 50,
  pressingIntensity: 50,
  buildUpSpeed: 50,
  passingStyle: "balanced" as const,
  attackWidth: 50,
  instructions: {},
  ...overrides
});

describe("Phase 6 management acceptance", () => {
  it("persists lineup, tactics, captain, and set-piece choices across reload", () => {
    const storage = memoryStorage();
    const first = createSquadStore({ storage, key: "phase6-acceptance" });
    const original = first.snapshot;
    const benchCard = original.bench[0];

    first.move(benchCard, "st");
    first.setFormation("4-2-3-1");
    const changed = first.snapshot;
    const captainId = changed.starters.gk;
    const penaltyTaker = changed.starters.st;
    const freeKickTaker = changed.starters.ram;
    const cornerTaker = changed.starters.cam;
    first.setCaptain(captainId);
    first.setPiece("penalty", penaltyTaker);
    first.setPiece("freeKick", freeKickTaker);
    first.setPiece("corner", cornerTaker);
    first.setTactics({
      defensiveLine: 78,
      pressingIntensity: 86,
      buildUpSpeed: 64,
      passingStyle: "direct",
      attackWidth: 71,
      instructions: { [penaltyTaker]: { role: "getForward" } }
    });

    const reloaded = createSquadStore({ storage, key: "phase6-acceptance" });
    expect(reloaded.snapshot).toEqual(first.snapshot);
    expect(reloaded.snapshot.formationId).toBe("4-2-3-1");
    expect(reloaded.snapshot.captainId).toBe(captainId);
    expect(reloaded.snapshot.setPieces).toEqual({
      penalty: penaltyTaker,
      freeKick: freeKickTaker,
      corner: cornerTaker
    });
    expect(reloaded.snapshot.tactics.passingStyle).toBe("direct");
    expect(reloaded.snapshot.tactics.instructions[penaltyTaker]).toEqual({ role: "getForward" });
    expect(validateSquad(reloaded.snapshot).valid).toBe(true);

    const serialized = storage.getItem("phase6-acceptance");
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized as string).version).toBe(2);
  });

  it("builds eleven unique finite match players for every supported formation", () => {
    const store = createSquadStore();

    for (const formation of ["4-3-3", "4-4-2", "4-2-3-1"] as const) {
      store.setFormation(formation);
      const players = buildMatchTeamData(store.snapshot);

      expect(validateSquad(store.snapshot).valid).toBe(true);
      expect(players).toHaveLength(11);
      expect(new Set(players.map((player) => player.id)).size).toBe(11);
      expect(new Set(players.map((player) => player.number)).size).toBe(11);
      for (const player of players) {
        expect(finite(player.formation.x)).toBe(true);
        expect(finite(player.formation.z)).toBe(true);
        for (const rating of Object.values(player.stats)) expect(finite(rating)).toBe(true);
      }
    }
  });

  it("makes pressing and team shape observably different at tactical extremes", () => {
    const squad = createDefaultSquad();
    const matchData = buildMatchTeamData(squad);
    const homePlayers = matchData.map((player) => toSimPlayer(player, "home"));
    const awayOwner = toSimPlayer(
      {
        id: "away-owner",
        name: "Away Owner",
        short: "AWY",
        role: "FWD",
        number: 99,
        formation: { x: 0, z: -20 },
        stats: { pace: 75, shooting: 75, passing: 75, dribbling: 75, defending: 50, physical: 75 }
      },
      "away"
    );
    const bounds = { halfWidth: 36, halfLength: 56 };
    const low = planTeamSpatialAI({
      players: [...homePlayers, awayOwner],
      ballPosition: awayOwner.position,
      ballOwner: awayOwner,
      team: realMadrid,
      bounds,
      tactics: fullTactics({ defensiveLine: 0, pressingIntensity: 0, attackWidth: 0 })
    });
    const high = planTeamSpatialAI({
      players: [...homePlayers, awayOwner],
      ballPosition: awayOwner.position,
      ballOwner: awayOwner,
      team: realMadrid,
      bounds,
      tactics: fullTactics({ defensiveLine: 100, pressingIntensity: 100, attackWidth: 100 })
    });

    expect(low.metrics.presserCount).toBe(0);
    expect(high.metrics.presserCount).toBe(2);
    expect(high.metrics.pressingIntensity).toBe(100);

    const lowTargets = new Map(low.shape.targets.map((target) => [target.playerId, target.position]));
    const totalShapeDelta = high.shape.targets.reduce((sum, target) => {
      return sum + target.position.distanceTo(lowTargets.get(target.playerId) ?? target.position);
    }, 0);
    expect(totalShapeDelta).toBeGreaterThan(1);
  });
});
