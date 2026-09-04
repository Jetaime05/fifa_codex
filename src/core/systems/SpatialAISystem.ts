import * as THREE from "three";
import type { TeamData, TeamId } from "../../data/types";
import { findOpenPassingOptions, type PassingLaneConfig } from "./PassingLane";
import {
  buildTeamShapePlan,
  type TeamPhase,
  type TeamShapeConfig,
  type TeamShapePlan
} from "./TeamShapeSystem";
import type { FieldBounds, SimPlayer, SimPlayerIntent } from "./types";

export type SpatialAIConfig = {
  maxPressers: number;
  pressingDistance: number;
  recognizableShapeThreshold: number;
  shape: Partial<TeamShapeConfig>;
  passingLane: Partial<PassingLaneConfig>;
};

export type SpatialDecisionReason = "keeper" | "press" | "shape" | "support" | "mark" | "carry";

export type SpatialPlayerDecision = {
  playerId: string;
  target: THREE.Vector3;
  intent: SimPlayerIntent;
  sprint: boolean;
  reason: SpatialDecisionReason;
};

export type SpatialAIMetrics = {
  phase: TeamPhase;
  presserCount: number;
  supportOptionCount: number;
  openSupportOptionCount: number;
  shapeScore: number;
  shapeRecognizable: boolean;
  averageTargetError: number;
};

export type SpatialAIPlan = {
  team: TeamId;
  decisions: SpatialPlayerDecision[];
  shape: TeamShapePlan;
  metrics: SpatialAIMetrics;
};

export const DEFAULT_SPATIAL_AI_CONFIG: Readonly<SpatialAIConfig> = {
  maxPressers: 2,
  pressingDistance: 24,
  recognizableShapeThreshold: 0.62,
  shape: {},
  passingLane: {}
};

const mean = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

/** Measures current line order and proximity to planned anchors; useful for deterministic QA/telemetry. */
export function measureShapeRecognition(
  players: readonly SimPlayer[],
  shape: TeamShapePlan,
  attackingDirection: number,
  bounds: FieldBounds
): { score: number; recognizable: boolean; averageTargetError: number } {
  const targets = new Map(shape.targets.map((target) => [target.playerId, target.position]));
  const outfield = players.filter((player) => player.role !== "GK");
  const errors = outfield.map((player) => player.position.distanceTo(targets.get(player.id) ?? player.home));
  const averageTargetError = mean(errors);
  const proximityScore = THREE.MathUtils.clamp(1 - averageTargetError / 25, 0, 1);
  const centroid = (role: SimPlayer["role"]) => {
    const line = outfield.filter((player) => player.role === role);
    return line.length ? mean(line.map((player) => player.position.z * attackingDirection)) : Number.NaN;
  };
  const defenders = centroid("DEF");
  const midfielders = centroid("MID");
  const forwards = centroid("FWD");
  const comparisons = [defenders < midfielders, midfielders < forwards];
  const lineOrderScore = comparisons.filter(Boolean).length / comparisons.length;
  const width = outfield.length ? Math.max(...outfield.map((player) => player.position.x)) - Math.min(...outfield.map((player) => player.position.x)) : 0;
  const widthScore = THREE.MathUtils.clamp(width / Math.max(1, bounds.halfWidth), 0, 1);
  const score = proximityScore * 0.5 + lineOrderScore * 0.35 + widthScore * 0.15;
  return { score, recognizable: score >= DEFAULT_SPATIAL_AI_CONFIG.recognizableShapeThreshold, averageTargetError };
}

/** Creates movement intentions without mutating simulation state or consuming random values. */
export function planTeamSpatialAI(args: {
  players: readonly SimPlayer[];
  ballPosition: THREE.Vector3;
  ballOwner: SimPlayer | null;
  team: TeamData;
  bounds: FieldBounds;
  config?: Partial<Omit<SpatialAIConfig, "shape" | "passingLane">> & {
    shape?: Partial<TeamShapeConfig>;
    passingLane?: Partial<PassingLaneConfig>;
  };
}): SpatialAIPlan {
  const config: SpatialAIConfig = {
    ...DEFAULT_SPATIAL_AI_CONFIG,
    ...args.config,
    shape: { ...DEFAULT_SPATIAL_AI_CONFIG.shape, ...args.config?.shape },
    passingLane: { ...DEFAULT_SPATIAL_AI_CONFIG.passingLane, ...args.config?.passingLane }
  };
  const teammates = args.players.filter((player) => player.team === args.team.id);
  const opponents = args.players.filter((player) => player.team !== args.team.id);
  const phase: TeamPhase = args.ballOwner?.team === args.team.id ? "attacking" : "defending";
  const pressureTarget = args.ballOwner?.team !== args.team.id && args.ballOwner ? args.ballOwner.position : args.ballPosition;
  const pressers = phase === "defending"
    ? teammates
      .filter((player) => player.role !== "GK" && player.position.distanceTo(pressureTarget) <= config.pressingDistance)
      .sort((a, b) => a.position.distanceToSquared(pressureTarget) - b.position.distanceToSquared(pressureTarget) || a.id.localeCompare(b.id))
      .slice(0, Math.max(0, config.maxPressers))
    : [];
  const presserIds = new Set(pressers.map((player) => player.id));
  const shape = buildTeamShapePlan({
    players: teammates,
    opponents,
    team: args.team,
    phase,
    ballPosition: args.ballPosition,
    ballOwner: args.ballOwner,
    bounds: args.bounds,
    excludedMarkerIds: [...presserIds],
    config: config.shape
  });
  const targetByPlayer = new Map(shape.targets.map((target) => [target.playerId, target]));
  const decisions = teammates
    .map((player): SpatialPlayerDecision => {
      if (player.role === "GK") return { playerId: player.id, target: player.home.clone(), intent: "keeper", sprint: false, reason: "keeper" };
      if (player === args.ballOwner) {
        const target = player.position.clone();
        target.z += args.team.attackingDirection * 10;
        return { playerId: player.id, target, intent: "support", sprint: true, reason: "carry" };
      }
      if (presserIds.has(player.id)) return { playerId: player.id, target: pressureTarget.clone(), intent: "chase", sprint: true, reason: "press" };
      const shapeTarget = targetByPlayer.get(player.id)!;
      const reason = shapeTarget.source;
      const intent: SimPlayerIntent = reason === "support" ? "support" : "return";
      return { playerId: player.id, target: shapeTarget.position.clone(), intent, sprint: reason === "support", reason };
    })
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
  const supportOptions = args.ballOwner?.team === args.team.id
    ? findOpenPassingOptions(args.ballOwner, teammates, opponents, args.team.attackingDirection, config.passingLane)
    : [];
  const recognition = measureShapeRecognition(teammates, shape, args.team.attackingDirection, args.bounds);
  return {
    team: args.team.id,
    decisions,
    shape,
    metrics: {
      phase,
      presserCount: pressers.length,
      supportOptionCount: supportOptions.length,
      openSupportOptionCount: supportOptions.filter((option) => !option.lane.blocked).length,
      shapeScore: recognition.score,
      shapeRecognizable: recognition.score >= config.recognizableShapeThreshold,
      averageTargetError: recognition.averageTargetError
    }
  };
}

/** Convenience helper for one deterministic home/away planning pass. */
export function planBothTeamsSpatialAI(args: {
  players: readonly SimPlayer[];
  ballPosition: THREE.Vector3;
  ballOwner: SimPlayer | null;
  teams: Record<TeamId, TeamData>;
  bounds: FieldBounds;
  config?: Parameters<typeof planTeamSpatialAI>[0]["config"];
}): Record<TeamId, SpatialAIPlan> {
  return {
    home: planTeamSpatialAI({ ...args, team: args.teams.home }),
    away: planTeamSpatialAI({ ...args, team: args.teams.away })
  };
}
