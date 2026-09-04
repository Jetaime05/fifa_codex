import * as THREE from "three";
import { analyzePassingLane } from "./PassingLane";
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
  /** Optional spin/curl magnitude. The direction is not needed by the save model. */
  spin?: THREE.Vector3;
  /** 0 is completely screened, 1 is an unobstructed view. */
  visibility?: number;
  /** Deflections add recognition delay even if the final velocity is slow. */
  deflection?: number;
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
  /** 0 means the ball arrives before recognition, 1 means fully set. */
  readiness: number;
  /** Positive seconds by which the shot beats the keeper's reaction. */
  lateBy: number;
  difficulty: KeeperShotDifficulty;
  intentLabel: string;
  duration: number;
};

export type KeeperReactionTiming = {
  reactionTime: number;
  travelTime: number;
  availableTime: number;
  lateBy: number;
  readiness: number;
  canReact: boolean;
};

/** Explainable components used by both balancing tools and the debug overlay. */
export type KeeperShotDifficulty = {
  quality: number;
  pace: number;
  placement: number;
  elevation: number;
  distance: number;
  curve: number;
  reach: number;
  timing: number;
  overall: number;
};

export type KeeperSaveEvaluation = {
  probability: number;
  keeperSkill: number;
  zone: KeeperSaveZoneResult;
  timing: KeeperReactionTiming;
  difficulty: KeeperShotDifficulty;
  reason: string;
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
  /** Recommended time to scan before releasing the ball. */
  releaseDelay: number;
  intentLabel: string;
  reason: string;
};

export type KeeperPositioningSnapshot = {
  targetPosition: THREE.Vector3;
  ballAngle: number;
  threat: number;
  advance: number;
  anticipatedBallX: number;
  nearPostProtected: boolean;
  intentLabel: string;
};

export type KeeperBrainSnapshot = {
  keeperId: string;
  intentLabel: string;
  position?: Omit<KeeperPositioningSnapshot, "targetPosition"> & { target: { x: number; y: number; z: number } };
  reaction?: {
    action: KeeperReactionAction;
    direction: KeeperDiveDirection;
    zone: KeeperSaveZone;
    probability: number;
    readiness: number;
    difficulty: number;
  };
  distribution?: {
    mode: KeeperDistributionMode;
    targetId: string | null;
    score: number;
    pressure: number;
    releaseDelay: number;
  };
};

function goalSide(team: TeamId): -1 | 1 {
  return team === "home" ? -1 : 1;
}

export function getGoalLineZ(team: TeamId, bounds: FieldBounds) {
  return goalSide(team) * bounds.halfLength;
}

/** A rebounded or stopped ball is a loose-ball claim, not another shot save. */
export function isBallApproachingGoal(ball: Pick<SimBall, "velocity">, defendingTeam: TeamId): boolean {
  return ball.velocity.z * (defendingTeam === "home" ? -1 : 1) > 0;
}

/**
 * Positions a keeper on the line joining the goal centre and the ball.  The
 * keeper steps out as the ball enters the attacking third, while the lateral
 * position is clamped to a playable part of the goal mouth.
 */
export function getGoalkeeperPositioning({ keeper, ball, bounds, config: overrides }: GoalkeeperGoalInput): KeeperPositioningSnapshot {
  const config = resolveGoalkeeperConfig(overrides);
  const side = goalSide(keeper.team);
  const goalZ = side * bounds.halfLength;
  // `side` points from the pitch towards the defended goal. Multiplying the
  // goal-to-ball vector by it gives a positive in-field distance for both
  // home (negative z goal) and away (positive z goal) keepers.
  const distanceFromGoal = Math.max(0, (goalZ - ball.position.z) * side);
  const threat = clamp(1 - distanceFromGoal / Math.max(1, config.maxThreatDistance), 0, 1);
  const baseAdvance = Math.max(config.minAdvance, config.goalLineInset);
  const ballAngle = Math.atan2(Math.abs(ball.position.x), Math.max(1, distanceFromGoal));
  const centralThreat = 1 - clamp(Math.abs(ball.position.x) / Math.max(1, bounds.halfWidth), 0, 1);
  const advance = clamp(
    baseAdvance + threat * (config.maxAdvance - baseAdvance) + threat * centralThreat * config.angleAdvance,
    baseAdvance,
    config.maxAdvance
  );
  const lineZ = goalZ - side * advance;

  // Similar-triangle projection gives the keeper the correct angle instead of
  // simply mirroring the ball's x coordinate when the ball is far away.
  const projection = clamp(advance / Math.max(advance, distanceFromGoal), 0, 1);
  const anticipatedOffset = clamp(
    ball.velocity.x * config.anticipationSeconds,
    -config.maxAnticipationOffset,
    config.maxAnticipationOffset
  );
  const anticipatedBallX = ball.position.x + anticipatedOffset;
  const angledX = anticipatedBallX * projection;
  const trackedX = THREE.MathUtils.lerp(angledX, anticipatedBallX, clamp(config.lateralTracking, 0, 1));
  const xLimit = Math.max(0, config.goalWidth * 0.5 - config.lateralMargin);
  const wideThreat = clamp((Math.abs(anticipatedBallX) / Math.max(1, bounds.halfWidth) - 0.38) / 0.62, 0, 1);
  const nearPostOffset = Math.sign(anticipatedBallX) * wideThreat * threat * config.nearPostBias;
  const targetPosition = new THREE.Vector3(clamp(trackedX + nearPostOffset, -xLimit, xLimit), 0, lineZ);

  return {
    targetPosition,
    ballAngle,
    threat,
    advance,
    anticipatedBallX,
    nearPostProtected: wideThreat * threat > 0.12,
    intentLabel: threat > 0.72 ? "Narrow shooting angle" : threat > 0.34 ? "Track ball angle" : "Hold goal shape"
  };
}

export function getGoalkeeperTargetPosition(input: GoalkeeperGoalInput) {
  return getGoalkeeperPositioning(input).targetPosition;
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

function getReactionTime(keeper: SimPlayer, shot: KeeperShot, config: GoalkeeperConfig) {
  const awareness = clamp(keeper.stats.defending / 100, 0, 1);
  const visibility = clamp(shot.visibility ?? 1, 0, 1);
  const deflection = clamp(shot.deflection ?? 0, 0, 1);
  const recognitionDelay = ((1 - visibility) + deflection) * config.perceptionDelay;
  return clamp(
    config.reactionBase - awareness * config.reactionStatScale
      - awareness * config.anticipationStatScale + recognitionDelay,
    config.minReactionTime,
    config.maxReactionTime
  );
}

export function getKeeperReactionTiming({
  keeper,
  shot,
  config: overrides
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
}): KeeperReactionTiming {
  const config = resolveGoalkeeperConfig(overrides);
  const travelTime = estimateShotTravelTime(shot);
  const reactionTime = getReactionTime(keeper, shot, config);
  const availableTime = Math.max(0, travelTime);
  const lateBy = Math.max(0, reactionTime - availableTime);
  const readiness = clamp((availableTime - reactionTime + 0.16) / 0.4, 0, 1);
  return { reactionTime, travelTime, availableTime, lateBy, readiness, canReact: readiness > 0.05 };
}

export function evaluateShotDifficulty({
  keeper,
  shot,
  config: overrides
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
}): KeeperShotDifficulty {
  const config = resolveGoalkeeperConfig(overrides);
  const zone = classifySaveZone({ shot, config });
  const quality = estimateShotQuality({ shot, config });
  const pace = clamp((shotSpeed(shot) - 14) / 34, 0, 1);
  const placement = clamp(Math.abs(zone.normalizedX), 0, 1);
  const elevation = zone.vertical === "high" ? 1 : zone.vertical === "middle" ? 0.38 : 0.2;
  const shotDistance = shot.origin.distanceTo(shot.target);
  const distance = 1 - clamp((shotDistance - 8) / 42, 0, 1);
  const curve = clamp((shot.spin?.length() ?? 0) / 2.2, 0, 1);
  const timingResult = getKeeperReactionTiming({ keeper, shot, config });
  const timing = 1 - timingResult.readiness;
  const horizontalReach = Math.abs(shot.target.x - keeper.position.x);
  const verticalReach = Math.max(0, shot.target.y - 1.2) * config.highShotReachPenalty;
  const keeperReach = config.baseReach + clamp(keeper.stats.physical / 100, 0, 1) * config.reachStatScale;
  const reach = clamp((horizontalReach + verticalReach) / Math.max(0.1, keeperReach), 0, 1);
  const weighted = quality * config.qualityWeight
    + placement * config.placementDifficultyWeight
    + pace * config.paceDifficultyWeight
    + elevation * config.heightDifficultyWeight
    + distance * config.distanceDifficultyWeight
    + curve * config.curveDifficultyWeight
    + timing * config.lateReactionPenalty;
  const totalWeight = config.qualityWeight + config.placementDifficultyWeight
    + config.paceDifficultyWeight + config.heightDifficultyWeight
    + config.distanceDifficultyWeight + config.curveDifficultyWeight
    + config.lateReactionPenalty;
  const overall = clamp(weighted / Math.max(0.01, totalWeight) * 0.82 + reach * 0.18, 0, 1);
  return { quality, pace, placement, elevation, distance, curve, reach, timing, overall };
}

export function evaluateKeeperSave({
  keeper,
  shot,
  config: overrides
}: {
  keeper: SimPlayer;
  shot: KeeperShot;
  config?: Partial<GoalkeeperConfig>;
}): KeeperSaveEvaluation {
  const config = resolveGoalkeeperConfig(overrides);
  const zone = classifySaveZone({ shot, config });
  const timing = getKeeperReactionTiming({ keeper, shot, config });
  const difficulty = evaluateShotDifficulty({ keeper, shot, config });
  const zoneBonus = zone.horizontal === "center"
    ? config.centralSaveBonus + (zone.vertical === "high" ? -0.08 : 0)
    : zone.horizontal === "far" ? -0.08 : -0.02;
  const keeperSkill = clamp(keeper.stats.defending / 100, 0, 1);
  const physical = clamp(keeper.stats.physical / 100, 0, 1);
  const weakShot = (1 - difficulty.quality) * config.weakShotBonus;
  const probability = clamp(
    0.3 + keeperSkill * config.statWeight + physical * 0.07 + zoneBonus + weakShot
      - difficulty.overall * config.qualityWeight
      + (timing.readiness * 2 - 1) * config.timingWeight
      - timing.lateBy * config.lateReactionPenalty,
    0.03,
    0.97
  );
  const reason = !timing.canReact
    ? "Shot arrived before the keeper could set."
    : difficulty.reach > 0.82
      ? "Shot tests the edge of the keeper's reach."
      : zone.horizontal === "center" && difficulty.pace < 0.45
        ? "Central shot gives the keeper a strong saving position."
        : "Save chance balances reaction time, reach, placement, and pace.";
  return { probability, keeperSkill, zone, timing, difficulty, reason };
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
  return evaluateKeeperSave({ keeper, shot, config: overrides }).probability;
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
  const evaluation = evaluateKeeperSave({ keeper, shot, config });
  const saveProbability = evaluation.probability;
  const { travelTime, reactionTime, readiness, lateBy } = evaluation.timing;
  const targetPosition = shot.target.clone();
  targetPosition.y = clamp(targetPosition.y, 0, config.goalHeight);
  const central = zone.horizontal === "center";
  const claimable = Math.abs(targetPosition.x - keeper.position.x) <= config.claimDistance;
  const action: KeeperReactionAction = central && claimable && shotQuality < 0.48 && travelTime > reactionTime
    ? "claim"
    : central && shotQuality < 0.62
      ? "hold"
      : "dive";
  const intentLabel = !evaluation.timing.canReact
    ? "Late reaction"
    : action === "claim"
      ? "Claim central shot"
      : action === "hold"
        ? "Set and hold"
        : `Dive ${diveDirection(zone, targetPosition)}`;
  return {
    action,
    direction: diveDirection(zone, targetPosition),
    zone,
    targetPosition,
    shotQuality,
    saveProbability,
    reactionTime,
    travelTime,
    readiness,
    lateBy,
    difficulty: evaluation.difficulty,
    intentLabel,
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
    return {
      mode: "clearance", target: null, targetPosition: null, score: 0, pressure: 0,
      releaseDelay: config.distributionHoldMin, intentLabel: "Clear: no outlet",
      reason: "No outfield teammate is available."
    };
  }

  const scored = candidates.map((target) => {
    const distance = keeper.position.distanceTo(target.position);
    const pressure = Math.min(
      nearestOpponentDistance(target, opponents),
      config.distributionPressureRadius * 2
    );
    const forward = keeper.team === "home" ? target.position.z - keeper.position.z : keeper.position.z - target.position.z;
    const passing = clamp(target.stats.passing / 100, 0, 1);
    const open = clamp(pressure / Math.max(1, config.distributionPressureRadius), 0, 1);
    const progressive = clamp((forward + 12) / 42, 0, 1);
    const distanceFit = clamp(1 - Math.abs(distance - 18) / 36, 0, 1);
    const lane = analyzePassingLane(keeper.position, target.position, opponents);
    const score = passing * 0.25 + open * 0.25 + progressive * 0.16 + distanceFit * 0.14
      + (1 - lane.risk) * 0.2 - (lane.blocked ? 0.5 : 0);
    return { target, distance, pressure, score, lane };
  }).sort((a, b) => b.score - a.score || a.target.id.localeCompare(b.target.id));

  const best = scored[0];
  const scanDelay = THREE.MathUtils.lerp(
    config.distributionHoldMin,
    config.distributionHoldMax,
    clamp(Math.min(best.pressure, nearestOpponentDistance(keeper, opponents)) / Math.max(1, config.distributionPressureRadius), 0, 1)
  );
  if (best.pressure < 2.7 || best.lane.blocked) {
    return {
      mode: "clearance",
      target: null,
      targetPosition: null,
      score: best.score,
      pressure: best.pressure,
      releaseDelay: config.distributionHoldMin,
      intentLabel: "Clear under pressure",
      reason: best.lane.blocked ? "The passing lane is blocked; clear into space." : "Nearby outlets are pressured; clear into space."
    };
  }
  if (best.distance <= 24) {
    return {
      mode: "short",
      target: best.target,
      targetPosition: best.target.position.clone(),
      score: best.score,
      pressure: best.pressure,
      releaseDelay: scanDelay,
      intentLabel: `Roll short to ${best.target.short}`,
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
      releaseDelay: scanDelay,
      intentLabel: `Distribute long to ${best.target.short}`,
      reason: "The keeper has time or space for a longer distribution."
    };
  }
  return {
    mode: "clearance",
    target: null,
    targetPosition: null,
    score: best.score,
    pressure: best.pressure,
    releaseDelay: config.distributionHoldMin,
    intentLabel: "Clear: no safe lane",
    reason: "Nearby outlets are pressured; clear into space."
  };
}

export const chooseDistribution = chooseKeeperDistribution;
export const chooseDistributionTarget = chooseKeeperDistribution;

/** Converts keeper decisions into a JSON-safe, renderer-independent debug record. */
export function createKeeperBrainSnapshot({
  keeper,
  positioning,
  reaction,
  distribution
}: {
  keeper: SimPlayer;
  positioning?: KeeperPositioningSnapshot;
  reaction?: KeeperDivePlan;
  distribution?: KeeperDistributionChoice;
}): KeeperBrainSnapshot {
  const intentLabel = distribution?.intentLabel ?? reaction?.intentLabel ?? positioning?.intentLabel ?? "Hold goal shape";
  const snapshot: KeeperBrainSnapshot = {
    keeperId: keeper.id,
    intentLabel
  };
  if (positioning) {
    snapshot.position = {
      target: {
        x: positioning.targetPosition.x,
        y: positioning.targetPosition.y,
        z: positioning.targetPosition.z
      },
      ballAngle: positioning.ballAngle,
      threat: positioning.threat,
      advance: positioning.advance,
      anticipatedBallX: positioning.anticipatedBallX,
      nearPostProtected: positioning.nearPostProtected,
      intentLabel: positioning.intentLabel
    };
  }
  if (reaction) {
    snapshot.reaction = {
      action: reaction.action,
      direction: reaction.direction,
      zone: reaction.zone.zone,
      probability: reaction.saveProbability,
      readiness: reaction.readiness,
      difficulty: reaction.difficulty.overall
    };
  }
  if (distribution) {
    snapshot.distribution = {
      mode: distribution.mode,
      targetId: distribution.target?.id ?? null,
      score: distribution.score,
      pressure: distribution.pressure,
      releaseDelay: distribution.releaseDelay
    };
  }
  return snapshot;
}

/** Convenience facade for an orchestrator that wants a configured system. */
export class GoalkeeperSystem {
  readonly config: GoalkeeperConfig;

  constructor(config?: Partial<GoalkeeperConfig>) {
    this.config = resolveGoalkeeperConfig(config);
  }

  getTargetPosition(input: Omit<GoalkeeperGoalInput, "config">) {
    return getGoalkeeperTargetPosition({ ...input, config: this.config });
  }

  getPositioning(input: Omit<GoalkeeperGoalInput, "config">) {
    return getGoalkeeperPositioning({ ...input, config: this.config });
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

  getReactionTiming(keeper: SimPlayer, shot: KeeperShot) {
    return getKeeperReactionTiming({ keeper, shot, config: this.config });
  }

  evaluateShot(keeper: SimPlayer, shot: KeeperShot) {
    return evaluateKeeperSave({ keeper, shot, config: this.config });
  }

  resolveShot(keeper: SimPlayer, shot: KeeperShot, random?: GoalkeeperRandom) {
    return resolveKeeperShot({ keeper, shot, config: this.config, random });
  }

  chooseDistribution(keeper: SimPlayer, teammates: SimPlayer[], opponents: SimPlayer[] = []) {
    return chooseKeeperDistribution({ keeper, teammates, opponents, config: this.config });
  }

  createDebugSnapshot(
    keeper: SimPlayer,
    decisions: { positioning?: KeeperPositioningSnapshot; reaction?: KeeperDivePlan; distribution?: KeeperDistributionChoice } = {}
  ) {
    return createKeeperBrainSnapshot({ keeper, ...decisions });
  }
}
