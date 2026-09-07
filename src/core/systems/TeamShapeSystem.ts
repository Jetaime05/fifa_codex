import * as THREE from "three";
import type { TeamData, TeamId } from "../../data/types";
import type { FieldBounds, SimPlayer } from "./types";
import {
  getPlayerInstruction,
  getTacticalModifiers,
  getTacticalTargetOverride,
  resolveTeamTactics,
  type RuntimePlayerInstruction,
  type RuntimeTeamTactics,
  type RuntimeTeamTacticsByTeam
} from "./TacticsSystem";

export type TeamPhase = "attacking" | "defending";

export type TeamShapeConfig = {
  attackingAdvance: number;
  defensiveDrop: number;
  attackingWidth: number;
  defensiveWidth: number;
  attackingBallShift: number;
  defensiveBallShift: number;
  supportRunnerCount: number;
  supportRunForward: number;
  supportRunLateral: number;
  markingRadius: number;
  maxMarkers: number;
};

export type TeamShapeTarget = {
  playerId: string;
  position: THREE.Vector3;
  source: "shape" | "support" | "mark";
  /** Present when a runtime instruction, rather than the base shape, guides the target. */
  instruction?: RuntimePlayerInstruction;
};

export type MarkingAssignment = {
  markerId: string;
  opponentId: string;
  target: THREE.Vector3;
};

export type TeamShapePlan = {
  team: TeamId;
  phase: TeamPhase;
  targets: TeamShapeTarget[];
  supportRunnerIds: string[];
  markingAssignments: MarkingAssignment[];
};

export const DEFAULT_TEAM_SHAPE_CONFIG: Readonly<TeamShapeConfig> = {
  attackingAdvance: 8,
  defensiveDrop: 4,
  attackingWidth: 1.08,
  defensiveWidth: 0.82,
  attackingBallShift: 0.18,
  defensiveBallShift: 0.28,
  supportRunnerCount: 3,
  supportRunForward: 7,
  supportRunLateral: 5,
  markingRadius: 13,
  maxMarkers: 4
};

const roleAdvance: Record<SimPlayer["role"], number> = { GK: 0, DEF: 0.35, MID: 0.72, FWD: 1 };
const clampTarget = (target: THREE.Vector3, bounds: FieldBounds) => {
  target.x = THREE.MathUtils.clamp(target.x, -bounds.halfWidth + 3, bounds.halfWidth - 3);
  target.z = THREE.MathUtils.clamp(target.z, -bounds.halfLength + 3, bounds.halfLength - 3);
  target.y = 0;
  return target;
};

/** Formation anchors become a compact block out of possession and a wider, higher block in possession. */
export function calculateBaseShapeTargets(args: {
  players: readonly SimPlayer[];
  team: TeamData;
  phase: TeamPhase;
  ballPosition: THREE.Vector3;
  bounds: FieldBounds;
  config?: Partial<TeamShapeConfig>;
  tactics?: RuntimeTeamTactics | RuntimeTeamTacticsByTeam;
}): TeamShapeTarget[] {
  const { players, team, phase, ballPosition, bounds } = args;
  const config = { ...DEFAULT_TEAM_SHAPE_CONFIG, ...args.config };
  const tactics = resolveTeamTactics(args.tactics, team.id);
  const tacticalModifiers = tactics ? getTacticalModifiers(tactics) : undefined;
  const attacking = phase === "attacking";
  const width = (attacking ? config.attackingWidth : config.defensiveWidth) * (tacticalModifiers?.widthMultiplier ?? 1);
  const shift = ballPosition.x * (attacking ? config.attackingBallShift : config.defensiveBallShift);
  return players
    .map((player): TeamShapeTarget => {
      if (player.role === "GK") return { playerId: player.id, position: player.home.clone(), source: "shape" };
      const advance = attacking
        ? config.attackingAdvance * roleAdvance[player.role] * team.attackingDirection
        : -config.defensiveDrop * team.attackingDirection;
      const blockShift = THREE.MathUtils.clamp(ballPosition.z * 0.2, -9, 9);
      const target = new THREE.Vector3(
        player.home.x * width + shift,
        0,
        player.home.z + advance + blockShift + (tacticalModifiers?.lineDepthShift ?? 0) * team.attackingDirection
      );
      const instruction = tactics ? getPlayerInstruction(tactics, player) : "balanced";
      const overridden = tactics
        ? getTacticalTargetOverride({
          target,
          playerId: player.id,
          short: player.short,
          number: player.number,
          role: player.role,
          homeX: player.home.x,
          attackingDirection: team.attackingDirection,
          tactics
        })
        : target;
      return {
        playerId: player.id,
        position: clampTarget(overridden, bounds),
        source: "shape",
        ...(tactics && instruction !== "balanced" ? { instruction } : {})
      };
    })
    .sort((a, b) => a.playerId.localeCompare(b.playerId));
}

/** Selects a small stable set of midfield/forward runners around, not on top of, the carrier. */
export function applySupportRuns(args: {
  targets: readonly TeamShapeTarget[];
  players: readonly SimPlayer[];
  ballOwner: SimPlayer;
  team: TeamData;
  bounds: FieldBounds;
  config?: Partial<TeamShapeConfig>;
  tactics?: RuntimeTeamTactics | RuntimeTeamTacticsByTeam;
}): { targets: TeamShapeTarget[]; supportRunnerIds: string[] } {
  const { players, ballOwner, team, bounds } = args;
  const config = { ...DEFAULT_TEAM_SHAPE_CONFIG, ...args.config };
  const tactics = resolveTeamTactics(args.tactics, team.id);
  const tacticalModifiers = tactics ? getTacticalModifiers(tactics) : undefined;
  const supportRunForward = config.supportRunForward * (tacticalModifiers?.supportForwardMultiplier ?? 1);
  const supportRunLateral = config.supportRunLateral * (tacticalModifiers?.supportLateralMultiplier ?? 1);
  const candidates = players
    .filter((player) => player.id !== ballOwner.id && player.role !== "GK" && player.role !== "DEF")
    .filter((player) => getPlayerInstruction(tactics, player) !== "stayBack")
    .sort((a, b) => {
      const instructionA = getPlayerInstruction(tactics, a);
      const instructionB = getPlayerInstruction(tactics, b);
      const getForwardA = instructionA === "getForward" ? 0 : 1;
      const getForwardB = instructionB === "getForward" ? 0 : 1;
      const roleA = a.role === "FWD" ? 0 : 1;
      const roleB = b.role === "FWD" ? 0 : 1;
      return getForwardA - getForwardB || roleA - roleB || a.position.distanceToSquared(ballOwner.position) - b.position.distanceToSquared(ballOwner.position) || a.id.localeCompare(b.id);
    })
    .slice(0, config.supportRunnerCount);
  const runnerIds = new Set(candidates.map((player) => player.id));
  const targets = args.targets.map((shapeTarget): TeamShapeTarget => {
    if (!runnerIds.has(shapeTarget.playerId)) return { ...shapeTarget, position: shapeTarget.position.clone() };
    const player = candidates.find((candidate) => candidate.id === shapeTarget.playerId)!;
    const runnerIndex = candidates.indexOf(player);
    const side = player.home.x === 0 ? (player.id.localeCompare(ballOwner.id) < 0 ? -1 : 1) : Math.sign(player.home.x);
    const position = shapeTarget.position.clone();
    const carrierProgress = ballOwner.position.z * team.attackingDirection;
    const anchorProgress = position.z * team.attackingDirection + supportRunForward;
    // Two progressive outlets and a trailing reset option form a triangle as
    // the attack travels, rather than leaving all runners at fixed anchors.
    const supportProgress = runnerIndex === 2
      ? carrierProgress - supportRunForward
      : THREE.MathUtils.clamp(anchorProgress, carrierProgress + supportRunForward, carrierProgress + 22 * (tacticalModifiers?.supportForwardMultiplier ?? 1));
    position.z = supportProgress * team.attackingDirection;
    position.x += side * supportRunLateral;
    if (Math.abs(position.x - ballOwner.position.x) < supportRunLateral + 2) {
      position.x = ballOwner.position.x + side * (supportRunLateral + 3);
    }
    const instruction = getPlayerInstruction(tactics, player);
    return {
      playerId: player.id,
      position: clampTarget(position, bounds),
      source: "support",
      ...(tactics && instruction !== "balanced" ? { instruction } : {})
    };
  });
  return { targets, supportRunnerIds: candidates.map((player) => player.id) };
}

/** Assigns at most one zonal marker per opponent while leaving the rest of the block in shape. */
export function assignDefensiveMarkingZones(args: {
  targets: readonly TeamShapeTarget[];
  players: readonly SimPlayer[];
  opponents: readonly SimPlayer[];
  team: TeamData;
  bounds: FieldBounds;
  excludedPlayerIds?: readonly string[];
  config?: Partial<TeamShapeConfig>;
  tactics?: RuntimeTeamTactics | RuntimeTeamTacticsByTeam;
}): { targets: TeamShapeTarget[]; assignments: MarkingAssignment[] } {
  const config = { ...DEFAULT_TEAM_SHAPE_CONFIG, ...args.config };
  const excluded = new Set(args.excludedPlayerIds ?? []);
  const eligible = args.players.filter((player) => player.role !== "GK" && player.role !== "FWD" && !excluded.has(player.id));
  const dangerous = args.opponents
    .filter((player) => player.role !== "GK")
    .sort((a, b) => a.position.z * args.team.attackingDirection - b.position.z * args.team.attackingDirection || a.id.localeCompare(b.id));
  const usedMarkers = new Set<string>();
  const assignments: MarkingAssignment[] = [];
  for (const opponent of dangerous) {
    if (assignments.length >= config.maxMarkers) break;
    const marker = eligible
      .filter((player) => !usedMarkers.has(player.id) && player.home.distanceTo(opponent.position) <= config.markingRadius)
      .sort((a, b) => a.position.distanceToSquared(opponent.position) - b.position.distanceToSquared(opponent.position) || a.id.localeCompare(b.id))[0];
    if (!marker) continue;
    usedMarkers.add(marker.id);
    // Goal-side marking: stand slightly between the opponent and the defending goal.
    const target = opponent.position.clone();
    target.z -= args.team.attackingDirection * 1.8;
    assignments.push({ markerId: marker.id, opponentId: opponent.id, target: clampTarget(target, args.bounds) });
  }
  const byMarker = new Map(assignments.map((assignment) => [assignment.markerId, assignment]));
  return {
    targets: args.targets.map((shapeTarget): TeamShapeTarget => {
      const assignment = byMarker.get(shapeTarget.playerId);
      return assignment
        ? { playerId: shapeTarget.playerId, position: assignment.target.clone(), source: "mark", ...(shapeTarget.instruction ? { instruction: shapeTarget.instruction } : {}) }
        : { ...shapeTarget, position: shapeTarget.position.clone() };
    }),
    assignments
  };
}

export function buildTeamShapePlan(args: {
  players: readonly SimPlayer[];
  opponents: readonly SimPlayer[];
  team: TeamData;
  phase: TeamPhase;
  ballPosition: THREE.Vector3;
  ballOwner: SimPlayer | null;
  bounds: FieldBounds;
  excludedMarkerIds?: readonly string[];
  config?: Partial<TeamShapeConfig>;
  tactics?: RuntimeTeamTactics | RuntimeTeamTacticsByTeam;
}): TeamShapePlan {
  let targets = calculateBaseShapeTargets(args);
  let supportRunnerIds: string[] = [];
  let markingAssignments: MarkingAssignment[] = [];
  if (args.phase === "attacking" && args.ballOwner?.team === args.team.id) {
    ({ targets, supportRunnerIds } = applySupportRuns({ ...args, targets, ballOwner: args.ballOwner }));
  } else if (args.phase === "defending") {
    ({ targets, assignments: markingAssignments } = assignDefensiveMarkingZones({
      ...args,
      // The carrier already has dedicated pressers. A zonal marker must
      // cover an off-ball threat, not become an uncounted third presser.
      opponents: args.opponents.filter((opponent) => opponent.id !== args.ballOwner?.id),
      targets,
      excludedPlayerIds: args.excludedMarkerIds,
      tactics: args.tactics
    }));
  }
  return { team: args.team.id, phase: args.phase, targets, supportRunnerIds, markingAssignments };
}
