import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { RefereeSystem } from "./RefereeSystem";
import type { TeamId } from "../../data/types";

const bounds = { halfWidth: 34, halfLength: 52.5 };
const player = (id: string, team: TeamId, z: number, x = 0) => ({ id, team, position: new THREE.Vector3(x, 0, z) });
const challenge = (system: RefereeSystem, z = 0, severity = 0.7, x = 0) => system.assessTackle({
  offender: player("defender", "away", z, x), victim: player("attacker", "home", z, x), severity
});
const passFixture = (team: TeamId = "home") => {
  const direction = team === "home" ? 1 : -1;
  const defending: TeamId = team === "home" ? "away" : "home";
  const passer = player("passer", team, 10 * direction);
  const receiver = player("receiver", team, 40 * direction);
  const defenders = [player("keeper", defending, 50 * direction), player("defender", defending, 35 * direction)];
  return { passer, receiver, players: [passer, receiver, ...defenders], ballPosition: passer.position.clone() };
};

describe("RefereeSystem prototype foul and discipline rules", () => {
  it("keeps clean tackles legal without consuming random state", () => {
    const referee = new RefereeSystem({ bounds, random: () => { throw new Error("Unexpected random call"); } });
    expect(referee.assessTackle({ offender: player("d", "away", 0), victim: player("a", "home", 0), wonBall: true }).foul).toBe(false);
  });

  it("uses injected random for marginal contact", () => {
    expect(challenge(new RefereeSystem({ bounds, random: () => 0 }), 0, 0.2).foul).toBe(true);
    expect(challenge(new RefereeSystem({ bounds, random: () => 0.99 }), 0, 0.2).foul).toBe(false);
  });

  it.each([1, -1] as const)("awards penalties only in the offending team's own area (direction %s)", direction => {
    const referee = new RefereeSystem({ bounds, random: () => 0, attackDirections: { home: direction, away: direction === 1 ? -1 : 1 } });
    const result = challenge(referee, 40 * direction, 0.3);
    expect(result.restart?.kind).toBe("penalty");
    expect(result.restart?.team).toBe("home");
    expect(result.restart?.position.z).toBeCloseTo(41.5 * direction);
    expect(challenge(referee, -40 * direction, 0.3).restart?.kind).toBe("freeKick");
    expect(challenge(referee, 40 * direction, 0.3, 21).restart?.kind).toBe("freeKick");
  });

  it("includes area line but not positions beyond the field in penalty decisions", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0 });
    expect(challenge(referee, 36, 0.2, 20.16).restart?.kind).toBe("penalty");
    expect(challenge(referee, 35.99, 0.2).restart?.kind).toBe("freeKick");
    expect(challenge(referee, 53, 0.2).restart?.kind).toBe("freeKick");
  });

  it("tracks yellow, second-yellow dismissal, and ignores further tackles by dismissed player", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0 });
    expect(challenge(referee).card).toBe("yellow");
    expect(challenge(referee).card).toBe("secondYellow");
    expect(referee.dismissedIds.has("defender")).toBe(true);
    expect(referee.discipline.get("defender")).toEqual({ yellows: 2, reds: 1, fouls: 2 });
    expect(challenge(referee).foul).toBe(false);
    referee.clearPending();
    expect(referee.dismissedIds.has("defender")).toBe(true);
    referee.reset();
    expect(referee.dismissedIds.size).toBe(0);
  });

  it("always dismisses severe contact and never awards fouls for teammates", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0.99 });
    expect(challenge(referee, 0, 0.95).card).toBe("red");
    expect(referee.assessTackle({ offender: player("a", "home", 0), victim: player("b", "home", 0), severity: 1 }).foul).toBe(false);
  });
});

describe("RefereeSystem opt-in offside", () => {
  it("defaults all advanced rules off", () => {
    const referee = new RefereeSystem({ bounds });
    const fixture = passFixture();
    referee.snapshotPass(fixture);
    expect(referee.onTouch(fixture.receiver)).toBeNull();
    expect(Object.values(referee.options)).toEqual([false, false, false, false]);
  });

  it.each(["home", "away"] as const)("captures pass release position for %s and waits for involvement", team => {
    const referee = new RefereeSystem({ bounds, options: { offside: true } });
    const fixture = passFixture(team);
    referee.snapshotPass(fixture);
    expect(referee.debugSnapshot().offsideCandidateIds).toEqual(["receiver"]);
    // Running back onside does not erase the offence captured at pass release.
    fixture.receiver.position.z = 0;
    const restart = referee.onTouch(fixture.receiver);
    expect(restart?.kind).toBe("freeKick");
    expect(restart?.reason).toContain("Offside");
    expect(restart?.team).toBe(team === "home" ? "away" : "home");
    expect(Math.abs(restart!.position.z)).toBe(40);
    expect(referee.onTouch(fixture.receiver)).toBeNull();
  });

  it("allows level with defender, behind ball, own half, and onside runners", () => {
    for (const [receiverZ, ballZ, defenderZ] of [[35, 10, 35], [40, 42, 35], [-2, -10, -5], [30, 10, 35]]) {
      const referee = new RefereeSystem({ bounds, options: { offside: true } });
      const fixture = passFixture();
      fixture.receiver.position.z = receiverZ;
      fixture.ballPosition.z = ballZ;
      fixture.players[3].position.z = defenderZ;
      referee.snapshotPass(fixture);
      fixture.receiver.position.z = 48;
      expect(referee.onTouch(fixture.receiver)).toBeNull();
    }
  });

  it.each(["throwIn", "corner", "goalKick"])("exempts direct %s restart", restartKind => {
    const referee = new RefereeSystem({ bounds, options: { offside: true } });
    const fixture = passFixture();
    referee.snapshotPass({ ...fixture, restartKind });
    expect(referee.onTouch(fixture.receiver)).toBeNull();
  });

  it("clears on opponent touch, new pass, dead ball, goal, or disabling rule", () => {
    const referee = new RefereeSystem({ bounds, options: { offside: true } });
    const fixture = passFixture();
    const clearers = [() => referee.onTouch(fixture.players[2]), () => referee.snapshotPass({ ...fixture, restartKind: "corner" }), () => referee.clearPending(), () => referee.onGoal(), () => referee.setOptions({ offside: false })];
    for (const clear of clearers) {
      referee.snapshotPass(fixture);
      clear();
      expect(referee.onTouch(fixture.receiver)).toBeNull();
    }
  });

  it("uses changed attack direction after a side swap", () => {
    const referee = new RefereeSystem({ bounds, options: { offside: true } });
    const fixture = passFixture();
    for (const player of fixture.players) player.position.z *= -1;
    fixture.ballPosition.z *= -1;
    referee.setAttackDirections({ home: -1, away: 1 });
    referee.snapshotPass(fixture);
    expect(referee.onTouch(fixture.receiver)?.position.z).toBe(-40);
  });
});

describe("RefereeSystem advantage and optional windows", () => {
  const giveAdvantage = (referee: RefereeSystem) => referee.assessTackle({ offender: player("d", "away", 0), victim: player("a", "home", 0), severity: 0.3, possessionTeam: "home" });

  it("recalls original foul on turnover and retains cards", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0, options: { advantage: true } });
    expect(giveAdvantage(referee)).toMatchObject({ foul: true, advantage: true, restart: null });
    expect(referee.update(1, "home")).toBeNull();
    expect(referee.update(0.1, "away")).toMatchObject({ kind: "freeKick", team: "home" });
    expect(referee.hasPendingAdvantage).toBe(false);
  });

  it("expires after sustained possession but recalls unresolved loose-ball advantage", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0, options: { advantage: true } });
    giveAdvantage(referee);
    expect(referee.update(3, "home")).toBeNull();
    expect(referee.update(1, "away")).toBeNull();
    giveAdvantage(referee);
    expect(referee.update(2, null)).toBeNull();
    expect(referee.update(1, null)?.team).toBe("home");
  });

  it("clears advantage on goal and does not play advantage for penalty", () => {
    const referee = new RefereeSystem({ bounds, random: () => 0, options: { advantage: true } });
    giveAdvantage(referee);
    referee.onGoal();
    expect(referee.update(1, "away")).toBeNull();
    expect(referee.assessTackle({ offender: player("d", "away", 40), victim: player("a", "home", 40), severity: 0.3, possessionTeam: "home" })).toMatchObject({ advantage: false, restart: { kind: "penalty" } });
  });

  it("counts optional finite stoppages once and permits substitution only at legal prototype windows", () => {
    const referee = new RefereeSystem({ bounds });
    referee.recordStoppage(5);
    expect(referee.consumeStoppageSeconds()).toBe(0);
    expect(referee.canSubstitute("halftime")).toBe(false);
    referee.setOptions({ injuryTime: true, substitutions: true });
    for (const seconds of [2, 3, -1, Infinity, NaN]) referee.recordStoppage(seconds);
    expect(referee.consumeStoppageSeconds()).toBe(5);
    expect(referee.consumeStoppageSeconds()).toBe(0);
    expect(referee.canSubstitute("deadBall")).toBe(true);
    expect(referee.canSubstitute("halftime")).toBe(true);
    expect(referee.canSubstitute("playing")).toBe(false);
    expect(referee.canSubstitute("fullTime")).toBe(false);
    expect(() => JSON.stringify(referee.debugSnapshot())).not.toThrow();
  });
});
