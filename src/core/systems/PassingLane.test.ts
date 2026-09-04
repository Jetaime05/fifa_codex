import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { analyzePassingLane, distanceToPassingLane, findOpenPassingOptions } from "./PassingLane";
import type { SimPlayer } from "./types";

const player = (id: string, team: "home" | "away", x: number, z: number): SimPlayer => ({
  id,
  team,
  role: "MID",
  number: 8,
  short: id,
  position: new THREE.Vector3(x, 0, z),
  velocity: new THREE.Vector3(),
  home: new THREE.Vector3(x, 0, z),
  hasBall: false,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: { pace: 75, shooting: 75, passing: 75, dribbling: 75, defending: 75, physical: 75 },
  mesh: new THREE.Group(),
  body: new THREE.Mesh()
});

describe("PassingLane", () => {
  it("detects a blocker on the segment and reports stable geometry", () => {
    const geometry = distanceToPassingLane(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 20), new THREE.Vector3(2, 0, 10));
    expect(geometry.distance).toBeCloseTo(2);
    expect(geometry.progress).toBeCloseTo(0.5);

    const lane = analyzePassingLane(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 20), [player("blocker", "away", 2, 10)]);
    expect(lane.blocked).toBe(true);
    expect(lane.blockers.map((blocker) => blocker.playerId)).toEqual(["blocker"]);
  });

  it("ignores opponents beyond the receiver and ranks clear options first", () => {
    const carrier = player("home-8", "home", 0, 0);
    const clear = player("home-7", "home", 10, 15);
    const blocked = player("home-9", "home", 0, 18);
    const opponents = [player("away-beyond", "away", 10, 25), player("away-block", "away", 0, 9)];
    const beyondLane = analyzePassingLane(carrier.position, clear.position, [opponents[0]]);
    expect(beyondLane.blocked).toBe(false);
    const options = findOpenPassingOptions(carrier, [carrier, clear, blocked], opponents, 1);
    expect(options.find((option) => option.player.id === "home-7")?.lane.blocked).toBe(false);
    expect(options.find((option) => option.player.id === "home-9")?.lane.blocked).toBe(true);
  });

  it("returns equal scores when the pitch is mirrored for the away team", () => {
    const homeCarrier = player("carrier", "home", 2, -5);
    const homeTarget = player("target", "home", -8, 12);
    const awayCarrier = player("carrier", "away", 2, 5);
    const awayTarget = player("target", "away", -8, -12);
    const home = findOpenPassingOptions(homeCarrier, [homeCarrier, homeTarget], [player("opponent", "away", 5, 4)], 1)[0];
    const away = findOpenPassingOptions(awayCarrier, [awayCarrier, awayTarget], [player("opponent", "home", 5, -4)], -1)[0];
    expect(home.score).toBeCloseTo(away.score);
    expect(home.lane.risk).toBeCloseTo(away.lane.risk);
  });
});
