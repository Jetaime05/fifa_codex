import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { realMadrid, manCity } from "../../data/teams";
import type { TeamId } from "../../data/types";
import { createInitialMatchState } from "../match/MatchState";
import { kickBall, updateBallPhysics } from "./BallSystem";
import { MatchFlowSystem, type MatchFlowEvent } from "./MatchFlowSystem";
import { MatchRuleSystem } from "./MatchRuleSystem";
import { MatchStatsSystem } from "./MatchStatsSystem";
import { RefereeSystem, type TackleAssessment } from "./RefereeSystem";
import { createRestartPlan, positionRestart, type RestartPlan } from "./RestartSystem";
import type { SimBall, SimPlayer } from "./types";

const bounds = { halfWidth: 36, halfLength: 56 };
const radius = 0.55;
const point = (x: number, z: number, y = radius) => new THREE.Vector3(x, y, z);
const opposite = (team: TeamId): TeamId => team === "home" ? "away" : "home";

/** Rules acceptance harness: deliberately scripted initial kicks/contact scenarios,
 * then real ball physics, boundary adjudication, restart placement and match flow.
 * This is not an AI-performance test; Phase3Acceptance covers autonomous play.
 */
function fixture(duration = 240, advanced = false) {
  const state = createInitialMatchState(duration);
  const flow = new MatchFlowSystem(state, {
    kickoffSeconds: 0.15, goalSeconds: 0.15, halftimeSeconds: 0.25, restartSeconds: 0.15,
    stoppageTimeEnabled: advanced, maxStoppageSeconds: 3
  });
  const stats = new MatchStatsSystem();
  const rules = new MatchRuleSystem(state);
  const referee = new RefereeSystem({ bounds, random: () => 0, options: {
    offside: advanced, advantage: advanced, injuryTime: advanced, substitutions: advanced
  } });
  const players: SimPlayer[] = [realMadrid, manCity].flatMap(team => team.players.map(data => ({
    ...data, id: `${team.id}-${data.number}`, team: team.id,
    position: point(data.formation.x, data.formation.z, 0),
    home: point(data.formation.x, data.formation.z, 0),
    velocity: new THREE.Vector3(), stamina: 1, cooldown: 0, hasBall: false,
    intent: "hold", mesh: new THREE.Group(), body: new THREE.Mesh()
  })));
  const ball: SimBall = { position: point(0, 0), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), mesh: new THREE.Mesh() };
  const events: MatchFlowEvent[] = [];
  const restartKinds: string[] = [];
  let lastTouch: TeamId = "home";
  let kickoffTeam: TeamId = "home";
  let pending: ReturnType<typeof positionRestart> | null = null;
  let pendingPlan: RestartPlan | null = null;
  let invalidValues = 0;

  const setup = (plan: RestartPlan) => {
    pendingPlan = plan;
    pending = positionRestart({ restart: plan, players: players.filter(p => !referee.dismissedIds.has(p.id)), bounds });
    ball.position.copy(pending.ballPosition);
    ball.velocity.set(0, 0, 0);
    ball.spin?.set(0, 0, 0);
    referee.onDeadBall();
  };
  const beginRestart = (plan: RestartPlan) => {
    if (!flow.beginRestart()) return;
    restartKinds.push(plan.kind);
    const stat = { corner: "corners", throwIn: "throwIns", goalKick: "goalKicks" } as const;
    if (plan.kind in stat) stats.record(plan.team, stat[plan.kind as keyof typeof stat]);
    referee.recordStoppage(0.15);
    flow.addStoppageTime(referee.consumeStoppageSeconds());
    setup(plan);
  };
  const release = () => {
    if (!pending || !pendingPlan) throw new Error("Restart released without placement");
    if (!pending.taker) throw new Error("Restart has no eligible taker");
    lastTouch = pendingPlan.team;
    stats.record(lastTouch, pendingPlan.kind === "penalty" ? "shots" : "passes");
    kickBall(ball, pending.target, pendingPlan.kind === "penalty" ? 30 : 14);
    pending = null;
    pendingPlan = null;
    rules.resetGoalLock();
  };
  const step = (dt = 1 / 60) => {
    const wasPlaying = state.status === "playing";
    const elapsedBefore = state.elapsed;
    const transitions = flow.update(dt);
    events.push(...transitions);
    for (const event of transitions) {
      if (event.type === "halftime") {
        referee.onDeadBall();
        ball.velocity.set(0, 0, 0);
      } else if (event.type === "kickoffSetup") {
        if (event.reason === "halftime") kickoffTeam = "away";
        setup(createRestartPlan({ kind: "kickoff", team: kickoffTeam, bounds }));
      } else if (event.type === "kickoffReady" || event.type === "restartReady") release();
      else if (event.type === "fullTime") ball.velocity.set(0, 0, 0);
    }
    if (wasPlaying && state.status === "playing") {
      // Controlled possession segment used only for accounting, not ball motion.
      stats.addPossession(lastTouch, state.elapsed - elapsedBefore);
      updateBallPhysics({ ball, ballOwner: null, dt, bounds, ballRadius: radius, goalWidth: 13.5,
        lastTouchTeam: lastTouch, playerForward: player => point(0, player.team === "home" ? 1 : -1, 0),
        onOutOfPlay: beginRestart,
        onGoal: team => {
          if (!rules.scoreGoal(team)) return;
          stats.record(team, "goals");
          referee.onGoal();
          kickoffTeam = opposite(team);
          flow.beginGoal();
        }
      });
    }
    for (const vector of [ball.position, ball.velocity, ...players.map(player => player.position)]) {
      if (![vector.x, vector.y, vector.z].every(Number.isFinite)) invalidValues++;
    }
  };
  const until = (condition: () => boolean, maxSteps = 20000) => {
    for (let n = 0; n < maxSteps && !condition(); n++) step();
    expect(condition(), `Condition not reached: ${JSON.stringify(flow.debugSnapshot)}`).toBe(true);
  };
  const launch = (position: THREE.Vector3, target: THREE.Vector3, team: TeamId, shot = false) => {
    expect(state.status).toBe("playing");
    ball.position.copy(position);
    lastTouch = team;
    kickBall(ball, target, 24);
    if (shot) stats.record(team, "shots");
  };
  const handleFoul = (assessment: TackleAssessment, offender: SimPlayer) => {
    if (!assessment.foul) return;
    stats.record(offender.team, "fouls");
    if (assessment.card === "yellow" || assessment.card === "secondYellow") stats.record(offender.team, "yellowCards");
    if (assessment.card === "red" || assessment.card === "secondYellow") stats.record(offender.team, "redCards");
    if (assessment.restart) beginRestart(createRestartPlan({ ...assessment.restart, bounds }));
  };
  setup(createRestartPlan({ kind: "kickoff", team: "home", bounds }));
  return { state, flow, stats, referee, rules, players, ball, events, restartKinds,
    step, until, launch, beginRestart, handleFoul, get invalidValues() { return invalidValues; } };
}

describe("Phase 4 integrated rules acceptance", () => {
  it("completes a 240-second match with physical goals, all boundary restarts, pauses and one halftime", () => {
    const game = fixture();
    game.step(0.05);
    const countdown = game.flow.debugSnapshot.countdownSeconds;
    game.flow.pause();
    game.step(10);
    expect(game.state.elapsed).toBe(0);
    expect(game.flow.debugSnapshot.countdownSeconds).toBe(countdown);
    game.flow.resume();
    game.until(() => game.state.status === "playing");

    game.launch(point(36, 0), point(40, 0), "home");
    game.until(() => game.state.status === "restart");
    const stoppedClock = game.state.elapsed;
    game.flow.pause();
    game.step(10);
    game.flow.resume();
    expect(game.state.status).toBe("restart");
    expect(game.state.elapsed).toBe(stoppedClock);
    game.until(() => game.state.status === "playing");
    expect(game.stats.snapshot.away.throwIns).toBe(1);

    game.launch(point(12, 56), point(12, 60), "away");
    game.until(() => game.state.status === "restart");
    expect(game.stats.snapshot.home.corners).toBe(1);
    game.until(() => game.state.status === "playing");
    game.launch(point(12, 56), point(12, 60), "home", true);
    game.until(() => game.state.status === "restart");
    expect(game.stats.snapshot.away.goalKicks).toBe(1);
    game.until(() => game.state.status === "playing");

    game.launch(point(0, 56), point(0, 60), "home", true);
    game.until(() => game.state.status === "goal");
    expect(game.state.score).toEqual({ home: 1, away: 0 });
    expect(game.stats.snapshot.home.goals).toBe(1);
    expect(game.stats.snapshot.home.shots).toBe(2);
    game.until(() => game.state.status === "playing");
    expect(game.events).toContainEqual({ type: "kickoffSetup", reason: "goal" });

    game.until(() => game.state.status === "halftime");
    expect(game.state.elapsed).toBe(120);
    game.until(() => game.state.status === "fullTime");
    expect(game.state.elapsed).toBe(240);
    expect(game.events.filter(event => event.type === "halftime")).toHaveLength(1);
    expect(game.events.filter(event => event.type === "fullTime")).toHaveLength(1);
    expect(game.restartKinds).toEqual(expect.arrayContaining(["throwIn", "corner", "goalKick"]));
    expect(game.invalidValues).toBe(0);
    for (const player of game.players) {
      expect(Math.abs(player.position.x)).toBeLessThan(bounds.halfWidth);
      expect(Math.abs(player.position.z)).toBeLessThan(bounds.halfLength);
    }
    const finalStats = game.stats.snapshot;
    game.step(10);
    expect(game.stats.snapshot).toEqual(finalStats);
    console.log("Phase4 scripted rules match", { score: game.state.score, elapsed: game.state.elapsed,
      restarts: game.restartKinds, halftime: 1, finite: game.invalidValues === 0 });
  });

  it("integrates fouls, second-yellow dismissal, penalty placement and new-match reset", () => {
    const game = fixture(20);
    game.until(() => game.state.status === "playing");
    const offender = game.players.find(player => player.team === "away" && player.role === "DEF")!;
    const victim = game.players.find(player => player.team === "home" && player.role === "FWD")!;
    const foul = (position: THREE.Vector3) => {
      const assessment = game.referee.assessTackle({ offender, victim, position, severity: 0.7, wonBall: false });
      game.handleFoul(assessment, offender);
      return assessment;
    };
    expect(foul(point(0, 0))).toMatchObject({ foul: true, card: "yellow", restart: { kind: "freeKick" } });
    game.until(() => game.state.status === "playing");
    expect(foul(point(0, 50))).toMatchObject({ foul: true, card: "secondYellow", restart: { kind: "penalty" } });
    expect(game.referee.dismissedIds.has(offender.id)).toBe(true);
    expect(game.stats.snapshot.away).toMatchObject({ fouls: 2, yellowCards: 2, redCards: 1 });
    expect(game.ball.position.z).toBeCloseTo(bounds.halfLength * (1 - 11 / 52.5));
    const dismissedPosition = offender.position.clone();
    game.until(() => game.state.status === "playing");
    expect(game.stats.snapshot.home.shots).toBe(1);
    expect(offender.position.equals(dismissedPosition)).toBe(true);
    game.flow.reset();
    game.stats.reset();
    game.referee.reset();
    game.rules.resetGoalLock();
    expect(game.state).toMatchObject({ elapsed: 0, status: "kickoff", score: { home: 0, away: 0 } });
    expect(game.stats.snapshot.away.fouls).toBe(0);
    expect(game.referee.dismissedIds.size).toBe(0);
    expect(game.referee.discipline.size).toBe(0);
  });

  it("applies opt-in offside, recalls advantage, adds bounded injury time and gates substitutions", () => {
    const game = fixture(10, true);
    game.until(() => game.state.status === "playing");
    const passer = game.players.find(player => player.team === "home" && player.role === "MID")!;
    const receiver = game.players.find(player => player.team === "home" && player.role === "FWD")!;
    const offender = game.players.find(player => player.team === "away" && player.role === "DEF")!;
    passer.position.set(0, 0, 20);
    receiver.position.set(0, 0, 40);
    for (const player of game.players.filter(player => player.team === "away")) player.position.z = player.role === "GK" ? 52 : 30;
    game.referee.snapshotPass({ passer, players: game.players, ballPosition: point(0, 20) });
    const offside = game.referee.onTouch(receiver);
    expect(offside).toMatchObject({ kind: "freeKick", team: "away" });
    game.beginRestart(createRestartPlan({ ...offside!, bounds }));
    expect(game.state.status).toBe("restart");
    game.until(() => game.state.status === "playing");

    const advantage = game.referee.assessTackle({ offender, victim: receiver, position: point(0, 20),
      severity: 0.5, possessionTeam: "home" });
    game.handleFoul(advantage, offender);
    expect(advantage).toMatchObject({ foul: true, advantage: true, restart: null });
    expect(game.state.status).toBe("playing");
    const recalled = game.referee.update(0.1, "away");
    expect(recalled).toMatchObject({ kind: "freeKick", team: "home" });
    game.beginRestart(createRestartPlan({ ...recalled!, bounds }));
    game.referee.recordStoppage(100);
    game.flow.addStoppageTime(game.referee.consumeStoppageSeconds());
    expect(game.state.stoppageTime).toBe(3);
    expect(game.referee.canSubstitute("playing")).toBe(false);
    expect(game.referee.canSubstitute("halftime")).toBe(true);
    expect(game.referee.canSubstitute("deadBall")).toBe(true);
    game.until(() => game.state.elapsed >= 10);
    expect(game.state.status).toBe("playing");
    game.until(() => game.state.status === "fullTime");
    expect(game.state.elapsed).toBe(13);
    expect(game.invalidValues).toBe(0);

    game.referee.setOptions({ offside: false, advantage: false, injuryTime: false, substitutions: false });
    game.referee.snapshotPass({ passer, players: game.players, ballPosition: point(0, 20) });
    expect(game.referee.onTouch(receiver)).toBeNull();
    expect(game.referee.canSubstitute("halftime")).toBe(false);
    game.referee.recordStoppage(5);
    expect(game.referee.consumeStoppageSeconds()).toBe(0);
  });
});
