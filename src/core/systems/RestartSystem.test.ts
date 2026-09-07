import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRestartPlan, positionRestart, resolveOutOfPlay } from "./RestartSystem";
import type { SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };
const vec = (x: number, y = 0.55, z = 0) => new THREE.Vector3(x, y, z);
const resolve = (from: THREE.Vector3, to: THREE.Vector3, lastTouchTeam?: "home" | "away") => resolveOutOfPlay({ previousPosition: from, position: to, bounds, ballRadius: 0.55, goalWidth: 13.5, lastTouchTeam });
const player = (id: string, team: "home" | "away", role: SimPlayer["role"] = "MID"): SimPlayer => ({ id, team, role, number: 1, short: id, position: vec(0, 0, 0), home: vec(4, 0, team === "home" ? -10 : 10), velocity: vec(1, 0, 1), hasBall: true, stamina: 1, cooldown: 0.5, intent: "hold", stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 }, mesh: new THREE.Group(), body: new THREE.Mesh() });

describe("Phase 4 out of play", () => {
  it("waits until the whole ball crosses the touchline", () => {
    expect(resolve(vec(35), vec(36.54))).toBeNull();
    const result = resolve(vec(36.54), vec(36.6), "home");
    expect(result).toMatchObject({ kind: "restart", restart: { kind: "throwIn", team: "away" } });
  });
  it.each([1, -1])("awards mirrored touchline restarts %s", (side) => {
    expect(resolve(vec(35 * side), vec(37 * side), "away")).toMatchObject({ restart: { kind: "throwIn", team: "home" } });
  });
  it.each([1, -1])("awards goals before endline restarts in direction %s", (direction) => {
    expect(resolve(vec(0, 0.55, direction * 55), vec(0, 0.55, direction * 57), "away")).toMatchObject({ kind: "goal", team: direction === 1 ? "home" : "away" });
  });
  it.each([1, -1])("uses last touch for wide shots and high misses %s", (direction) => {
    const attacker = direction === 1 ? "home" : "away";
    const defender = attacker === "home" ? "away" : "home";
    for (const [x, y] of [[10, 0.55], [0, 6]]) {
      expect(resolve(vec(x, y, direction * 55), vec(x, y, direction * 58), attacker)).toMatchObject({ restart: { kind: "goalKick", team: defender } });
      expect(resolve(vec(x, y, direction * 55), vec(x, y, direction * 58), defender)).toMatchObject({ restart: { kind: "corner", team: attacker } });
    }
  });
  it("uses the first crossed edge on a diagonal instead of the final position", () => {
    expect(resolve(vec(35, 0.55, 55), vec(39, 0.55, 58), "home")).toMatchObject({ restart: { kind: "throwIn" } });
    expect(resolve(vec(35, 0.55, 55), vec(38, 0.55, 59), "home")).toMatchObject({ restart: { kind: "goalKick" } });
  });
  it("checks goal-mouth height at the swept crossing, not the final point", () => {
    expect(resolve(vec(0, 6, 55), vec(0, 0.55, 60), "home")).toMatchObject({ restart: { kind: "goalKick" } });
  });
  it("has deterministic unknown-touch fallbacks and respects switched directions", () => {
    expect(resolve(vec(35), vec(38))).toMatchObject({ restart: { kind: "throwIn", team: "away" } });
    expect(resolve(vec(12, 0.55, 55), vec(12, 0.55, 58))).toMatchObject({ restart: { kind: "goalKick", team: "away" } });
    expect(resolveOutOfPlay({ previousPosition: vec(0, 0.55, 55), position: vec(0, 0.55, 58), bounds, ballRadius: 0.55, goalWidth: 13.5, attackingDirections: { home: -1, away: 1 } })).toMatchObject({ kind: "goal", team: "away" });
  });
});

describe("Restart positioning", () => {
  it.each(["throwIn", "corner", "goalKick", "kickoff", "freeKick", "penalty"] as const)("places %s safely and preserves formation homes", (kind) => {
    const restart = createRestartPlan({ kind, team: "home", position: vec(36, 0.55, 56), bounds });
    const players = [player("taker", "home"), player("receiver", "home"), player("keeper", "home", "GK"), player("opponent", "away")];
    players[3].position.copy(restart.position).setY(0);
    const homes = players.map((p) => p.home.clone());
    const arranged = positionRestart({ restart, players, bounds });
    expect(arranged.taker?.id).toBe(kind === "goalKick" ? "keeper" : "receiver");
    expect(resolve(arranged.ballPosition, arranged.ballPosition)).toBeNull();
    expect(players[3].position.clone().setY(0.55).distanceTo(arranged.ballPosition)).toBeGreaterThanOrEqual(arranged.minOpponentDistance);
    players.forEach((p, i) => {
      expect(p.home.equals(homes[i])).toBe(true);
      expect(p.velocity.length()).toBe(0);
      expect(p.hasBall).toBe(false);
      expect(Math.abs(p.position.x)).toBeLessThan(bounds.halfWidth);
      expect(Math.abs(p.position.z)).toBeLessThan(bounds.halfLength);
    });
  });
  it("uses only supplied eligible players and handles an empty team", () => {
    const restart = createRestartPlan({ kind: "kickoff", team: "home", bounds });
    expect(positionRestart({ restart, players: [player("opponent", "away")], bounds }).taker).toBeNull();
    expect(positionRestart({ restart, players: [player("eligible", "home")], bounds }).taker?.id).toBe("eligible");
  });
  it("honors an eligible configured set-piece taker and falls back safely", () => {
    const restart = createRestartPlan({ kind: "corner", team: "home", bounds });
    const players = [player("near", "home"), player("captain", "home"), player("opponent", "away")];
    players[0].position.copy(restart.position);
    players[1].position.set(0, 0, 0);
    expect(positionRestart({ restart, players, bounds, preferredTakerId: "captain" }).taker?.id).toBe("captain");
    const fallbackPlayers = [player("near", "home"), player("captain", "home"), player("opponent", "away")];
    fallbackPlayers[0].position.copy(restart.position);
    fallbackPlayers[1].position.set(0, 0, 0);
    expect(positionRestart({ restart, players: fallbackPlayers, bounds, preferredTakerId: "missing" }).taker?.id).toBe("near");
  });
  it("puts kickoff opponents in their own half outside the centre circle", () => {
    const restart = createRestartPlan({ kind: "kickoff", team: "away", bounds });
    const players = [player("taker", "away"), player("receiver", "away"), player("opponent", "home")];
    positionRestart({ restart, players, bounds });
    expect(players[2].position.z).toBeLessThan(0);
    expect(players[2].position.length()).toBeGreaterThan(9.15);
  });
  it.each([1, -1])("preserves kickoff opponent halves after circle exclusion with home direction %s", (direction) => {
    const directions = { home: direction, away: -direction };
    for (const team of ["home", "away"] as const) {
      const restart = createRestartPlan({ kind: "kickoff", team, bounds });
      const opponentTeam = team === "home" ? "away" : "home";
      const players = [player("taker", team), player("receiver", team), player("o1", opponentTeam), player("o2", opponentTeam)];
      players[2].home.set(0, 0, 0);
      players[3].home.set(-1, 0, 1);
      const arranged = positionRestart({ restart, players, bounds, attackingDirections: directions });
      for (const opponent of players.slice(2)) {
        expect(opponent.position.z * directions[opponentTeam]).toBeLessThan(0);
        expect(opponent.position.clone().setY(0.55).distanceTo(arranged.ballPosition)).toBeGreaterThanOrEqual(arranged.minOpponentDistance);
      }
    }
  });
  it.each([1, -1])("positions a penalty keeper on the goal line and every other player behind the spot %s", (direction) => {
    const directions = { home: direction, away: -direction };
    const restart = createRestartPlan({ kind: "penalty", team: "home", bounds, attackingDirection: direction });
    const players = [player("taker", "home"), player("attacker", "home"), player("keeper", "away", "GK"), player("defender", "away")];
    players.forEach((p) => p.position.set(0, 0, direction * 50));
    const arranged = positionRestart({ restart, players, bounds, attackingDirections: directions });
    const keeper = players[2];
    expect(keeper.position.z).toBeCloseTo(direction * (bounds.halfLength - 0.1));
    expect(keeper.position.x).toBe(0);
    for (const waitingPlayer of players.filter((p) => p !== keeper && p !== arranged.taker)) {
      expect(waitingPlayer.position.z * direction).toBeLessThan(bounds.halfLength - 16.5 * bounds.halfLength / 52.5);
      expect(waitingPlayer.position.z * direction).toBeLessThan(arranged.ballPosition.z * direction);
      expect(waitingPlayer.position.clone().setY(0.55).distanceTo(arranged.ballPosition)).toBeGreaterThanOrEqual(arranged.minOpponentDistance);
    }
  });
  it.each([26.25, 52.5, 56, 105])("scales the penalty spot consistently with the referee at halfLength %s", (halfLength) => {
    const scaledBounds = { halfLength, halfWidth: 34 * halfLength / 52.5 };
    const restart = createRestartPlan({ kind: "penalty", team: "away", bounds: scaledBounds });
    expect(restart.position.z).toBeCloseTo(-halfLength * (1 - 11 / 52.5));
    const goalKick = createRestartPlan({ kind: "goalKick", team: "away", bounds: scaledBounds });
    expect(goalKick.position.z).toBeCloseTo(halfLength * (1 - 5.5 / 52.5));
  });
});
