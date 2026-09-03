import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";
import { updatePlayerMovement } from "./MovementSystem";
import {
  DEFAULT_GOALKEEPER_CONFIG,
  resolveGoalkeeperConfig,
  type GoalkeeperConfig,
  type GoalkeeperRandom
} from "./GoalkeeperConfig";

export { DEFAULT_GOALKEEPER_CONFIG, resolveGoalkeeperConfig } from "./GoalkeeperConfig";
export type { GoalkeeperConfig, GoalkeeperRandom } from "./GoalkeeperConfig";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type GoalkeeperGoalInput = {
  keeper: SimPlayer;
  ball: SimBall;
  bounds: FieldBounds;
  config?: Partial<GoalkeeperConfig>;
};

export type KeeperShot = {
  /** World-space point from which the shot was struck. */
  origin: THREE.Vector3;
  /** World-space intended impact point, normally just beyond the goal line. */
  target: THREE.Vector3;
  /** Optional velocity lets the system estimate travel/reaction time. */
  velocity?: THREE.Vector3;
  /** Optional kick power in the same loose 0-45 range as the POC. */
  power?: number;
  /** Explicit danger rating, where 0 is a poor shot and 1 is elite. */
  quality?: number;
  shooter?: Pick<SimPlayer, "stats">;
};

export type KeeperSaveHorizontal = "center" | "near" | "far";
export type KeeperSaveVertical = "low" | "middle" | "high";
export type KeeperSaveZone =
  | "central"
  | "low-central"
  | "high-central"
  | "near-post"
  | "far-post";

export type KeeperSaveZoneResult = {
  zone: KeeperSaveZone;
  horizontal: KeeperSaveHorizontal;
  vertical: KeeperSaveVertical;
  normalizedX: number;
  normalizedY: number;
};

export type KeeperDiveDirection = "left" | "right" | "up" | "down" | "center";
export type KeeperReactionAction = "hold" | "claim" | "dive";

/**
 * This is intentionally a gameplay contract, not an animation implementation.
 * Rendering can map `direction` and `duration` to a real dive later.
 */
export type KeeperDivePlan = {
  action: KeeperReactionAction;
  direction: KeeperDiveDirection;
  zone: KeeperSaveZoneResult;
  targetPosition: THREE.Vector3;
  shotQuality: number;
  saveProbability: number;
  reactionTime: number;
  travelTime: number;
  duration: number;
};

export type KeeperSaveOutcome = "save" | "parry" | "goal";

export type KeeperSaveResult = {
  outcome: KeeperSaveOutcome;
  saved: boolean;
  probability: number;
  roll: number;
  plan: KeeperDivePlan;
};

export type KeeperDistributionMode = "short" | "long" | "clearance";

export type KeeperDistributionChoice = {
  mode: KeeperDistributionMode;
  /** Null means the keeper should clear into space rather than pass to a player. */
  target: SimPlayer | null;
  targetPosition: THREE.Vector3 | null;
  score: number;
  pressure: number;
  reason: string;
};

function goalSide(team: TeamId): -1 | 1 {
  return team === "home" ? -1 : 1;
}

export function getGoalLineZ(team: TeamId, bounds: FieldBounds) {
  return goalSide(team) * bounds.halfLength;
}

/**
 * Positions a keeper on the line joining the goal centre and the ball.  The
 * keeper steps out as the ball enters the attacking third, while the lateral
 * position is clamped to a playable part of the goal mouth.
 */
export function getGoalkeeperTargetPosition({ keeper, ball, bounds, config: overrides }: GoalkeeperGoalInput) {
  const config = resolveGoalkeeperConfig(overrides);
  const side = goalSide(keeper.team);
  const goalZ = side * bounds.halfLength;
  // `side` points from the pitch towards the defended goal. Multiplying the
  // goal-to-ball vector by it gives a positive in-field distance for both
  // home (negative z goal) and away (positive z goal) keepers.
  const distanceFromGoal = Math.max(0, (goalZ - ball.position.z) * side);
  const threat = clamp(1 - distanceFromGoal / Math.max(1, config.maxThreatDistance), 0, 1);
  const baseAdvance = Math.max(config.minAdvance, config.goalLineInset);
  const advance = clamp(
    baseAdvance + threat * (config.maxAdvance - baseAdvance),
    baseAdvance,
    config.maxAdvance
  );
  const lineZ = goalZ - side * advance;

  // Similar-triangle projection gives the keeper the correct angle instead of
  // simply mirroring the ball's x coordinate when the ball is far away.
  const projection = clamp(advance / Math.max(advance, distanceFromGoal), 0, 1);
  const angledX = ball.position.x * projection;
  const trackedX = THREE.MathUtils.lerp(angledX, ball.position.x, clamp(config.lateralTracking, 0, 1));
  const xLimit = Math.max(0, config.goalWidth * 0.5 - config.lateralMargin);

  return new THREE.Vector3(clamp(trackedX, -xLimit, xLimit), 0, lineZ);
}

/** Alias kept short for systems that already refer to a keeper as `GK`. */
export const getKeeperTargetPosition = getGoalkeeperTargetPosition;

export function updateGoalkeeperMovement({
  keeper,
  ball,
  bounds,
  dt,
  playerRadius,
  config: overrides
}: GoalkeeperGoalInput & { dt: number; playerRadius: number }) {
  const config = resolveGoalkeeperConfig(overrides);
  const target = getGoalkeeperTargetPosition({ keeper, ball, bounds, config });
  const direction = target.clone().sub(keeper.position);
  updatePlayerMovement({
    player: keeper,
    inputDirection: direction.length() > 0.45 ? direction : new THREE.Vector3(),
    sprint: direction.length() > 5,
    dt,
    bounds,
    playerRadius,
    isControlled: false,
    hasBall: keeper.hasBall
  });
  return target;
}

function classifyVertical(normalizedY: number): KeeperSaveVertical {
  if (normalizedY < 0.28) return "low";
  if (normalizedY > 0.68) return "high";
  return "middle";
}

/** Classifies a shot relative to the keeper's view of the goal. */
export function classifySaveZone({ shot, config: overrides }: { shot: KeeperShot; config?: Partial<GoalkeeperConfig> }): KeeperSaveZoneResult {
  const config = resolveGoalkeeperConfig(overrides);
  const halfWidth = Math.max(0.01, config.goalWidth * 0.5);
  const normalizedX = clamp(shot.target.x / halfWidth, -1, 1);
  const normalizedY = clamp(shot.target.y / Math.max(0.01, config.goalHeight), 0, 1);
  const vertical = classifyVertical(normalizedY);
  const centerThreshold = 0.3;

  if (Math.abs(normalizedX) <= centerThreshold) {
    return {
      zone: vertical === "middle" ? "central" : `${vertical}-central`,
      horizontal: "center",
      vertical,
      normalizedX,
      normalizedY
    };
  }

  const shooterSide = Math.abs(shot.origin.x) > 0.2 ? Math.sign(shot.origin.x) : Math.sign(shot.target.x);
  const targetSide = Math.sign(shot.target.x);
  const horizontal: KeeperSaveHorizontal = targetSide === (shooterSide || targetSide) ? "near" : "far";
  return {
    zone: horizontal === "near" ? "near-post" : "far-post",
    horizontal,
    vertical,
    normalizedX,
    normalizedY
  };
}

export const getSaveZone = classifySaveZone;

function shotSpeed(shot: KeeperShot) {
  if (shot.velocity && shot.velocity.length() > 0.01) return shot.velocity.length();
  if (typeof shot.power === "number" && shot.power > 0) return shot.power;
  return 24;
}

export function estimateShotTravelTime(shot: KeeperShot) {
  return shot.origin.distanceTo(shot.target) / Math.max(1, shotSpeed(shot));
}

/** Returns a stable 0-1 danger score for the shot. */
export function estimateShotQuality({ shot, config: overrides }: { shot: KeeperShot; config?: Partial<GoalkeeperConfig> }) {
  if (typeof shot.quality === "number" && Number.isFinite(shot.quality)) {
    return clamp(shot.quality, 0, 1);
  }
  const config = resolveGoalkeeperConfig(overrides);
  const zone = classifySaveZone({ shot, config });
  const powerQuality = clamp((shotSpeed(shot) - 14) / 30, 0, 1);
  const placementQuality = zone.horizontal === "center" ? 0.12 : 0.68;
  const heightQuality = zone.vertical === "high" ? 0.28 : zone.vertical === "low" ? 0.08 : 0.16;
  const shooterQuality = shot.shooter ? clamp(shot.shooter.stats.shooting / 100, 0, 1) : 0.55;
  return clamp(powerQuality * 0.38 + placementQuality * 0.3 + heightQuality * 0.12 + shooterQuality * 0.2, 0, 1);
}

function getReactionTime(keeper: SimPlayer, config: GoalkeeperConfig) {
  return clamp(
    config.reactionBase - clamp(keeper.stats.defending, 0, 100) / 100 * config.reactionStatScale,
    0.12,
    0.65
  );
}

export function getKeeperSaveProbability({
  keeper,
  shot,
  config: overrides
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
}) {
  const config = resolveGoalkeeperConfig(overrides);
  const zone = classifySaveZone({ shot, config });
  const quality = estimateShotQuality({ shot, config });
  const travelTime = estimateShotTravelTime(shot);
  const reactionTime = getReactionTime(keeper, config);
  const timing = clamp((travelTime - reactionTime) / 0.55, -1, 1);
  const zoneBonus = zone.horizontal === "center"
    ? config.centralSaveBonus + (zone.vertical === "high" ? -0.08 : 0)
    : zone.horizontal === "far" ? -0.08 : -0.02;
  const keeperSkill = clamp(keeper.stats.defending / 100, 0, 1);
  const physical = clamp(keeper.stats.physical / 100, 0, 1);
  const weakShot = (1 - quality) * config.weakShotBonus;
  return clamp(
    0.28 + keeperSkill * config.statWeight + physical * 0.07 + zoneBonus + weakShot
      - quality * config.qualityWeight + timing * config.timingWeight,
    0.03,
    0.97
  );
}

export const calculateSaveProbability = getKeeperSaveProbability;

function diveDirection(zone: KeeperSaveZoneResult, target: THREE.Vector3): KeeperDiveDirection {
  if (zone.horizontal === "near") return target.x < 0 ? "left" : "right";
  if (zone.horizontal === "far") return target.x < 0 ? "left" : "right";
  if (zone.vertical === "high") return "up";
  if (zone.vertical === "low") return "down";
  return "center";
}

export function planKeeperReaction({
  keeper,
  shot,
  config: overrides
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
}): KeeperDivePlan {
  const config = resolveGoalkeeperConfig(overrides);
  const zone = classifySaveZone({ shot, config });
  const shotQuality = estimateShotQuality({ shot, config });
  const saveProbability = getKeeperSaveProbability({ keeper, shot, config });
  const travelTime = estimateShotTravelTime(shot);
  const reactionTime = getReactionTime(keeper, config);
  const targetPosition = shot.target.clone();
  targetPosition.y = clamp(targetPosition.y, 0, config.goalHeight);
  const central = zone.horizontal === "center";
  const claimable = Math.abs(targetPosition.x - keeper.position.x) <= config.claimDistance;
  const action: KeeperReactionAction = central && claimable && shotQuality < 0.48 && travelTime > reactionTime
    ? "claim"
    : central && shotQuality < 0.62
      ? "hold"
      : "dive";
  return {
    action,
    direction: diveDirection(zone, targetPosition),
    zone,
    targetPosition,
    shotQuality,
    saveProbability,
    reactionTime,
    travelTime,
    duration: action === "dive" ? config.diveDuration : 0.18
  };
}

export const createKeeperDivePlan = planKeeperReaction;

/** Resolves a shot using exactly one injected random roll. */
export function resolveKeeperShot({
  keeper,
  shot,
  config: overrides,
  random
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
  random?: GoalkeeperRandom;
}): KeeperSaveResult {
  const config = resolveGoalkeeperConfig(overrides);
  const plan = planKeeperReaction({ keeper, shot, config });
  const roll = clamp((random ?? config.random)(0, 1), 0, 1);
  if (roll <= plan.saveProbability) {
    const canParry = plan.action === "dive" && plan.shotQuality > 0.72 && roll > plan.saveProbability * 0.65;
    return { outcome: canParry ? "parry" : "save", saved: true, probability: plan.saveProbability, roll, plan };
  }
  return { outcome: "goal", saved: false, probability: plan.saveProbability, roll, plan };
}

function nearestOpponentDistance(player: SimPlayer, opponents: SimPlayer[]) {
  if (opponents.length === 0) return Number.POSITIVE_INFINITY;
  return opponents.reduce((best, opponent) => Math.min(best, player.position.distanceTo(opponent.position)), Number.POSITIVE_INFINITY);
}

/**
 * Chooses a safe outlet after a keeper collects the ball.  It does not kick or
 * mutate the world; the orchestrator can feed the returned target into its
 * existing pass/clearance action.
 */
export function chooseKeeperDistribution({
  keeper,
  teammates,
  opponents = [],
  config: overrides
}: {
  keeper: SimPlayer;
  teammates: SimPlayer[];
  opponents?: SimPlayer[];
  config?: Partial<GoalkeeperConfig>;
}): KeeperDistributionChoice {
  const config = resolveGoalkeeperConfig(overrides);
  const candidates = teammates.filter((player) => player !== keeper && player.role !== "GK");
  if (candidates.length === 0) {
    return { mode: "clearance", target: null, targetPosition: null, score: 0, pressure: 0, reason: "No outfield teammate is available." };
  }

  const scored = candidates.map((target) => {
    const distance = keeper.position.distanceTo(target.position);
    const pressure = nearestOpponentDistance(target, opponents);
    const forward = keeper.team === "home" ? target.position.z - keeper.position.z : keeper.position.z - target.position.z;
    const passing = clamp(target.stats.passing / 100, 0, 1);
    const open = clamp(pressure / 16, 0, 1);
    const progressive = clamp((forward + 12) / 42, 0, 1);
    const distanceFit = clamp(1 - Math.abs(distance - 18) / 36, 0, 1);
    const score = passing * 0.35 + open * 0.35 + progressive * 0.16 + distanceFit * 0.14;
    return { target, distance, pressure, score };
  }).sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id));

  const best = scored[0];
  if (best.pressure < 2.7) {
    return {
      mode: "clearance",
      target: null,
      targetPosition: null,
      score: best.score,
      pressure: best.pressure,
      reason: "Nearby outlets are pressured; clear into space."
    };
  }
  if (best.distance <= 24) {
    return {
      mode: "short",
      target: best.target,
      targetPosition: best.target.position.clone(),
      score: best.score,
      pressure: best.pressure,
      reason: "A nearby outlet is open for a safe short pass."
    };
  }
  if (best.distance > 30 || best.pressure >= 4.5) {
    return {
      mode: "long",
      target: best.target,
      targetPosition: best.target.position.clone(),
      score: best.score,
      pressure: best.pressure,
      reason: "The keeper has time or space for a longer distribution."
    };
  }
  return {
    mode: "clearance",
    target: null,
    targetPosition: null,
    score: best.score,
    pressure: best.pressure,
    reason: "Nearby outlets are pressured; clear into space."
  };
}

export const chooseDistribution = chooseKeeperDistribution;
export const chooseDistributionTarget = chooseKeeperDistribution;

/** Convenience facade for an orchestrator that wants a configured system. */
export class GoalkeeperSystem {
  readonly config: GoalkeeperConfig;

  constructor(config?: Partial<GoalkeeperConfig>) {
    this.config = resolveGoalkeeperConfig(config);
  }

  getTargetPosition(input: Omit<GoalkeeperGoalInput, "config">) {
    return getGoalkeeperTargetPosition({ ...input, config: this.config });
  }

  updateMovement(input: Omit<GoalkeeperGoalInput, "config"> & { dt: number; playerRadius: number }) {
    return updateGoalkeeperMovement({ ...input, config: this.config });
  }

  classifySaveZone(shot: KeeperShot) {
    return classifySaveZone({ shot, config: this.config });
  }

  planReaction(keeper: SimPlayer, shot: KeeperShot) {
    return planKeeperReaction({ keeper, shot, config: this.config });
  }

  resolveShot(keeper: SimPlayer, shot: KeeperShot, random?: GoalkeeperRandom) {
    return resolveKeeperShot({ keeper, shot, config: this.config, random });
  }

  chooseDistribution(keeper: SimPlayer, teammates: SimPlayer[], opponents: SimPlayer[] = []) {
    return chooseKeeperDistribution({ keeper, teammates, opponents, config: this.config });
  }
}
