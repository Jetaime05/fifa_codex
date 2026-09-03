import * as THREE from "three";
import type { SimPlayer } from "./types";

export type PassTargetSelectionInput = {
  passer: SimPlayer;
  teammates: readonly SimPlayer[];
  opponents?: readonly SimPlayer[];
  /** The player's current facing. If omitted, use the team's attacking axis. */
  forward?: THREE.Vector3;
  /** Optional stick/aim direction used to bias assisted passing. */
  desiredDirection?: THREE.Vector3;
  /** 0..1; higher assist gives the intended direction more weight. */
  assist?: number;
};

export type PassTargetScore = {
  /** `player` is the descriptive name used by the UI-facing integration. */
  player: SimPlayer;
  /** `target` is an alias that keeps action code terse. */
  target: SimPlayer;
  score: number;
  distance: number;
  forwardProgress: number;
  openness: number;
  laneSafety: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};

const horizontalDirection = (from: THREE.Vector3, to: THREE.Vector3) => {
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  if (direction.lengthSq() < 0.000001) {
    return new THREE.Vector3(0, 0, 1);
  }
  return direction.normalize();
};

/** Distance from a point to a line segment on the pitch plane. */
export function distanceToPassLane(
  point: THREE.Vector3,
  start: THREE.Vector3,
  end: THREE.Vector3
) {
  const sx = end.x - start.x;
  const sz = end.z - start.z;
  const lengthSq = sx * sx + sz * sz;
  if (lengthSq < 0.000001) {
    return horizontalDistance(point, start);
  }
  const progress = clamp(((point.x - start.x) * sx + (point.z - start.z) * sz) / lengthSq, 0, 1);
  const closestX = start.x + sx * progress;
  const closestZ = start.z + sz * progress;
  return Math.hypot(point.x - closestX, point.z - closestZ);
}

function nearestOpponentDistance(target: SimPlayer, opponents: readonly SimPlayer[]) {
  if (opponents.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (const opponent of opponents) {
    nearest = Math.min(nearest, horizontalDistance(target.position, opponent.position));
  }
  return nearest;
}

/**
 * Score one possible teammate for a pass.
 *
 * The score intentionally favours forward progress and open space while
 * penalising distance and a defender sitting on the passing lane. It contains
 * no random term, so target selection is replay-safe.
 */
export function scorePassTarget(input: PassTargetSelectionInput, target: SimPlayer): PassTargetScore {
  const forward = (input.forward?.clone() ?? new THREE.Vector3(0, 0, input.passer.team === "home" ? 1 : -1));
  forward.y = 0;
  if (forward.lengthSq() < 0.000001) {
    forward.set(0, 0, input.passer.team === "home" ? 1 : -1);
  } else {
    forward.normalize();
  }

  const distance = horizontalDistance(input.passer.position, target.position);
  const toTarget = horizontalDirection(input.passer.position, target.position);
  const forwardProgress = toTarget.dot(forward);
  const opponents = input.opponents ?? [];
  const nearest = nearestOpponentDistance(target, opponents);
  const openness = Number.isFinite(nearest) ? clamp(nearest / 12, 0, 1.35) : 1.1;
  const laneDistance = opponents.length === 0
    ? 12
    : Math.min(...opponents.map((opponent) => distanceToPassLane(opponent.position, input.passer.position, target.position)));
  const laneSafety = clamp(laneDistance / 5.5, 0, 1.25);
  const desiredDirection = input.desiredDirection?.clone();
  if (desiredDirection) {
    desiredDirection.y = 0;
    if (desiredDirection.lengthSq() > 0.000001) desiredDirection.normalize();
  }
  const directionMatch = desiredDirection && desiredDirection.lengthSq() > 0.000001
    ? (toTarget.dot(desiredDirection) + 1) * 0.5
    : 0.5;
  const assist = clamp(input.assist ?? 0.72, 0, 1);
  const roleBonus = target.role === "FWD" ? 0.22 : target.role === "MID" ? 0.1 : target.role === "DEF" ? 0.02 : -0.25;
  const distanceScore = 1 - clamp(distance / 48, 0, 1);
  const score =
    forwardProgress * 1.35 +
    openness * 1.05 +
    laneSafety * 0.8 +
    directionMatch * assist * 0.9 +
    distanceScore * 0.28 +
    roleBonus;

  return {
    player: target,
    target,
    score,
    distance,
    forwardProgress,
    openness,
    laneSafety
  };
}

/** Return all teammate scores in deterministic (best-first) order. */
export function rankPassTargets(input: PassTargetSelectionInput): PassTargetScore[] {
  return input.teammates
    .filter((target) => target !== input.passer && target.team === input.passer.team)
    .map((target) => scorePassTarget(input, target))
    .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
}

/** Select the teammate an assisted pass should favour. */
export function selectPassTarget(input: PassTargetSelectionInput): SimPlayer | null {
  return rankPassTargets(input)[0]?.player ?? null;
}

export type GoalFrame = {
  /** Centre of the goal mouth. Usually `{ x: 0, y: height / 2, z: goalZ }`. */
  center: THREE.Vector3;
  width: number;
  height: number;
};

export type GoalTargetSide = "left" | "center" | "right";
export type GoalTargetHeight = "low" | "high";

export type GoalTarget = {
  position: THREE.Vector3;
  side: GoalTargetSide;
  height: GoalTargetHeight;
  score: number;
  /** All candidates, useful for an aim marker or goalkeeper debug view. */
  alternatives: ReadonlyArray<GoalTargetCandidate>;
};

export type GoalTargetCandidate = Omit<GoalTarget, "alternatives">;

export type GoalTargetSelectionInput = {
  shooter: SimPlayer;
  goal: GoalFrame;
  goalkeeper?: SimPlayer | null;
  /** Manual aim in world coordinates. Assisted aim uses this as a bias. */
  desiredTarget?: THREE.Vector3;
  /** Optional explicit side from a left/right stick or aim quadrant. */
  preferredSide?: GoalTargetSide;
};

/**
 * Pick a safe point in the goal mouth. Corners get a baseline advantage and
 * the point furthest from the goalkeeper gets an additional advantage. This is
 * deliberately a target placeholder; keeper save zones can refine it later.
 */
export function rankGoalTargets(input: GoalTargetSelectionInput): GoalTargetCandidate[] {
  const halfWidth = Math.max(input.goal.width * 0.5, 0.1);
  const halfHeight = Math.max(input.goal.height * 0.5, 0.5);
  const centre = input.goal.center;
  // A caller may provide a goal-mouth origin at ground level instead of its
  // geometric centre. Treat y=0 as that common shorthand while preserving
  // explicit positive centre coordinates.
  const centreY = centre.y <= 0 ? halfHeight : centre.y;
  const bottom = centreY - halfHeight;
  const sideOffsets: Array<{ side: GoalTargetSide; x: number }> = [
    { side: "left", x: -halfWidth * 0.76 },
    { side: "center", x: 0 },
    { side: "right", x: halfWidth * 0.76 }
  ];
  const heights: Array<{ height: GoalTargetHeight; y: number }> = [
    { height: "low", y: bottom + halfHeight * 0.54 },
    { height: "high", y: bottom + halfHeight * 1.52 }
  ];
  const candidates: GoalTargetCandidate[] = [];
  for (const side of sideOffsets) {
    for (const height of heights) {
      const position = new THREE.Vector3(centre.x + side.x, height.y, centre.z);
      const cornerBias = side.side === "center" ? 0.15 : 1;
      const heightBias = height.height === "high" ? 0.08 : 0;
      let keeperSeparation = 0.5;
      if (input.goalkeeper) {
        keeperSeparation = clamp(horizontalDistance(position, input.goalkeeper.position) / Math.max(input.goal.width, 1), 0, 1.4);
        keeperSeparation += Math.abs(position.y - input.goalkeeper.position.y) / Math.max(input.goal.height, 1) * 0.18;
      }
      const shooterDistance = input.shooter.position.distanceTo(position);
      const distancePenalty = clamp(shooterDistance / 110, 0, 0.4);
      const aimBias = input.desiredTarget
        ? 1 - clamp(input.desiredTarget.distanceTo(position) / Math.max(input.goal.width, input.goal.height, 1) / 2, 0, 1)
        : 0.5;
      const sideBias = input.preferredSide && input.preferredSide === side.side ? 0.35 : 0;
      const score = cornerBias * 1.05 + heightBias + keeperSeparation * 1.4 + aimBias * 0.65 + sideBias - distancePenalty;
      candidates.push({ position, side: side.side, height: height.height, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.position.x - b.position.x || a.position.y - b.position.y);
}

export function selectGoalTarget(input: GoalTargetSelectionInput): GoalTarget {
  const alternatives = rankGoalTargets(input);
  const [best] = alternatives;
  if (!best) {
    const fallback = input.goal.center.clone();
    return { position: fallback, side: "center", height: "low", score: 0, alternatives: [] };
  }
  return { ...best, position: best.position.clone(), alternatives };
}
