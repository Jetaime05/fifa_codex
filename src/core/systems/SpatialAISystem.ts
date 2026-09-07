import * as THREE from "three";
import type { TeamData, TeamId } from "../../data/types";
import { findOpenPassingOptions, type PassingLaneConfig } from "./PassingLane";
import {
  buildTeamShapePlan,
  type TeamPhase,
  type TeamShapeConfig,
  type TeamShapePlan
} from "./TeamShapeSystem";
import {
  getPlayerInstruction,
  getTacticalPresserLimit,
  getTacticalModifiers,
  resolveTeamTactics,
  type RuntimeTeamTactics,
  type RuntimeTeamTacticsByTeam
} from "./TacticsSystem";
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
  /** Effective configured intensity, useful to the debug/management layer. */
  pressingIntensity?: number;
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

type SpatialTacticsInput = RuntimeTeamTactics | RuntimeTeamTacticsByTeam;

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
  /** A single team value or a home/away map from the tactics editor. */
  tactics?: SpatialTacticsInput;
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
  const tactics = resolveTeamTactics(args.tactics, args.team.id);
  const tacticalModifiers = tactics ? getTacticalModifiers(tactics) : undefined;
  const pressureTarget = args.ballOwner?.team !== args.team.id && args.ballOwner ? args.ballOwner.position : args.ballPosition;
  // Without tactics, retain the Phase 3 max-two behavior exactly. A tactics
  // value scales both the candidate radius and count, but never exceeds that
  // old cap (or an explicitly lower config cap).
  const maxPressers = tactics
    ? getTacticalPresserLimit(tactics, config.maxPressers)
    : Math.max(0, config.maxPressers);
  const pressingDistance = tactics
    ? config.pressingDistance * tacticalModifiers!.pressureDistanceMultiplier
    : config.pressingDistance;
  const pressers = phase === "defending"
    ? teammates
      .filter((player) => player.role !== "GK" && player.position.distanceTo(pressureTarget) <= pressingDistance)
      .sort((a, b) => a.position.distanceToSquared(pressureTarget) - b.position.distanceToSquared(pressureTarget) || a.id.localeCompare(b.id))
      .slice(0, maxPressers)
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
    config: config.shape,
    tactics
  });
  const targetByPlayer = new Map(shape.targets.map((target) => [target.playerId, target]));
  const decisions = teammates
    .map((player): SpatialPlayerDecision => {
      if (player.role === "GK") return { playerId: player.id, target: player.home.clone(), intent: "keeper", sprint: false, reason: "keeper" };
      if (player === args.ballOwner) {
        const target = player.position.clone();
        // Build-up and passing style influence the carrier's next support/pass
        // target, never the player's physical max speed.
        const carryDistance = tactics
          ? THREE.MathUtils.clamp(10 * tacticalModifiers!.supportForwardMultiplier, 5, 18)
          : 10;
        target.z += args.team.attackingDirection * carryDistance;
        return { playerId: player.id, target, intent: "support", sprint: true, reason: "carry" };
      }
      if (presserIds.has(player.id)) return { playerId: player.id, target: pressureTarget.clone(), intent: "chase", sprint: true, reason: "press" };
      const shapeTarget = targetByPlayer.get(player.id)!;
      const reason = shapeTarget.source;
      const instruction = getPlayerInstruction(tactics, player);
      const intent: SimPlayerIntent = reason === "support" || instruction === "getForward" || instruction === "freeRoam" ? "support" : "return";
      return {
        playerId: player.id,
        target: shapeTarget.position.clone(),
        intent,
        sprint: reason === "support" || instruction === "getForward",
        reason
      };
    })
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
  const passingLaneConfig = tactics
    ? {
      ...config.passingLane,
      minPassDistance: Math.max(2, (config.passingLane.minPassDistance ?? 3) * tacticalModifiers!.passDistanceMultiplier),
      maxPassDistance: Math.max(8, (config.passingLane.maxPassDistance ?? 35) * tacticalModifiers!.passDistanceMultiplier)
    }
    : config.passingLane;
  // Tactics rank the intended shape outlets without mutating simulation
  // players. This gives build-up/passing style a deterministic effect on pass
  // targets while preserving the legacy path when no tactics are supplied.
  const passingTeammates = tactics
    ? teammates.map((player) => {
      const shaped = targetByPlayer.get(player.id);
      return shaped ? { ...player, position: shaped.position.clone() } : player;
    })
    : teammates;
  const passingCarrier = tactics && args.ballOwner
    ? { ...args.ballOwner, position: args.ballOwner.position.clone() }
    : args.ballOwner;
  const supportOptions = args.ballOwner?.team === args.team.id && passingCarrier
    ? findOpenPassingOptions(passingCarrier, passingTeammates, opponents, args.team.attackingDirection, passingLaneConfig)
    : [];
  const recognition = measureShapeRecognition(teammates, shape, args.team.attackingDirection, args.bounds);
  return {
    team: args.team.id,
    decisions,
    shape,
    metrics: {
      phase,
      presserCount: pressers.length,
      ...(tactics ? { pressingIntensity: tactics.pressingIntensity } : {}),
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
  tactics?: SpatialTacticsInput;
}): Record<TeamId, SpatialAIPlan> {
  return {
    home: planTeamSpatialAI({ ...args, team: args.teams.home }),
    away: planTeamSpatialAI({ ...args, team: args.teams.away })
  };
}
