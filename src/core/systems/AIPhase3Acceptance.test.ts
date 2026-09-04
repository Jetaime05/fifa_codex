import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { manCity, realMadrid } from "../../data/teams";
import type { TeamId } from "../../data/types";
import { SeededRandom } from "../random";
import { FootballAISystem } from "./AISystem";
import type { AIDifficultyLevel } from "./AIDifficulty";
import { kickBall, updateBallPhysics } from "./BallSystem";
import { separatePlayers } from "./CollisionSystem";
import { DribblingSystem } from "./DribblingSystem";
import { FirstTouchSystem } from "./FirstTouchSystem";
import { GoalkeeperSystem, isBallApproachingGoal } from "./GoalkeeperSystem";
import { executePass } from "./PassingSystem";
import { resolvePossession } from "./PossessionSystem";
import { executeShot, type ShotPlan } from "./ShootingSystem";
import type { SimBall, SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };
const teams = { home: realMadrid, away: manCity };
const forward = (player: SimPlayer) => player.velocity.lengthSq() > 0.0225
  ? player.velocity.clone().setY(0).normalize()
  : new THREE.Vector3(0, 0, player.team === "home" ? 1 : -1);

function makePlayers(): SimPlayer[] {
  return [realMadrid, manCity].flatMap((team) => team.players.map((data) => ({
    ...data, id: `${team.id}-${data.number}`, team: team.id,
    position: new THREE.Vector3(data.formation.x, 0, data.formation.z),
    home: new THREE.Vector3(data.formation.x, 0, data.formation.z),
    velocity: new THREE.Vector3(), hasBall: false, stamina: 1, cooldown: 0,
    intent: "hold" as const, mesh: new THREE.Group(), body: new THREE.Mesh()
  })));
}

/** A headless match with the runtime's real action/physics/possession modules.
 * There is no teleported pass reception or scripted shot/goal outcome.
 */
function simulation(seed = 0xdecafbad, difficulty: AIDifficultyLevel = "normal", attackTeam?: TeamId, dt = 1 / 60) {
  const players = makePlayers();
  const ai = new FootballAISystem(difficulty);
  const keeperBrain = new GoalkeeperSystem(difficulty === "easy"
    ? { reactionBase: 0.57, distributionHoldMin: 0.65, distributionHoldMax: 1.65 }
    : difficulty === "hard" ? { reactionBase: 0.32, distributionHoldMin: 0.3, distributionHoldMax: 0.95 } : {});
  const dribbling = new DribblingSystem();
  const firstTouch = new FirstTouchSystem();
  const rng = new SeededRandom(seed);
  const random = (min: number, max: number) => rng.range(min, max);
  // An out-of-squad sentinel gives both teams AI control without changing gameplay.
  const activePlayer = { ...players[0], id: "spectator" };
  const ball: SimBall = { position: new THREE.Vector3(0, 0.55, 0), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), mesh: new THREE.Mesh() };
  let owner: SimPlayer | null = null;
  let pendingPass: SimPlayer | null = null;
  let pendingShot: ShotPlan | null = null;
  let keeperAttempted = false;
  let lockedId = "";
  let lockedUntil = 0;
  let time = 0;
  const keeperDistributionDelays = new Map<string, number>();
  const stats = { passes: 0, completedPasses: 0, shots: 0, goals: 0, saves: 0, maxPressers: 0, maxSpeed: 0, invalidValues: 0, reasons: new Set<string>() };
  const attach = (player: SimPlayer) => {
    lockedId = "";
    lockedUntil = 0;
    if (pendingPass && pendingPass !== player && pendingPass.team === player.team) stats.completedPasses++;
    pendingPass = null;
    pendingShot = null;
    owner = player;
    for (const p of players) p.hasBall = p === player;
  };
  const release = (player: SimPlayer, kicked = false) => {
    if (kicked) { lockedId = player.id; lockedUntil = time + 0.22; }
    owner = null;
    player.hasBall = false;
  };
  const pass = (player: SimPlayer, target?: SimPlayer) => {
    if (owner !== player) return;
    const plan = executePass({ passer: player, intendedTarget: target, teammates: players.filter(p => p.team === player.team && p !== player), opponents: players.filter(p => p.team !== player.team), ball, desiredDirection: forward(player), random });
    if (!plan) return;
    release(player, true);
    pendingPass = player;
    pendingShot = null;
    stats.passes++;
  };
  const shoot = (player: SimPlayer) => {
    if (owner !== player) return;
    const opponents = players.filter(p => p.team !== player.team);
    const plan = executeShot({ shooter: player, opponents, goalkeeper: opponents.find(p => p.role === "GK"), ball, goal: { center: new THREE.Vector3(0, 2, player.team === "home" ? 57.4 : -57.4), width: 13.5, height: 4 }, random });
    if (!plan) return;
    release(player, true);
    pendingPass = null;
    pendingShot = plan;
    keeperAttempted = false;
    stats.shots++;
  };
  const clear = (player: SimPlayer) => {
    if (owner !== player) return;
    release(player, true);
    pendingPass = null;
    pendingShot = null;
    kickBall(ball, player.position.clone().add(new THREE.Vector3(random(-14, 14), 2.5, player.team === "home" ? 34 : -34)), 30, 2.8);
  };
  const reset = (team: TeamId = "home", afterGoal = false) => {
    for (const p of players) {
      p.position.copy(p.home); p.velocity.set(0, 0, 0); p.cooldown = 0;
      p.stamina = afterGoal ? Math.min(1, p.stamina + 0.18) : 1;
    }
    lockedId = "";
    lockedUntil = 0;
    keeperDistributionDelays.clear();
    const striker = players.find(p => p.team === team && p.number === 9)!;
    if (attackTeam) {
      striker.position.set(0, 0, team === "home" ? 38 : -38);
      // A reproducible breakaway: defenders trail the striker, with a live keeper.
      for (const p of players.filter(p => p.team !== team && p.role !== "GK")) p.position.z = team === "home" ? 10 : -10;
    }
    if (attackTeam) {
      attach(striker);
      ball.position.copy(striker.position).add(new THREE.Vector3(0, 0.55, team === "home" ? 1 : -1));
    } else {
      owner = null;
      pendingPass = null;
      pendingShot = null;
      for (const p of players) p.hasBall = false;
      ball.position.set(0, 0.55, 0);
    }
    ball.velocity.set(0, 0, 0);
    ball.spin?.set(0, 0, 0);
    ai.reset();
  };
  const attemptSave = (team: TeamId) => {
    const shot = pendingShot;
    if (!shot || shot.shooter.team !== team || keeperAttempted) return false;
    const keeper = players.find(p => p.team !== team && p.role === "GK")!;
    keeperAttempted = true;
    const result = keeperBrain.resolveShot(keeper, { origin: shot.origin, target: shot.target, velocity: shot.trajectory.velocity, power: shot.power, quality: Math.min(1, shot.power / 54 * 0.58 + shot.accuracy * 0.42), shooter: shot.shooter }, random);
    if (!result.saved) return false;
    stats.saves++;
    pendingShot = null;
    const awayFromGoal = keeper.team === "home" ? 1 : -1;
    ball.position.copy(keeper.position).add(new THREE.Vector3(0, 0.55, awayFromGoal * 0.8));
    if (result.outcome === "save") attach(keeper);
    else { owner = null; ball.velocity.set(random(-3.5, 3.5), 3.2, awayFromGoal * 8.5); ball.spin?.set(0, 0, 0); }
    return true;
  };
  reset(attackTeam);
  const step = () => {
    time += dt;
    ai.update({ players, goalkeepersManagedExternally: true, ball, ballOwner: owner, activePlayer, teams, bounds, playerRadius: 0.75, dt, random,
      onPass: pass, onShoot: shoot, onClear: clear,
      onTackle: (player) => {
        if (!owner || player.team === owner.team || player.position.distanceTo(owner.position) >= 3.2) return;
        const success = player.stats.defending + player.stats.physical * 0.4 + random(0, 35);
        const resistance = owner.stats.dribbling + owner.stats.physical * 0.28 + random(0, 35);
        if (success > resistance) attach(player);
        else { const previous = owner; ball.velocity.copy(previous.position).sub(player.position).normalize().multiplyScalar(9); release(previous); pendingPass = null; pendingShot = null; }
      }
    });
    for (const keeper of players.filter(p => p.role === "GK")) {
      keeperBrain.updateMovement({ keeper, ball, bounds, dt, playerRadius: 0.75 });
      if (owner !== keeper) { keeperDistributionDelays.delete(keeper.id); keeper.cooldown = Math.max(0, keeper.cooldown - dt); continue; }
      const teammates = players.filter(p => p.team === keeper.team);
      const opponents = players.filter(p => p.team !== keeper.team);
      const remaining = (keeperDistributionDelays.get(keeper.id) ?? keeperBrain.chooseDistribution(keeper, teammates, opponents).releaseDelay) - dt;
      keeperDistributionDelays.set(keeper.id, remaining);
      if (remaining > 0) continue;
      const distribution = keeperBrain.chooseDistribution(keeper, teammates, opponents);
      keeperDistributionDelays.delete(keeper.id);
      if (distribution.target) pass(keeper, distribution.target); else clear(keeper);
      keeper.cooldown = 1.2;
    }
    if (owner) {
      const result = dribbling.update({ player: owner, ball, dt, sprint: owner.velocity.length() > 8.8, playerForward: forward, random: () => rng.next() });
      if (result.shouldReleaseBall) { release(owner); pendingPass = null; pendingShot = null; }
    }
    if (!owner) updateBallPhysics({ ball, ballOwner: null, dt, bounds, ballRadius: 0.55, goalWidth: 13.5, playerForward: forward,
      onGoal: (team) => {
        if (attemptSave(team)) return;
        stats.goals++;
        reset(attackTeam ?? (team === "home" ? "away" : "home"), true);
      }
    });
    let saved = false;
    if (pendingShot && !isBallApproachingGoal(ball, pendingShot.shooter.team === "home" ? "away" : "home")) pendingShot = null;
    if (pendingShot) {
      const keeper = players.find(p => p.role === "GK" && p.team !== pendingShot!.shooter.team)!;
      if (ball.position.y < 4.8 && keeper.position.distanceTo(ball.position) < 3.8) saved = attemptSave(pendingShot.shooter.team);
    }
    const resolution = saved ? null : resolvePossession({ players, homePlayers: players.filter(p => p.team === "home"), awayPlayers: players.filter(p => p.team === "away"), activePlayer, ballOwner: owner, ballPosition: ball.position, random, excludedPlayerIds: [...(time < lockedUntil ? [lockedId] : []), ...(pendingShot ? players.filter(p => p.role === "GK").map(p => p.id) : [])] });
    if (resolution) {
      if (owner || firstTouch.update({ player: resolution.owner, ball, incomingVelocity: ball.velocity, controlDirection: forward(resolution.owner), random: () => rng.next() }).retained) attach(resolution.owner);
      else pendingShot = null;
    }
    separatePlayers({ players, activePlayer, playerRadius: 0.75 });
    const debug = ai.getDebugState();
    if (debug.spatial) stats.maxPressers = Math.max(stats.maxPressers, debug.spatial.home.presserCount, debug.spatial.away.presserCount);
    for (const decision of debug.decisions) stats.reasons.add(decision.reason);
    for (const player of players) stats.maxSpeed = Math.max(stats.maxSpeed, player.velocity.length());
    if (![...ball.position.toArray(), ...ball.velocity.toArray(), ...players.flatMap(p => [...p.position.toArray(), ...p.velocity.toArray()])].every(Number.isFinite)) stats.invalidValues++;
  };
  const runClockFrames = (frames: number) => {
    for (let frame = 0; frame < frames; frame++) step();
    return stats;
  };
  return {
    ai, players, ball, stats, step, runClockFrames,
    get simulationSeconds() { return time; },
    run(seconds: number) { return runClockFrames(Math.round(seconds / dt)); }
  };
}

describe("Phase 3 headless acceptance", () => {
  it("plays 240 simulated seconds from loose midfield ball with completed passes, shots, bounded pressing and finite state", () => {
    const match = simulation();
    const stats = match.run(240);
    console.info("Phase3 240s match", { ...stats, reasons: stats.reasons.size });
    expect(stats.passes).toBeGreaterThan(0);
    expect(stats.completedPasses).toBeGreaterThan(0);
    expect(stats.shots).toBeGreaterThan(0);
    expect(stats.goals).toBeGreaterThan(0);
    expect(stats.maxPressers).toBeLessThanOrEqual(2);
    expect(stats.invalidValues).toBe(0);
    expect(stats.maxSpeed).toBeLessThanOrEqual((6.2 + 97 * 0.052) * 1.4 + 1e-8);
    expect(stats.reasons.size).toBeGreaterThan(3);
  }, 60_000);

  it("plays 240 clock seconds at the runtime 1.55x simulation timestep", () => {
    const match = simulation(0xdecafbad, "normal", undefined, 1 / 60 * 1.55);
    const stats = match.runClockFrames(240 * 60);
    console.info("Phase3 runtime timestep: 240 clock seconds / 372 simulation seconds", { ...stats, reasons: stats.reasons.size });
    expect(match.simulationSeconds).toBeCloseTo(372, 6);
    expect(stats.passes).toBeGreaterThan(0);
    expect(stats.completedPasses).toBeGreaterThan(0);
    expect(stats.shots).toBeGreaterThan(0);
    expect(stats.goals).toBeGreaterThan(0);
    expect(stats.maxPressers).toBeLessThanOrEqual(2);
    expect(stats.invalidValues).toBe(0);
    expect(stats.maxSpeed).toBeLessThanOrEqual((6.2 + 97 * 0.052) * 1.4 + 1e-8);
    expect(stats.reasons.size).toBeGreaterThan(3);
  }, 60_000);

  it.each(["home", "away"] as const)("converts %s breakaways across fixed seeds using real shots and goalkeeper rolls", (team) => {
    // A keeper may legitimately save every shot in one trial; assess the same
    // predeclared seed batch in both directions without weakening physical saves.
    const samples = [1789, 42, 0xdecafbad].map(seed => simulation(seed, "hard", team).run(40));
    console.info(`Phase3 ${team} breakaway batch`, samples.map(stats => ({ ...stats, reasons: stats.reasons.size })));
    for (const stats of samples) {
      expect(stats.shots).toBeGreaterThan(0);
      expect(stats.invalidValues).toBe(0);
      expect(stats.maxPressers).toBeLessThanOrEqual(2);
    }
    expect(samples.reduce((sum, stats) => sum + stats.goals, 0)).toBeGreaterThan(0);
  }, 30_000);

  it("replays identical seeded simulation state", () => {
    const first = simulation(923);
    const second = simulation(923);
    expect(first.run(10)).toEqual(second.run(10));
    expect(first.ball.position.toArray()).toEqual(second.ball.position.toArray());
    expect(first.players.map(player => player.position.toArray())).toEqual(second.players.map(player => player.position.toArray()));
  });

  it("hard difficulty reacts sooner without changing initial movement speed", () => {
    const easy = simulation(42, "easy", "home");
    const hard = simulation(42, "hard", "home");
    easy.step(); hard.step();
    const easyDecision = easy.ai.getDebugState().decisions.find(d => d.playerId === "home-9")!;
    const hardDecision = hard.ai.getDebugState().decisions.find(d => d.playerId === "home-9")!;
    expect(easyDecision.reactionDelayMs).toBeGreaterThan(hardDecision.reactionDelayMs);
    const easyPlayer = easy.players.find(p => p.id === "home-9")!;
    const hardPlayer = hard.players.find(p => p.id === "home-9")!;
    expect(easyPlayer.velocity.length()).toBeCloseTo(hardPlayer.velocity.length(), 8);
  });
});
