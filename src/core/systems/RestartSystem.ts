import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimPlayer } from "./types";

export type RestartKind = "throwIn" | "goalKick" | "corner" | "kickoff" | "freeKick" | "penalty";
export type RestartPlan = { kind: RestartKind; team: TeamId; position: THREE.Vector3; reason: string };
export type AttackingDirections = Record<TeamId, number>;
const defaultDirections: AttackingDirections = { home: 1, away: -1 };
const opposite = (team: TeamId): TeamId => team === "home" ? "away" : "home";
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export type GoalLineCrossing = {
  /** Direction of travel toward the goal: +1 or -1 on the pitch z axis. */
  direction: 1 | -1;
  /** First point at which the whole ball is beyond the pitch goal line. */
  position: THREE.Vector3;
  /** Segment fraction for the crossing point. */
  t: number;
  /** Whole-ball goal-plane coordinate in the supplied field units. */
  plane: number;
};

/**
 * Sweeps a ball to the whole-ball goal line. The goal line is the pitch edge
 * plus the ball radius; goal depth is presentation/scene geometry and must
 * not delay adjudication or let a keeper rescue an already-scored ball.
 */
export function sweepGoalLineCrossing({ previousPosition, position, bounds, ballRadius, goalWidth, goalHeight = 4.8, direction }: {
  previousPosition: THREE.Vector3;
  position: THREE.Vector3;
  bounds: FieldBounds;
  ballRadius: number;
  goalWidth: number;
  goalHeight?: number;
  direction?: number;
}): GoalLineCrossing | null {
  const radius = Math.max(0, Number.isFinite(ballRadius) ? ballRadius : 0);
  const delta = position.z - previousPosition.z;
  const side: 1 | -1 = (direction ?? Math.sign(delta)) < 0 ? -1 : 1;
  const plane = bounds.halfLength + radius;
  const before = previousPosition.z * side;
  const after = position.z * side;
  if (after < plane) return null;
  const rawT = before >= plane
    ? 0
    : Math.abs(delta) < 0.000001
      ? 1
      : (side * plane - previousPosition.z) / delta;
  if (rawT < 0 || rawT > 1) return null;
  const t = clamp(rawT, 0, 1);
  const crossingPosition = previousPosition.clone().lerp(position, t);
  // The entire sphere must fit inside the posts and below the crossbar at the
  // exact swept line. Equality is a post/crossbar contact, not a goal.
  if (Math.abs(crossingPosition.x) + radius >= goalWidth / 2 || crossingPosition.y + radius >= goalHeight) return null;
  return { direction: side, position: crossingPosition, t, plane };
}

export function createRestartPlan({ kind, team, position = new THREE.Vector3(), bounds, ballRadius = 0.55, attackingDirection = defaultDirections[team], reason = kind }: {
  kind: RestartKind; team: TeamId; position?: THREE.Vector3; bounds: FieldBounds;
  ballRadius?: number; attackingDirection?: number; reason?: string;
}): RestartPlan {
  const point = position.clone();
  const inset = ballRadius + 0.1;
  const lengthScale = bounds.halfLength / 52.5;
  const widthScale = bounds.halfWidth / 34;
  point.x = clamp(point.x, -bounds.halfWidth + inset, bounds.halfWidth - inset);
  point.z = clamp(point.z, -bounds.halfLength + inset, bounds.halfLength - inset);
  if (kind === "kickoff") point.set(0, ballRadius, 0);
  if (kind === "goalKick") point.set(clamp(point.x, -8 * widthScale, 8 * widthScale), ballRadius, -attackingDirection * (bounds.halfLength - 5.5 * lengthScale));
  if (kind === "penalty") point.set(0, ballRadius, attackingDirection * (bounds.halfLength - 11 * lengthScale));
  point.y = ballRadius;
  return { kind, team, position: point, reason };
}

/** Sweep to the first whole-ball boundary crossing, so diagonal exits have one owner. */
export function resolveOutOfPlay({ previousPosition, position, bounds, ballRadius, goalWidth, lastTouchTeam, attackingDirections = defaultDirections }: {
  previousPosition: THREE.Vector3; position: THREE.Vector3; bounds: FieldBounds; ballRadius: number;
  goalWidth: number; lastTouchTeam?: TeamId | null; attackingDirections?: AttackingDirections;
}): { kind: "goal"; team: TeamId; position: THREE.Vector3 } | { kind: "restart"; restart: RestartPlan } | null {
  const crossings: { axis: "x" | "z"; side: number; t: number }[] = [];
  for (const axis of ["x", "z"] as const) {
    const limit = (axis === "x" ? bounds.halfWidth : bounds.halfLength) + ballRadius;
    for (const side of [-1, 1]) {
      if (position[axis] * side < limit) continue;
      const delta = position[axis] - previousPosition[axis];
      const t = previousPosition[axis] * side >= limit ? 0 : delta === 0 ? 1 : (side * limit - previousPosition[axis]) / delta;
      if (t >= 0 && t <= 1) crossings.push({ axis, side, t });
    }
  }
  crossings.sort((a, b) => a.t - b.t || (a.axis === "x" ? -1 : 1));
  const crossing = crossings[0];
  if (!crossing) return null;
  const point = previousPosition.clone().lerp(position, crossing.t);
  if (crossing.axis === "x") {
    return { kind: "restart", restart: createRestartPlan({ kind: "throwIn", team: opposite(lastTouchTeam ?? "home"), position: point, bounds, ballRadius, reason: "Ball wholly crossed the touchline" }) };
  }
  const scoringTeam: TeamId = Math.sign(attackingDirections.home) === crossing.side ? "home" : "away";
  const goalCrossing = sweepGoalLineCrossing({
    previousPosition,
    position,
    bounds,
    ballRadius,
    goalWidth,
    direction: crossing.side
  });
  if (goalCrossing) {
    return { kind: "goal", team: scoringTeam, position: goalCrossing.position };
  }
  const defendingTeam = opposite(scoringTeam);
  const kind = lastTouchTeam === defendingTeam ? "corner" : "goalKick";
  const team = kind === "corner" ? scoringTeam : defendingTeam;
  if (kind === "corner") point.x = (point.x < 0 ? -1 : 1) * bounds.halfWidth;
  return { kind: "restart", restart: createRestartPlan({ kind, team, position: point, bounds, ballRadius, attackingDirection: attackingDirections[team], reason: kind === "corner" ? "Defender touched last before the goal line" : "Attacker touched last before the goal line (or unknown last touch)" }) };
}

/** Arrange only the eligible players supplied by the caller. Does not alter formation homes. */
export function positionRestart({ restart, players, bounds, ballRadius = 0.55, attackingDirections = defaultDirections, preferredTakerId }: {
  restart: RestartPlan; players: SimPlayer[]; bounds: FieldBounds; ballRadius?: number; attackingDirections?: AttackingDirections;
  preferredTakerId?: string;
}) {
  const direction = attackingDirections[restart.team];
  const ballPosition = restart.position.clone();
  ballPosition.y = ballRadius;
  const teammates = players.filter((player) => player.team === restart.team);
  const preferred = teammates.filter((player) => restart.kind === "goalKick" ? player.role === "GK" : player.role !== "GK");
  const preferredTaker = teammates.find((player) => player.id === preferredTakerId);
  const taker = preferredTaker ?? [...(preferred.length ? preferred : teammates)].sort((a, b) => a.position.distanceToSquared(ballPosition) - b.position.distanceToSquared(ballPosition) || a.id.localeCompare(b.id))[0] ?? null;
  const receiver = restart.kind === "penalty" ? null : teammates.filter((player) => player !== taker && player.role !== "GK").sort((a, b) => a.position.distanceToSquared(ballPosition) - b.position.distanceToSquared(ballPosition) || a.id.localeCompare(b.id))[0] ?? null;
  const target = ballPosition.clone();
  if (restart.kind === "penalty") target.set(0, ballRadius, direction * (bounds.halfLength + 1));
  else if (restart.kind === "kickoff") target.set(8, ballRadius, -direction * 2);
  else if (restart.kind === "corner") target.set(Math.sign(ballPosition.x) * 5, ballRadius, direction * (bounds.halfLength - 12));
  else if (restart.kind === "throwIn") target.add(new THREE.Vector3(-Math.sign(ballPosition.x) * 12, 0, direction * 3));
  else target.add(new THREE.Vector3(ballPosition.x > 0 ? -6 : 6, 0, direction * 12));
  if (restart.kind !== "penalty") {
    target.x = clamp(target.x, -bounds.halfWidth + 2, bounds.halfWidth - 2);
    target.z = clamp(target.z, -bounds.halfLength + 2, bounds.halfLength - 2);
  }
  const lengthScale = bounds.halfLength / 52.5;
  const minOpponentDistance = restart.kind === "throwIn" ? 2 : restart.kind === "penalty" ? 9.15 * lengthScale : 9.15;
  const defendingKeeper = restart.kind === "penalty" ? players.find((player) => player.team !== restart.team && player.role === "GK") : undefined;
  for (const player of players) {
    player.hasBall = false;
    player.velocity.set(0, 0, 0);
    player.cooldown = 0;
    if (restart.kind === "kickoff") {
      player.position.copy(player.home);
      const ownDirection = attackingDirections[player.team];
      player.position.z = -ownDirection * Math.max(2, Math.abs(player.position.z));
    }
    player.position.x = clamp(player.position.x, -bounds.halfWidth + 1, bounds.halfWidth - 1);
    player.position.z = clamp(player.position.z, -bounds.halfLength + 1, bounds.halfLength - 1);
    if (restart.kind === "penalty") {
      if (player === defendingKeeper) {
        // The defending goalkeeper is the sole exception to the exclusion area.
        player.position.set(0, 0, direction * (bounds.halfLength - 0.1));
        player.mesh.rotation.y = direction > 0 ? Math.PI : 0;
      } else if (player !== taker) {
        const penaltyAreaEdge = bounds.halfLength - 16.5 * lengthScale;
        const waitingLine = Math.min(penaltyAreaEdge - 0.2, ballPosition.z * direction - minOpponentDistance - 0.2);
        player.position.z = direction * Math.min(player.position.z * direction, waitingLine);
      }
    } else if (player.team !== restart.team && player.position.clone().setY(ballRadius).distanceTo(ballPosition) < minOpponentDistance) {
      // Move toward the field centre: this always leaves space at corner/touchline restarts.
      const away = new THREE.Vector3(-ballPosition.x, 0, -ballPosition.z);
      if (away.lengthSq() < 0.01) away.set(player.position.x < 0 ? -1 : 1, 0, -attackingDirections[player.team]);
      away.normalize();
      player.position.copy(ballPosition).addScaledVector(away, minOpponentDistance + 0.2);
      player.position.y = 0;
    }
    if (restart.kind === "kickoff" && player.team !== restart.team) {
      // Reassert the own-half invariant after centre-circle exclusion.
      const ownDirection = attackingDirections[player.team];
      player.position.z = -ownDirection * Math.max(0.1, Math.abs(player.position.z));
    }
    player.mesh.position.copy(player.position);
  }
  if (receiver) {
    receiver.position.copy(target).setY(0);
    receiver.mesh.position.copy(receiver.position);
  }
  if (taker) {
    const forward = target.clone().sub(ballPosition).setY(0).normalize();
    taker.position.copy(ballPosition).addScaledVector(forward, -1.05).setY(0);
    taker.position.x = clamp(taker.position.x, -bounds.halfWidth + 0.1, bounds.halfWidth - 0.1);
    taker.position.z = clamp(taker.position.z, -bounds.halfLength + 0.1, bounds.halfLength - 0.1);
    taker.mesh.position.copy(taker.position);
    taker.mesh.rotation.y = Math.atan2(forward.x, forward.z);
  }
  return { taker, receiver, ballPosition, target, minOpponentDistance };
}
