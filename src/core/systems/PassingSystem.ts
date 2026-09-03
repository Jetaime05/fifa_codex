import * as THREE from "three";
import type { SimBall, SimPlayer } from "./types";
import {
  DEFAULT_PASSING_CONFIG,
  type PassingConfig
} from "./GameplayConfig";
import {
  distanceToPassLane,
  rankPassTargets,
  selectPassTarget,
  type PassTargetScore
} from "./TargetSelection";

export type RandomRange = (min: number, max: number) => number;

const neutralRandom: RandomRange = (min, max) => (min + max) * 0.5;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export type PassStyle = "ground";

export type PassInterceptionThreat = {
  defenderId: string;
  /** Time at which this defender can reach the pass lane point. */
  timeToIntercept: number;
  /** Time at which the ball reaches the same point. */
  ballTime: number;
  progress: number;
  point: THREE.Vector3;
  lateralDistance: number;
  margin: number;
  risk: number;
};

/**
 * Stable contract for defensive AI and debug/replay tooling. A pass can carry
 * this object to a defender without the defender needing to reproduce the
 * trajectory math.
 */
export type PassInterceptionWindow = {
  corridorWidth: number;
  startTime: number;
  endTime: number;
  duration: number;
  earliestTime: number | null;
  latestTime: number | null;
  interceptorId: string | null;
  interceptable: boolean;
  risk: number;
  threats: ReadonlyArray<PassInterceptionThreat>;
};

export type PassFeedbackEvent = {
  /** MatchEvent-compatible action type. */
  type: "pass";
  kind: "pass-feedback";
  effect: "pass-release" | "pass-risk";
  passerId: string;
  targetId: string;
  style: PassStyle;
  distance: number;
  strength: number;
  assist: number;
  pressure: number;
  interceptionRisk: number;
  intensity: number;
  durationMs: number;
  position: THREE.Vector3;
};

export type GroundPassTrajectory = {
  style: "ground";
  origin: THREE.Vector3;
  target: THREE.Vector3;
  direction: THREE.Vector3;
  velocity: THREE.Vector3;
  travelTime: number;
  lift: number;
  leadDistance: number;
};

export type PassPlan = {
  style: PassStyle;
  passer: SimPlayer;
  target: SimPlayer;
  targetScore: PassTargetScore | null;
  origin: THREE.Vector3;
  requestedTarget: THREE.Vector3;
  distance: number;
  strength: number;
  assist: number;
  pressure: number;
  trajectory: GroundPassTrajectory;
  interception: PassInterceptionWindow;
  feedback: PassFeedbackEvent;
};

/** Result alias for callers that model actions as commands/results. */
export type PassResult = PassPlan;

export type PassingInput = {
  passer: SimPlayer;
  teammates: readonly SimPlayer[];
  opponents?: readonly SimPlayer[];
  ball?: SimBall;
  /** Optional origin for pure planning; ball.position wins when provided. */
  origin?: THREE.Vector3;
  /** A manually locked target is kept; otherwise target scoring picks one. */
  intendedTarget?: SimPlayer | null;
  /** Stick/aim direction used by target selection when no target is locked. */
  desiredDirection?: THREE.Vector3;
  assist?: number;
  /** 0..1. If omitted, infer it from the nearest opponent. */
  pressure?: number;
  config?: Partial<PassingConfig>;
  random?: RandomRange;
};

export type PassingSystemOptions = {
  config?: Partial<PassingConfig>;
  random?: RandomRange;
};

const withConfig = (config?: Partial<PassingConfig>): PassingConfig => ({
  ...DEFAULT_PASSING_CONFIG,
  ...config
});

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const horizontalVelocityLength = (player: SimPlayer) => Math.hypot(player.velocity.x, player.velocity.z);

function inferPressure(passer: SimPlayer, opponents: readonly SimPlayer[]) {
  if (opponents.length === 0) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const opponent of opponents) {
    nearest = Math.min(nearest, horizontalDistance(passer.position, opponent.position));
  }
  return clamp(1 - nearest / 9, 0, 1);
}

/** Pass speed grows with distance, with a modest passing-stat contribution. */
export function calculatePassStrength(
  distance: number,
  passingStat = 70,
  config: Partial<PassingConfig> = {}
) {
  const tuning = withConfig(config);
  const safeDistance = Math.max(0, distance);
  const safeStat = clamp(passingStat, 0, 100);
  return clamp(
    tuning.baseSpeed + safeDistance * tuning.distanceSpeed + safeStat * tuning.passingStatSpeed,
    tuning.minSpeed,
    tuning.maxSpeed
  );
}

/** Alias useful to callers that think of the result as pass power. */
export const calculatePassPower = calculatePassStrength;

export function calculatePassPressure(passer: SimPlayer, opponents: readonly SimPlayer[]) {
  return inferPressure(passer, opponents);
}

function passForward(passer: SimPlayer) {
  const direction = new THREE.Vector3(0, 0, passer.team === "home" ? 1 : -1);
  const velocity = passer.velocity.clone();
  velocity.y = 0;
  if (velocity.lengthSq() > 0.0225) direction.copy(velocity.normalize());
  return direction;
}

function resolveTarget(input: PassingInput, assist: number): { target: SimPlayer | null; score: PassTargetScore | null } {
  if (input.intendedTarget && input.intendedTarget !== input.passer && input.intendedTarget.team === input.passer.team) {
    const ranked = rankPassTargets({
      passer: input.passer,
      teammates: input.teammates,
      opponents: input.opponents,
      forward: passForward(input.passer),
      desiredDirection: input.desiredDirection,
      assist
    });
    return {
      target: input.intendedTarget,
      score: ranked.find((item) => item.player === input.intendedTarget) ?? null
    };
  }

  const ranked = rankPassTargets({
    passer: input.passer,
    teammates: input.teammates,
    opponents: input.opponents,
    forward: passForward(input.passer),
    desiredDirection: input.desiredDirection,
    assist
  });
  return { target: selectPassTarget({
    passer: input.passer,
    teammates: input.teammates,
    opponents: input.opponents,
    forward: passForward(input.passer),
    desiredDirection: input.desiredDirection,
    assist
  }), score: ranked[0] ?? null };
}

/**
 * Build a ground-pass plan without mutating the match. This is the main
 * deterministic contract for input, AI, and replay code.
 */
export function createPassPlan(input: PassingInput): PassPlan | null {
  const config = withConfig(input.config);
  const opponents = input.opponents ?? [];
  const assist = clamp(input.assist ?? config.assist, 0, 1);
  const pressure = clamp(input.pressure ?? inferPressure(input.passer, opponents), 0, 1);
  const origin = (input.ball?.position ?? input.origin)?.clone();
  if (!origin) return null;

  const resolved = resolveTarget(input, assist);
  if (!resolved.target) return null;
  const target = resolved.target;
  const initialDistance = Math.max(horizontalDistance(origin, target.position), 0.05);
  const initialStrength = calculatePassStrength(initialDistance, input.passer.stats.passing, config);
  const initialTravelTime = initialDistance / Math.max(initialStrength, 0.1);
  const requestedTarget = target.position.clone().add(
    target.velocity.clone().multiplyScalar(initialTravelTime * clamp(config.targetLead, 0, 1.5))
  );
  requestedTarget.y = origin.y;

  const line = new THREE.Vector3(requestedTarget.x - origin.x, 0, requestedTarget.z - origin.z);
  const distance = Math.max(line.length(), 0.05);
  const strength = calculatePassStrength(distance, input.passer.stats.passing, config);
  const direction = line.normalize();
  const lateral = new THREE.Vector3(-direction.z, 0, direction.x);
  const passingQuality = clamp(input.passer.stats.passing / 100, 0, 1);
  const errorMagnitude = config.maxAimError * (1 - assist) * (1 - passingQuality * 0.65) + pressure * config.pressureError;
  const random = input.random ?? neutralRandom;
  const aimError = random(-1, 1) * errorMagnitude;
  const finalTarget = requestedTarget.clone().add(lateral.multiplyScalar(aimError));
  finalTarget.y = origin.y;

  const finalLine = new THREE.Vector3(finalTarget.x - origin.x, 0, finalTarget.z - origin.z);
  const finalDistance = Math.max(finalLine.length(), 0.05);
  const finalDirection = finalLine.normalize();
  const lift = clamp(config.groundLift + pressure * 0.035, 0, config.maxGroundLift);
  const velocity = finalDirection.clone().multiplyScalar(strength);
  velocity.y = lift;
  const travelTime = finalDistance / Math.max(strength, 0.1);
  const trajectory: GroundPassTrajectory = {
    style: "ground",
    origin: origin.clone(),
    target: finalTarget.clone(),
    direction: finalDirection.clone(),
    velocity: velocity.clone(),
    travelTime,
    lift,
    leadDistance: horizontalDistance(target.position, requestedTarget)
  };
  const interception = calculatePassInterceptionWindow({
    origin,
    target: finalTarget,
    velocity,
    opponents,
    corridorWidth: config.interceptionCorridor,
    reactionTime: config.interceptionReactionTime
  });
  const feedback: PassFeedbackEvent = {
    type: "pass",
    kind: "pass-feedback",
    effect: interception.interceptable || pressure > 0.65 ? "pass-risk" : "pass-release",
    passerId: input.passer.id,
    targetId: target.id,
    style: "ground",
    distance: finalDistance,
    strength,
    assist,
    pressure,
    interceptionRisk: Math.max(interception.risk, pressure * 0.45),
    intensity: clamp(0.3 + strength / Math.max(config.maxSpeed, 1) * 0.45 + pressure * 0.25, 0, 1),
    durationMs: interception.interceptable ? 260 : 180,
    position: origin.clone()
  };
  return {
    style: "ground",
    passer: input.passer,
    target,
    targetScore: resolved.score,
    origin: origin.clone(),
    requestedTarget: finalTarget.clone(),
    distance: finalDistance,
    strength,
    assist,
    pressure,
    trajectory,
    interception,
    feedback
  };
}

export const buildPassPlan = createPassPlan;

export type PassInterceptionInput = {
  origin: THREE.Vector3;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  opponents: readonly SimPlayer[];
  corridorWidth?: number;
  reactionTime?: number;
};

/**
 * Evaluate a defender's intercept window against the pass segment. The check
 * is intentionally cheap and deterministic: it samples each defender's
 * closest point on the corridor and compares arrival time with ball time.
 */
export function calculatePassInterceptionWindow(input: PassInterceptionInput): PassInterceptionWindow {
  const corridorWidth = Math.max(0.1, input.corridorWidth ?? DEFAULT_PASSING_CONFIG.interceptionCorridor);
  const reactionTime = Math.max(0, input.reactionTime ?? DEFAULT_PASSING_CONFIG.interceptionReactionTime);
  const horizontal = new THREE.Vector3(input.target.x - input.origin.x, 0, input.target.z - input.origin.z);
  const distance = horizontal.length();
  const speed = Math.max(Math.hypot(input.velocity.x, input.velocity.z), 0.1);
  const totalTime = distance / speed;
  const threats: PassInterceptionThreat[] = [];
  for (const defender of input.opponents) {
    const progress = distance < 0.000001
      ? 0
      : clamp((new THREE.Vector3(defender.position.x - input.origin.x, 0, defender.position.z - input.origin.z).dot(horizontal)) / (distance * distance), 0, 1);
    const point = input.origin.clone().lerp(input.target, progress);
    const lateralDistance = distanceToPassLane(defender.position, input.origin, input.target);
    if (lateralDistance > corridorWidth * 2.5) continue;
    const ballTime = totalTime * progress;
    const defenderSpeed = Math.max(horizontalVelocityLength(defender), 1.5);
    const arrivalDistance = horizontalDistance(defender.position, point);
    const timeToIntercept = arrivalDistance / defenderSpeed + reactionTime;
    const margin = ballTime + 0.18 - timeToIntercept;
    if (margin < 0 || lateralDistance > corridorWidth) continue;
    const risk = clamp((1 - lateralDistance / corridorWidth) * 0.58 + clamp(margin / 0.65, 0, 1) * 0.42, 0, 1);
    threats.push({
      defenderId: defender.id,
      timeToIntercept,
      ballTime,
      progress,
      point,
      lateralDistance,
      margin,
      risk
    });
  }
  threats.sort((a, b) => a.ballTime - b.ballTime || b.risk - a.risk || a.defenderId.localeCompare(b.defenderId));
  const first = threats[0];
  const last = threats[threats.length - 1];
  const startTime = first ? Math.max(0, first.ballTime - reactionTime) : 0;
  const endTime = last ? Math.min(totalTime, last.ballTime + 0.18) : 0;
  return {
    corridorWidth,
    startTime,
    endTime,
    duration: Math.max(0, endTime - startTime),
    earliestTime: first?.ballTime ?? null,
    latestTime: last?.ballTime ?? null,
    interceptorId: first?.defenderId ?? null,
    interceptable: threats.length > 0,
    risk: threats.reduce((max, threat) => Math.max(max, threat.risk), 0),
    threats
  };
}

export const evaluatePassInterception = calculatePassInterceptionWindow;

/** Apply only the physical part of a plan; feedback is left to the caller. */
export function applyPassPlan(ball: SimBall, plan: PassPlan) {
  ball.velocity.copy(plan.trajectory.velocity);
  if (ball.spin) ball.spin.set(0, 0, 0);
  return ball;
}

/** Build and apply a pass in one call when the orchestrator owns the ball. */
export function executePass(input: PassingInput): PassPlan | null {
  if (!input.ball) return null;
  const plan = createPassPlan(input);
  if (!plan) return null;
  applyPassPlan(input.ball, plan);
  return plan;
}

/** Stateful facade for an orchestrator that prefers one injected system. */
export class PassingSystem {
  readonly config: PassingConfig;
  private readonly random: RandomRange;

  constructor(options: PassingSystemOptions = {}) {
    this.config = withConfig(options.config);
    this.random = options.random ?? neutralRandom;
  }

  createPlan(input: Omit<PassingInput, "config" | "random"> & Partial<Pick<PassingInput, "config" | "random">>) {
    return createPassPlan({ ...input, config: { ...this.config, ...input.config }, random: input.random ?? this.random });
  }

  execute(input: Omit<PassingInput, "config" | "random"> & Partial<Pick<PassingInput, "config" | "random">>) {
    if (!input.ball) return null;
    const plan = this.createPlan(input);
    if (!plan) return null;
    applyPassPlan(input.ball, plan);
    return plan;
  }
}
