import * as THREE from "three";
import type { TeamData, TeamId } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";
import { updatePlayerMovement } from "./MovementSystem";
import { DEFAULT_MOVEMENT_CONFIG } from "./MovementSystem";
import { DEFAULT_BALL_PHYSICS_CONFIG } from "./GameplayConfig";
import { getGoalkeeperTargetPosition, type GoalkeeperConfig } from "./GoalkeeperSystem";
import { decideUtilityAI } from "./UtilityAISystem";
import { getAIDifficulty, type AIDifficultyLevel } from "./AIDifficulty";
import { AI_ACTIONS, type AIAction, type AIDecisionResult, type TeamPossessionState } from "./AIDecisionDebug";
import { planBothTeamsSpatialAI, type SpatialAIMetrics } from "./SpatialAISystem";
import { findOpenPassingOptions, analyzePassingLane } from "./PassingLane";
import { getTacticalModifiers, getTacticalPresserLimit, resolveTeamTactics, type RuntimeTeamTacticsByTeam } from "./TacticsSystem";

export type AIContext = {
  players: SimPlayer[]; ball: SimBall; ballOwner: SimPlayer | null; activePlayer: SimPlayer | null;
  teams: Record<TeamId, TeamData>; bounds: FieldBounds; playerRadius: number; dt: number;
  random: (min: number, max: number) => number;
  /**
   * Short lived intent created at pass release. The receiver gets an explicit
   * intercept target so support movement does not immediately pull them back
   * toward their shape anchor while the ball is travelling.
   */
  passIntent?: PassReceiverIntent | null;
  /** Optional Phase 6D runtime tactics keyed by team; omitted preserves Phase 3 behavior. */
  tactics?: RuntimeTeamTacticsByTeam;
  goalkeeperConfig?: Partial<GoalkeeperConfig>;
  /** Dedicated keeper brain owns keeper movement/distribution when true. */
  goalkeepersManagedExternally?: boolean;
  /** Stop a captured update when a callback starts a restart or changes player eligibility. */
  shouldContinue?: () => boolean;
  onPass?: (player: SimPlayer, target?: SimPlayer) => void;
  onShoot?: (player: SimPlayer) => void;
  onClear?: (player: SimPlayer) => void;
  onTackle?: (player: SimPlayer) => void;
};

export type PassReceiverIntent = {
  passerId: string;
  receiverId: string;
  team: TeamId;
  /** Optional snapshot for replay/debug consumers; live interception uses ball velocity. */
  targetPosition?: THREE.Vector3;
  expiresAtMs?: number;
};
export type AIRuntimeDecision = AIDecisionResult & {
  target: { x: number; y: number; z: number }; passTargetId?: string;
  status: "reacting" | "executed" | "cooldown";
};
type PlayerMemory = { decision: AIDecisionResult; target: THREE.Vector3; passTargetId?: string; executed: boolean };
const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const emptyCounts = () => Object.fromEntries(AI_ACTIONS.map((action) => [action, 0])) as Record<AIAction, number>;
const possessionFor = (player: SimPlayer, owner: SimPlayer | null): TeamPossessionState =>
  !owner ? "loose" : owner.id === player.id ? "self" : owner.team === player.team ? "team" : "opponent";

/** Persistent observe -> react -> execute -> cooldown loop. */
export class FootballAISystem {
  private nowMs = 0;
  private possession: string | null = null;
  private activePlayerId: string | null = null;
  private readonly memory = new Map<string, PlayerMemory>();
  private spatial: Record<TeamId, SpatialAIMetrics> | null = null;
  private actionCounts = emptyCounts();
  constructor(private difficulty: AIDifficultyLevel = "normal") {}

  reset(): void {
    this.nowMs = 0; this.possession = null; this.activePlayerId = null;
    this.memory.clear(); this.spatial = null; this.actionCounts = emptyCounts();
  }
  setDifficulty(level: AIDifficultyLevel): void {
    if (level === this.difficulty) return;
    this.difficulty = level;
    this.memory.clear();
  }
  getDebugState(): {
    difficulty: AIDifficultyLevel; nowMs: number; possession: string | null;
    decisions: AIRuntimeDecision[]; spatial: Record<TeamId, SpatialAIMetrics> | null;
    actionCounts: Record<AIAction, number>;
  } {
    return {
      difficulty: this.difficulty, nowMs: this.nowMs, possession: this.possession,
      decisions: [...this.memory.values()].map(({ decision, target, passTargetId, executed }) => ({
        ...decision, target: { x: target.x, y: target.y, z: target.z }, passTargetId,
        status: !executed ? "reacting" : this.nowMs < decision.nextDecisionAtMs ? "cooldown" : "executed"
      })),
      spatial: this.spatial ? { home: { ...this.spatial.home }, away: { ...this.spatial.away } } : null,
      actionCounts: { ...this.actionCounts }
    };
  }

  update(context: AIContext): void {
    if (context.shouldContinue?.() === false) return;
    const { players, ball, ballOwner, activePlayer, teams, bounds } = context;
    const dt = Math.max(0, context.dt);
    if (dt === 0) return;
    this.nowMs += dt * 1000;
    const ownerId = ballOwner?.id ?? null;
    if (ownerId !== this.possession || (activePlayer?.id ?? null) !== this.activePlayerId) this.memory.clear();
    this.possession = ownerId; this.activePlayerId = activePlayer?.id ?? null;
    const plans = planBothTeamsSpatialAI({ players, ballPosition: ball.position, ballOwner, teams, bounds, tactics: context.tactics });
    const passReceiver = context.passIntent && context.passIntent.expiresAtMs !== undefined &&
      this.nowMs > context.passIntent.expiresAtMs
      ? null
      : context.passIntent
        ? players.find((player) => player.id === context.passIntent!.receiverId && player.team === context.passIntent!.team)
        : null;
    const passReceiverTarget = passReceiver && !ballOwner
      ? (() => {
        const ballSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
        // A stationary or nearly settled ball is a collection target. Using
        // the receiver position here made a receiver keep running away from a
        // ball that was already within playing distance.
        if (ballSpeed <= 0.4) return ball.position.clone().setY(0);
        // Search the same exponential trajectory used by BallSystem. Ground
        // passes use rolling friction; aerial actions use air drag. Adding
        // receiver velocity to the target itself used to steer it away from
        // the ball's actual path.
        const grounded = ball.position.y <= DEFAULT_BALL_PHYSICS_CONFIG.radius + 0.08 && Math.abs(ball.velocity.y) < 0.9;
        const dragRate = grounded
          ? DEFAULT_BALL_PHYSICS_CONFIG.groundFrictionPerSecond
          : DEFAULT_BALL_PHYSICS_CONFIG.airDragPerSecond;
        const baseSpeed = DEFAULT_MOVEMENT_CONFIG.walkSpeedBase + passReceiver.stats.pace * DEFAULT_MOVEMENT_CONFIG.paceSpeedScale;
        const staminaMultiplier = passReceiver.stamina < DEFAULT_MOVEMENT_CONFIG.minSprintStamina
          ? DEFAULT_MOVEMENT_CONFIG.exhaustedSprintMultiplier
          : 1;
        const maxSpeed = baseSpeed * DEFAULT_MOVEMENT_CONFIG.sprintMultiplier * staminaMultiplier;
        let best: { point: THREE.Vector3; score: number } | null = null;
        for (let time = 0.06; time <= 1.2; time += 0.06) {
          const travelScale = (1 - Math.exp(-dragRate * time)) / dragRate;
          const point = ball.position.clone().addScaledVector(ball.velocity, travelScale);
          point.y = 0;
          point.x = THREE.MathUtils.clamp(point.x, -bounds.halfWidth + 1.2, bounds.halfWidth - 1.2);
          point.z = THREE.MathUtils.clamp(point.z, -bounds.halfLength + 1.2, bounds.halfLength - 1.2);
          const reachableAt = passReceiver.position.distanceTo(point) / Math.max(maxSpeed, 0.1);
          const latePenalty = Math.max(0, reachableAt - time) * 3.5;
          const score = Math.abs(reachableAt - time) + latePenalty;
          if (!best || score < best.score) best = { point, score };
          if (reachableAt <= time + 0.05) break;
        }
        return best?.point ?? ball.position.clone().setY(0);
      })()
      : null;
    const difficulty = getAIDifficulty(this.difficulty);
    // Reserve AI pressing slots independently of the controlled player. Always
    // send one recovery player even when a loose ball is outside press range.
    for (const teamId of ["home", "away"] as const) {
      const plan = plans[teamId];
      const target = ballOwner?.position ?? ball.position;
      const teamTactics = resolveTeamTactics(context.tactics, teamId);
      const tacticalModifiers = teamTactics ? getTacticalModifiers(teamTactics) : undefined;
      const pressingDistance = teamTactics ? 24 * tacticalModifiers!.pressureDistanceMultiplier : 24;
      const tacticalLimit = teamTactics ? getTacticalPresserLimit(teamTactics, 2) : undefined;
      const ranked = players.filter((p) => p.team === teamId && p.role !== "GK" && p.id !== activePlayer?.id)
        .sort((a, b) => a.position.distanceToSquared(target) - b.position.distanceToSquared(target) || a.id.localeCompare(b.id));
      const pressers = ballOwner?.team !== teamId
        ? ranked
          .filter((p, index) => index === 0 || p.position.distanceTo(target) <= pressingDistance)
          .slice(0, ballOwner ? (tacticalLimit ?? 2) : Math.min(1, tacticalLimit ?? 1))
        : [];
      const ids = new Set(pressers.map((p) => p.id));
      for (const decision of plan.decisions) {
        if (decision.reason === "press" && !ids.has(decision.playerId)) {
          decision.target.copy(plan.shape.targets.find((t) => t.playerId === decision.playerId)!.position);
          decision.reason = "shape"; decision.intent = "return"; decision.sprint = false;
        }
        if (ids.has(decision.playerId)) {
          decision.target.copy(target); decision.reason = "press"; decision.intent = "chase"; decision.sprint = true;
        }
      }
      plan.metrics.presserCount = pressers.length;
    }
    this.spatial = { home: plans.home.metrics, away: plans.away.metrics };
    let actionDispatched = false;
    for (const player of players) {
      if (context.shouldContinue?.() === false) return;
      if (player.id === activePlayer?.id || (player.role === "GK" && context.goalkeepersManagedExternally)) continue;
      player.cooldown = Math.max(0, player.cooldown - dt);
      const spatial = plans[player.team].decisions.find((d) => d.playerId === player.id)!;
      let target = spatial.target.clone();
      let sprint = spatial.sprint;
      player.intent = spatial.intent;
      const isPassReceiver = Boolean(passReceiver && player.id === passReceiver.id && passReceiverTarget);
      if (isPassReceiver) {
        // Receiver movement is a short lived action and should not be hidden
        // by a stale shape target, but keep its utility memory intact so the
        // normal reaction delay is not re-rolled every simulation step.
        target.copy(passReceiverTarget!);
        sprint = true;
        player.intent = "chase";
      }
      if (player.role === "GK") {
        target = getGoalkeeperTargetPosition({ keeper: player, ball, bounds, config: context.goalkeeperConfig });
        if (ballOwner === player && player.cooldown <= 0 && !actionDispatched && context.onPass) {
          context.onPass(player);
          if (context.shouldContinue?.() === false) return;
          player.cooldown = 1.2; this.actionCounts.pass++; actionDispatched = true;
        }
      } else {
        const opponents = players.filter((p) => p.team !== player.team);
        const teammates = players.filter((p) => p.team === player.team);
        const playerTactics = resolveTeamTactics(context.tactics, player.team);
        const playerTacticalModifiers = playerTactics ? getTacticalModifiers(playerTactics) : undefined;
        const passingLaneConfig = playerTactics
          ? {
            minPassDistance: 3 * playerTacticalModifiers!.passDistanceMultiplier,
            maxPassDistance: 35 * playerTacticalModifiers!.passDistanceMultiplier
          }
          : undefined;
        // Pass scoring must use the same live teammate position that the pass
        // executor will receive. Substituting future shape anchors here made
        // AI select a target in one location and release toward another.
        const tacticalTeammates = teammates;
        let memory = this.memory.get(player.id);
        if (!memory || this.nowMs >= memory.decision.nextDecisionAtMs) {
          const direction = teams[player.team].attackingDirection;
          const distanceToGoal = Math.hypot(player.position.x, bounds.halfLength * direction - player.position.z);
          const nearestOpponent = Math.min(40, ...opponents.map((p) => player.position.distanceTo(p.position)));
          const pressure = clamp01(1 - nearestOpponent / 9);
          const options = ballOwner === player
            ? findOpenPassingOptions(player, tacticalTeammates, opponents, direction, passingLaneConfig)
            : [];
          // Progress or escape pressure; avoid endless lateral pass exchanges.
          const pass = options.find((option) => !option.lane.blocked && (option.forwardProgress > 2 || pressure > 0.45));
          const unavailable: AIAction[] = [];
          if (!pass || !context.onPass) unavailable.push("pass");
          if (distanceToGoal > 30 || Math.abs(player.position.x) > 22 || !context.onShoot) unavailable.push("shoot");
          if (!context.onClear) unavailable.push("clear");
          if (spatial.reason !== "press") unavailable.push("press");
          if (spatial.reason === "press") unavailable.push("mark", "hold");
          if (player.cooldown > 0) unavailable.push("pass", "shoot", "clear");
          const decision = decideUtilityAI({
            playerId: player.id, role: player.role, possession: possessionFor(player, ballOwner), nowMs: this.nowMs,
            distanceToGoal, goalAngleQuality: clamp01(1 - Math.abs(player.position.x) / 32), pressure,
            passingLaneQuality: pass ? 1 - pass.lane.risk : 0,
            passTargetOpen: pass ? clamp01(Math.min(12, ...opponents.map((p) => p.position.distanceTo(pass.player.position))) / 8) : 0,
            passProgress: pass ? clamp01(pass.forwardProgress / 24) : 0,
            dribbleSpace: clamp01(nearestOpponent / 10),
            dangerNearOwnGoal: clamp01(1 - (bounds.halfLength + player.position.z * direction) / 25),
            distanceToBall: player.position.distanceTo(ball.position), markThreat: spatial.reason === "mark" ? 0.9 : 0.35,
            shapeError: clamp01(player.position.distanceTo(target) / 25), stamina: player.stamina, stats: player.stats,
            unavailableActions: unavailable
          }, { difficulty, random: () => context.random(0, 1) });
          if (ballOwner === player) {
            const carryDistance = playerTacticalModifiers
              ? THREE.MathUtils.clamp(12 * playerTacticalModifiers.supportForwardMultiplier, 6, 22)
              : 12;
            target.set(player.position.x * 0.45, 0, THREE.MathUtils.clamp(player.position.z + direction * carryDistance, -bounds.halfLength + 2, bounds.halfLength - 2));
            if (decision.action === "hold") target.copy(player.position);
          } else decision.reason += `; ${spatial.reason === "press" && !ballOwner ? "recover loose ball" : spatial.reason} assignment`;
          memory = { decision, target: target.clone(), passTargetId: pass?.player.id, executed: false };
          this.memory.set(player.id, memory);
        }
        const { decision } = memory;
        if (ballOwner === player) target.copy(memory.target);
        else if (!isPassReceiver) memory.target.copy(target);
        if (ballOwner === player) { player.intent = decision.action === "hold" ? "hold" : "support"; sprint = decision.action === "dribble"; }
        if (!memory.executed && this.nowMs >= decision.executeAtMs) {
          const action = decision.action;
          const needsCallback = action === "pass" || action === "shoot" || action === "clear" || action === "press";
          if (!needsCallback || !actionDispatched) {
            memory.executed = true;
            let executed = false;
            if (ballOwner === player && player.cooldown <= 0) {
              if (action === "pass" && context.onPass) {
                const receiver = teammates.find((p) => p.id === memory.passTargetId);
                if (receiver && !analyzePassingLane(player.position, receiver.position, opponents).blocked) {
                  context.onPass(player, receiver);
                  if (context.shouldContinue?.() === false) return;
                  executed = true;
                }
              } else if (action === "shoot" && context.onShoot) {
                context.onShoot(player);
                if (context.shouldContinue?.() === false) return;
                executed = true;
              } else if (action === "clear" && context.onClear) {
                context.onClear(player);
                if (context.shouldContinue?.() === false) return;
                executed = true;
              }
              if (executed) player.cooldown = Math.max(player.cooldown, decision.cooldownMs / 1000);
            }
            if (action === "press" && spatial.reason === "press" && ballOwner && ballOwner.team !== player.team && player.cooldown <= 0 && player.position.distanceTo(ballOwner.position) < 2.7 && context.onTackle) {
              context.onTackle(player);
              if (context.shouldContinue?.() === false) return;
              player.cooldown = Math.max(0.6, decision.cooldownMs / 1000); executed = true;
            }
            if (executed || !needsCallback || action === "press") this.actionCounts[action]++;
            actionDispatched ||= executed;
          }
        }
      }
      if (context.shouldContinue?.() === false) return;
      const movement = target.clone().sub(player.position);
      updatePlayerMovement({ player, inputDirection: movement.length() > 0.8 ? movement : new THREE.Vector3(), sprint, dt, bounds, playerRadius: context.playerRadius, isControlled: false, hasBall: ballOwner === player });
    }
  }
}

const legacySystems = new WeakMap<SimBall, FootballAISystem>();
/** Compatibility helper; callers should own a class instance to reset a match. */
export function updateAI(context: AIContext): void {
  let system = legacySystems.get(context.ball);
  if (!system) { system = new FootballAISystem(); legacySystems.set(context.ball, system); }
  system.update(context);
}
