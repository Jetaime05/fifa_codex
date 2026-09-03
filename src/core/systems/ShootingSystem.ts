import * as THREE from "three";
import type { SimBall, SimPlayer } from "./types";
import {
  DEFAULT_SHOOTING_CONFIG,
  type ShootingConfig
} from "./GameplayConfig";
import {
  selectGoalTarget,
  type GoalFrame,
  type GoalTarget
} from "./TargetSelection";
import type { RandomRange } from "./PassingSystem";

const neutralRandom: RandomRange = (min, max) => (min + max) * 0.5;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export type ShotType = "power" | "finesse";

export type ShotTrajectory = {
  type: ShotType;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  direction: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  /** Horizontal curl amount consumed by BallSystem's placeholder Magnus step. */
  curl: number;
  lift: number;
  travelTime: number;
};

export type ShotFeedbackEvent = {
  type: "shot";
  kind: "shot-feedback";
  effect: "power-release" | "finesse-release" | "pressured-release";
  shooterId: string;
  shotType: ShotType;
  power: number;
  accuracy: number;
  pressure: number;
  targetSide: GoalTarget["side"];
  curl: number;
  intensity: number;
  durationMs: number;
  position: THREE.Vector3;
};

export type ShotPlan = {
  shooter: SimPlayer;
  shotType: ShotType;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  selectedTarget: GoalTarget;
  distance: number;
  power: number;
  accuracy: number;
  pressure: number;
  trajectory: ShotTrajectory;
  feedback: ShotFeedbackEvent;
};

/** Result alias for callers that model actions as commands/results. */
export type ShotResult = ShotPlan;

export type ShootingInput = {
  shooter: SimPlayer;
  goal: GoalFrame;
  goalkeeper?: SimPlayer | null;
  opponents?: readonly SimPlayer[];
  ball?: SimBall;
  origin?: THREE.Vector3;
  shotType?: ShotType;
  /** Manual world-space aim; goal selection keeps this as a bias. */
  desiredTarget?: THREE.Vector3;
  preferredSide?: GoalTarget["side"];
  /** 0..1. If omitted, infer it from the nearest opponent. */
  pressure?: number;
  config?: Partial<ShootingConfig>;
  random?: RandomRange;
};

export type ShootingSystemOptions = {
  config?: Partial<ShootingConfig>;
  random?: RandomRange;
};

const withConfig = (config?: Partial<ShootingConfig>): ShootingConfig => ({
  ...DEFAULT_SHOOTING_CONFIG,
  ...config
});

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);

function inferPressure(shooter: SimPlayer, opponents: readonly SimPlayer[]) {
  if (opponents.length === 0) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const opponent of opponents) {
    nearest = Math.min(nearest, horizontalDistance(shooter.position, opponent.position));
  }
  return clamp(1 - nearest / 10, 0, 1);
}

export function calculateShotPressure(shooter: SimPlayer, opponents: readonly SimPlayer[]) {
  return inferPressure(shooter, opponents);
}

/** Power is deliberately above ground-pass speeds for the same distance. */
export function calculateShotPower(
  distance: number,
  shootingStat = 70,
  shotType: ShotType = "power",
  config: Partial<ShootingConfig> = {}
) {
  const tuning = withConfig(config);
  const safeDistance = Math.max(0, distance);
  const safeStat = clamp(shootingStat, 0, 100);
  const base = shotType === "power" ? tuning.powerBase + tuning.powerShotBonus : tuning.finessePowerBase;
  const value = base + safeStat * tuning.statPower + safeDistance * tuning.distancePower;
  return clamp(value, tuning.minPower, shotType === "power" ? tuning.maxPower : tuning.finesseMaxPower);
}

/**
 * Return a probability-like quality score. It is kept separate from random
 * sampling so tests, replays, and difficulty profiles can inspect the same
 * pressure/stat relationship.
 */
export function calculateShotAccuracy(
  distance: number,
  shootingStat = 70,
  pressure = 0,
  shotType: ShotType = "power",
  config: Partial<ShootingConfig> = {}
) {
  const tuning = withConfig(config);
  const safeStat = clamp(shootingStat, 0, 100);
  const safeDistance = Math.max(0, distance);
  const safePressure = clamp(pressure, 0, 1);
  const typePenalty = shotType === "power" ? tuning.powerShotAccuracyPenalty : tuning.finesseAccuracyPenalty;
  return clamp(
    tuning.accuracyBase + safeStat * tuning.statAccuracy - safePressure * tuning.pressureAccuracyPenalty - safeDistance * tuning.distanceAccuracyPenalty - typePenalty,
    0.04,
    0.98
  );
}

/** Aliases make the tuning helpers easy to discover from action code. */
export const calculateShotQuality = calculateShotAccuracy;

function shotForward(shooter: SimPlayer, goal: GoalFrame) {
  const direction = goal.center.clone().sub(shooter.position);
  direction.y = 0;
  if (direction.lengthSq() < 0.000001) direction.set(0, 0, shooter.team === "home" ? 1 : -1);
  return direction.normalize();
}

/** Build a power/finesse plan without mutating the match. */
export function createShotPlan(input: ShootingInput): ShotPlan | null {
  const config = withConfig(input.config);
  const shotType = input.shotType ?? "power";
  const opponents = input.opponents ?? [];
  const origin = (input.ball?.position ?? input.origin ?? input.shooter.position)?.clone();
  if (!origin) return null;
  const pressure = clamp(input.pressure ?? inferPressure(input.shooter, opponents), 0, 1);
  const selectedTarget = selectGoalTarget({
    shooter: input.shooter,
    goal: input.goal,
    goalkeeper: input.goalkeeper,
    desiredTarget: input.desiredTarget,
    preferredSide: input.preferredSide
  });
  const requestedTarget = selectedTarget.position.clone();
  const toTarget = requestedTarget.clone().sub(origin);
  const distance = Math.max(toTarget.length(), 0.05);
  const power = calculateShotPower(distance, input.shooter.stats.shooting, shotType, config);
  const accuracy = calculateShotAccuracy(distance, input.shooter.stats.shooting, pressure, shotType, config);
  const direction = toTarget.normalize();
  const lateral = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
  const random = input.random ?? neutralRandom;
  const errorScale = config.maxAimError * (1 - accuracy) * (0.65 + clamp(distance / 55, 0, 0.7));
  const lateralError = random(-1, 1) * errorScale;
  const verticalError = random(-1, 1) * errorScale * 0.45;
  const finalTarget = requestedTarget.clone().add(lateral.multiplyScalar(lateralError));
  finalTarget.y += verticalError;

  const finalDirection = finalTarget.clone().sub(origin).normalize();
  const velocity = finalDirection.clone().multiplyScalar(power);
  const lift = shotType === "power" ? config.shotLift : config.shotLift * 0.72;
  velocity.y += lift;
  const curlDirection = Math.sign(finalTarget.x - origin.x) || 1;
  const curl = shotType === "finesse" ? config.finesseCurl * curlDirection : 0;
  // spin.x is backspin/lift and spin.y is horizontal curl. BallSystem treats
  // both as placeholders until full Magnus/knuckle physics is introduced.
  const spin = new THREE.Vector3(
    shotType === "power" ? config.powerBackspin : config.powerBackspin * 0.55,
    curl,
    0
  );
  const travelTime = distance / Math.max(power, 0.1);
  const trajectory: ShotTrajectory = {
    type: shotType,
    origin: origin.clone(),
    target: finalTarget.clone(),
    direction: finalDirection.clone(),
    velocity: velocity.clone(),
    spin: spin.clone(),
    curl,
    lift,
    travelTime
  };
  const feedback: ShotFeedbackEvent = {
    type: "shot",
    kind: "shot-feedback",
    effect: pressure > 0.65 ? "pressured-release" : shotType === "power" ? "power-release" : "finesse-release",
    shooterId: input.shooter.id,
    shotType,
    power,
    accuracy,
    pressure,
    targetSide: selectedTarget.side,
    curl,
    intensity: clamp(0.42 + power / Math.max(config.maxPower, 1) * 0.45 + (1 - accuracy) * 0.12, 0, 1),
    durationMs: shotType === "power" ? 340 : 280,
    position: origin.clone()
  };
  return {
    shooter: input.shooter,
    shotType,
    origin: origin.clone(),
    target: finalTarget.clone(),
    selectedTarget,
    distance,
    power,
    accuracy,
    pressure,
    trajectory,
    feedback
  };
}

export const buildShotPlan = createShotPlan;

export function applyShotPlan(ball: SimBall, plan: ShotPlan) {
  ball.velocity.copy(plan.trajectory.velocity);
  if (ball.spin) {
    ball.spin.copy(plan.trajectory.spin);
  }
  return ball;
}

export function executeShot(input: ShootingInput): ShotPlan | null {
  if (!input.ball) return null;
  const plan = createShotPlan(input);
  if (!plan) return null;
  applyShotPlan(input.ball, plan);
  return plan;
}

export class ShootingSystem {
  readonly config: ShootingConfig;
  private readonly random: RandomRange;

  constructor(options: ShootingSystemOptions = {}) {
    this.config = withConfig(options.config);
    this.random = options.random ?? neutralRandom;
  }

  createPlan(input: Omit<ShootingInput, "config" | "random"> & Partial<Pick<ShootingInput, "config" | "random">>) {
    return createShotPlan({ ...input, config: { ...this.config, ...input.config }, random: input.random ?? this.random });
  }

  execute(input: Omit<ShootingInput, "config" | "random"> & Partial<Pick<ShootingInput, "config" | "random">>) {
    if (!input.ball) return null;
    const plan = this.createPlan(input);
    if (!plan) return null;
    applyShotPlan(input.ball, plan);
    return plan;
  }
}
