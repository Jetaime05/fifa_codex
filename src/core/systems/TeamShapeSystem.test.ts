import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { TeamData } from "../../data/types";
import { assignDefensiveMarkingZones, buildTeamShapePlan, calculateBaseShapeTargets } from "./TeamShapeSystem";
import type { SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };
const team = (id: "home" | "away", attackingDirection: number): TeamData => ({ id, name: id, short: id, attackingDirection, primary: 0, secondary: 0, accent: 0, players: [] });
const player = (id: string, side: "home" | "away", role: SimPlayer["role"], x: number, z: number): SimPlayer => ({
  id, team: side, role, number: 1, short: id,
  position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), home: new THREE.Vector3(x, 0, z),
  hasBall: false, stamina: 1, cooldown: 0, intent: "hold",
  stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
  mesh: new THREE.Group(), body: new THREE.Mesh()
});

describe("TeamShapeSystem", () => {
  it("widens and advances in attack, then compacts and ball-side shifts in defence", () => {
    const winger = player("winger", "home", "FWD", 20, 18);
    const attack = calculateBaseShapeTargets({ players: [winger], team: team("home", 1), phase: "attacking", ballPosition: new THREE.Vector3(10, 0, 0), bounds })[0].position;
    const defence = calculateBaseShapeTargets({ players: [winger], team: team("home", 1), phase: "defending", ballPosition: new THREE.Vector3(10, 0, 0), bounds })[0].position;
    expect(attack.z).toBeGreaterThan(winger.home.z);
    expect(attack.x).toBeGreaterThan(defence.x);
    expect(defence.z).toBeLessThan(winger.home.z);
  });

  it("produces mirrored targets for home and away", () => {
    const home = player("p", "home", "MID", 12, -7);
    const away = player("p", "away", "MID", 12, 7);
    const homeTarget = calculateBaseShapeTargets({ players: [home], team: team("home", 1), phase: "attacking", ballPosition: new THREE.Vector3(-6, 0, 4), bounds })[0].position;
    const awayTarget = calculateBaseShapeTargets({ players: [away], team: team("away", -1), phase: "attacking", ballPosition: new THREE.Vector3(-6, 0, -4), bounds })[0].position;
    expect(homeTarget.x).toBeCloseTo(awayTarget.x);
    expect(homeTarget.z).toBeCloseTo(-awayTarget.z);
  });

  it("limits support runners and keeps defensive marking one-to-one", () => {
    const owner = player("owner", "home", "MID", 0, 0);
    const teammates = [owner, player("f1", "home", "FWD", -10, 10), player("f2", "home", "FWD", 10, 10), player("m1", "home", "MID", 0, -5), player("d1", "home", "DEF", 0, -20)];
    const attack = buildTeamShapePlan({ players: teammates, opponents: [], team: team("home", 1), phase: "attacking", ballPosition: owner.position, ballOwner: owner, bounds, config: { supportRunnerCount: 2 } });
    expect(attack.supportRunnerIds).toHaveLength(2);

    const base = calculateBaseShapeTargets({ players: teammates, team: team("home", 1), phase: "defending", ballPosition: new THREE.Vector3(), bounds });
    const marked = assignDefensiveMarkingZones({ targets: base, players: teammates, opponents: [player("o1", "away", "FWD", 0, -16), player("o2", "away", "FWD", 2, -17)], team: team("home", 1), bounds, config: { markingRadius: 30, maxMarkers: 2 } });
    expect(new Set(marked.assignments.map((assignment) => assignment.markerId)).size).toBe(marked.assignments.length);
    expect(marked.assignments.length).toBeLessThanOrEqual(2);
  });

  it("moves support with an advanced carrier and leaves a trailing outlet", () => {
    const owner = player("owner", "home", "MID", 0, 39);
    const teammates = [owner, player("f1", "home", "FWD", -16, 15), player("f2", "home", "FWD", 16, 15), player("m1", "home", "MID", 0, -5)];
    const plan = buildTeamShapePlan({ players: teammates, opponents: [], team: team("home", 1), phase: "attacking", ballPosition: owner.position, ballOwner: owner, bounds });
    const support = plan.targets.filter((target) => target.source === "support");
    expect(support.filter((target) => target.position.z > owner.position.z)).toHaveLength(2);
    expect(support.filter((target) => target.position.z < owner.position.z)).toHaveLength(1);
    for (const target of support) expect(target.position.distanceTo(owner.position)).toBeGreaterThan(5);
  });

  it("never assigns a hidden extra marker to the already pressed carrier", () => {
    const defender = player("defender", "home", "DEF", 0, -30);
    const owner = player("carrier", "away", "FWD", 0, -29);
    const outlet = player("outlet", "away", "FWD", 6, -29);
    const plan = buildTeamShapePlan({ players: [defender], opponents: [owner, outlet], team: team("home", 1), phase: "defending", ballPosition: owner.position, ballOwner: owner, bounds });
    expect(plan.markingAssignments.map((assignment) => assignment.opponentId)).toEqual([outlet.id]);
  });
});
