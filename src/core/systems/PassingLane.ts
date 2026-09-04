import * as THREE from "three";
import type { SimPlayer } from "./types";

export type PassingLaneConfig = {
  /** Radius around the pass segment that a stationary opponent can cover. */
  blockingRadius: number;
  /** Opponents beyond either end of the segment do not block the pass. */
  endpointMargin: number;
  minPassDistance: number;
  maxPassDistance: number;
};

export type PassingLaneBlocker = {
  playerId: string;
  clearance: number;
  progress: number;
};

export type PassingLaneAnalysis = {
  blocked: boolean;
  risk: number;
  distance: number;
  minClearance: number;
  blockers: PassingLaneBlocker[];
};

export type PassingOption = {
  player: SimPlayer;
  lane: PassingLaneAnalysis;
  forwardProgress: number;
  score: number;
};

export const DEFAULT_PASSING_LANE_CONFIG: Readonly<PassingLaneConfig> = {
  blockingRadius: 2.7,
  endpointMargin: 0.06,
  minPassDistance: 3,
  maxPassDistance: 35
};

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);

/** Distance from a point to a pass segment in the pitch's X/Z plane. */
export function distanceToPassingLane(
  from: THREE.Vector3,
  to: THREE.Vector3,
  point: THREE.Vector3
): { distance: number; progress: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= Number.EPSILON) {
    return { distance: Math.hypot(point.x - from.x, point.z - from.z), progress: 0 };
  }
  const rawProgress = ((point.x - from.x) * dx + (point.z - from.z) * dz) / lengthSquared;
  const progress = clamp01(rawProgress);
  const closestX = from.x + dx * progress;
  const closestZ = from.z + dz * progress;
  return { distance: Math.hypot(point.x - closestX, point.z - closestZ), progress: rawProgress };
}

/** Pure deterministic lane analysis. Input ordering cannot change the result. */
export function analyzePassingLane(
  from: THREE.Vector3,
  to: THREE.Vector3,
  opponents: readonly SimPlayer[],
  config: Partial<PassingLaneConfig> = {}
): PassingLaneAnalysis {
  const resolved = { ...DEFAULT_PASSING_LANE_CONFIG, ...config };
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const candidates = opponents
    .map((opponent) => {
      const lane = distanceToPassingLane(from, to, opponent.position);
      return { playerId: opponent.id, clearance: lane.distance, progress: lane.progress };
    })
    .filter(({ progress }) => progress > resolved.endpointMargin && progress < 1 - resolved.endpointMargin)
    .sort((a, b) => a.clearance - b.clearance || a.progress - b.progress || a.playerId.localeCompare(b.playerId));
  const blockers = candidates.filter(({ clearance }) => clearance <= resolved.blockingRadius);
  const minClearance = candidates[0]?.clearance ?? Number.POSITIVE_INFINITY;
  const clearanceRisk = Number.isFinite(minClearance)
    ? clamp01((resolved.blockingRadius * 2.2 - minClearance) / (resolved.blockingRadius * 2.2))
    : 0;
  const rangeRisk = clamp01((distance - resolved.maxPassDistance * 0.55) / (resolved.maxPassDistance * 0.45));
  return {
    blocked: blockers.length > 0,
    risk: clamp01(clearanceRisk * 0.8 + rangeRisk * 0.2),
    distance,
    minClearance,
    blockers
  };
}

export function hasClearPassingLane(
  from: THREE.Vector3,
  to: THREE.Vector3,
  opponents: readonly SimPlayer[],
  config: Partial<PassingLaneConfig> = {}
): boolean {
  return !analyzePassingLane(from, to, opponents, config).blocked;
}

/** Ranks support options identically for mirrored home/away situations. */
export function findOpenPassingOptions(
  ballCarrier: SimPlayer,
  teammates: readonly SimPlayer[],
  opponents: readonly SimPlayer[],
  attackingDirection: number,
  config: Partial<PassingLaneConfig> = {}
): PassingOption[] {
  const resolved = { ...DEFAULT_PASSING_LANE_CONFIG, ...config };
  return teammates
    .filter((player) => player.id !== ballCarrier.id)
    .map((player): PassingOption => {
      const lane = analyzePassingLane(ballCarrier.position, player.position, opponents, resolved);
      const forwardProgress = (player.position.z - ballCarrier.position.z) * attackingDirection;
      const usefulDistance = 1 - clamp01(Math.abs(lane.distance - 15) / 22);
      const progressValue = THREE.MathUtils.clamp(forwardProgress / 22, -1, 1);
      const score = usefulDistance * 0.35 + progressValue * 0.35 + (1 - lane.risk) * 0.3;
      return { player, lane, forwardProgress, score };
    })
    .filter(({ lane }) => lane.distance >= resolved.minPassDistance && lane.distance <= resolved.maxPassDistance)
    .sort((a, b) => b.score - a.score || a.player.id.localeCompare(b.player.id));
}
