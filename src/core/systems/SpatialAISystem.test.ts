import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { TeamData } from "../../data/types";
import { planBothTeamsSpatialAI, planTeamSpatialAI } from "./SpatialAISystem";
import type { SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };
const teams: Record<"home" | "away", TeamData> = {
  home: { id: "home", name: "Home", short: "H", attackingDirection: 1, primary: 0, secondary: 0, accent: 0, players: [] },
  away: { id: "away", name: "Away", short: "A", attackingDirection: -1, primary: 0, secondary: 0, accent: 0, players: [] }
};
const player = (id: string, team: "home" | "away", role: SimPlayer["role"], x: number, z: number): SimPlayer => ({
  id, team, role, number: 1, short: id,
  position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), home: new THREE.Vector3(x, 0, z),
  hasBall: false, stamina: 1, cooldown: 0, intent: "hold",
  stats: { pace: 75, shooting: 75, passing: 75, dribbling: 75, defending: 75, physical: 75 },
  mesh: new THREE.Group(), body: new THREE.Mesh()
});
const homeShape = () => [
  player("h-gk", "home", "GK", 0, -50),
  player("h-d1", "home", "DEF", -20, -30), player("h-d2", "home", "DEF", 0, -32), player("h-d3", "home", "DEF", 20, -30),
  player("h-m1", "home", "MID", -14, -6), player("h-m2", "home", "MID", 14, -6),
  player("h-f1", "home", "FWD", -18, 20), player("h-f2", "home", "FWD", 18, 20)
];

describe("SpatialAISystem", () => {
  it("caps pressers so the full team cannot swarm the ball", () => {
    const home = homeShape();
    const owner = player("a-owner", "away", "FWD", 0, -8);
    const plan = planTeamSpatialAI({ players: [...home, owner], ballPosition: owner.position, ballOwner: owner, team: teams.home, bounds, config: { maxPressers: 2, pressingDistance: 100 } });
    expect(plan.metrics.presserCount).toBe(2);
    expect(plan.decisions.filter((decision) => decision.reason === "press")).toHaveLength(2);
    expect(plan.decisions.filter((decision) => decision.reason === "shape" || decision.reason === "mark").length).toBeGreaterThan(0);
  });

  it("reports recognizable shape and open support options", () => {
    const home = homeShape();
    const owner = home.find((candidate) => candidate.id === "h-m1")!;
    const opponents = [player("a-d1", "away", "DEF", 25, 10), player("a-d2", "away", "DEF", -25, 12)];
    const plan = planTeamSpatialAI({ players: [...home, ...opponents], ballPosition: owner.position, ballOwner: owner, team: teams.home, bounds });
    expect(plan.metrics.phase).toBe("attacking");
    expect(plan.metrics.shapeRecognizable).toBe(true);
    expect(plan.metrics.supportOptionCount).toBeGreaterThan(0);
    expect(plan.metrics.openSupportOptionCount).toBeGreaterThan(0);
    expect(plan.shape.supportRunnerIds.length).toBeGreaterThan(0);
  });

  it("plans both teams in one deterministic pass", () => {
    const home = homeShape();
    const away = home.map((source) => player(source.id.replace("h-", "a-"), "away", source.role, source.position.x, -source.position.z));
    const owner = home.find((candidate) => candidate.id === "h-m1")!;
    const first = planBothTeamsSpatialAI({ players: [...home, ...away], ballPosition: owner.position, ballOwner: owner, teams, bounds });
    const second = planBothTeamsSpatialAI({ players: [...home, ...away], ballPosition: owner.position, ballOwner: owner, teams, bounds });
    expect(first.home.decisions.map((decision) => [decision.playerId, decision.reason, decision.target.x, decision.target.z]))
      .toEqual(second.home.decisions.map((decision) => [decision.playerId, decision.reason, decision.target.x, decision.target.z]));
    expect(first.away.metrics.presserCount).toBeLessThanOrEqual(2);
  });

  it("scales pressure slots with tactics while retaining the two-player cap", () => {
    const home = homeShape();
    const owner = player("a-owner", "away", "FWD", 0, -8);
    const low = planTeamSpatialAI({
      players: [...home, owner], ballPosition: owner.position, ballOwner: owner, team: teams.home, bounds,
      tactics: { defensiveLine: 50, pressingIntensity: 0, buildUpSpeed: 50, passingStyle: "balanced", attackWidth: 50, instructions: {} }
    });
    const high = planTeamSpatialAI({
      players: [...home, owner], ballPosition: owner.position, ballOwner: owner, team: teams.home, bounds,
      tactics: { defensiveLine: 50, pressingIntensity: 100, buildUpSpeed: 50, passingStyle: "balanced", attackWidth: 50, instructions: {} }
    });
    expect(low.metrics.presserCount).toBe(0);
    expect(high.metrics.presserCount).toBe(2);
    expect(high.metrics.presserCount).toBeLessThanOrEqual(2);
  });
});
