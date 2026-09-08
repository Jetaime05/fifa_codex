import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { SimBall, SimPlayer } from "./types";
import {
  DEFAULT_AERIAL_CONFIG,
  type AerialConfig
} from "./GameplayConfig";

export type AerialPlayAction = "header" | "volley" | "clearance" | "keeperClaim";

export type AerialArrival = {
  time: number;
  point: THREE.Vector3;
  descending: boolean;
};

export type AerialContestCandidate = {
  player: SimPlayer;
  distance: number;
  verticalError: number;
  score: number;
};

export type AerialContestResult = {
  action: AerialPlayAction;
  player: SimPlayer;
  point: THREE.Vector3;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  score: number;
  candidates: ReadonlyArray<AerialContestCandidate>;
};

export type AerialArrivalInput = {
  ball: Pick<SimBall, "position" | "velocity">;
  target: THREE.Vector3;
  contactHeight?: number;
  gravity?: number;
  maxTime?: number;
};

export type AerialContestInput = {
  ball: Pick<SimBall, "position" | "velocity">;
  players: readonly SimPlayer[];
  attackingTeam: TeamId;
  /** The intended cross/lob target, retained for debug and fallback aim. */
  target?: THREE.Vector3;
  /** Goal or attacking-space point used when a teammate makes the next touch. */
  goalTarget?: THREE.Vector3;
  contactHeight?: number;
  config?: Partial<AerialConfig>;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const withConfig = (config?: Partial<AerialConfig>): AerialConfig => ({
  ...DEFAULT_AERIAL_CONFIG,
  ...config
});

const DEFAULT_CONTACT_HEIGHT = 1.28;

/** True while a pending lob/cross is still airborne rather than grounded. */
export function isAerialBallAirborne(
  ball: Pick<SimBall, "position" | "velocity">,
  ballRadius = 0.22
) {
  return ball.position.y > ballRadius + 0.08 || ball.velocity.y > 0.4;
}

/**
 * Predicts the descending crossing of a contact height near a target point.
 * This is intentionally a small analytical helper rather than a second ball
 * physics implementation. It lets an acceptance test and the runtime agree
 * on when an aerial contest is physically plausible.
 */
export function predictAerialArrival(input: AerialArrivalInput): AerialArrival | null {
  const gravity = Math.max(0.001, Number.isFinite(input.gravity) ? input.gravity! : DEFAULT_AERIAL_CONFIG.gravity);
  const contactHeight = Number.isFinite(input.contactHeight) ? input.contactHeight! : DEFAULT_CONTACT_HEIGHT;
  const maxTime = Math.max(0.05, Number.isFinite(input.maxTime) ? input.maxTime! : 2.4);
  const y = input.ball.position.y;
  const vertical = input.ball.velocity.y;
  const discriminant = vertical * vertical - 2 * gravity * (contactHeight - y);
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const roots = [(vertical - root) / gravity, (vertical + root) / gravity]
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= maxTime)
    .sort((a, b) => a - b);
  if (roots.length === 0) return null;

  const horizontalSpeed = Math.hypot(input.ball.velocity.x, input.ball.velocity.z);
  const targetDistance = horizontalDistance(input.ball.position, input.target);
  const horizontalTime = horizontalSpeed > 0.05 ? targetDistance / horizontalSpeed : 0;
  // Prefer the vertical crossing that is closest to the target's horizontal
  // ETA. A target can be omitted in callers that only need the next crossing.
  const descendingRoots = roots.filter((candidate) => vertical - gravity * candidate <= 0.05);
  if (descendingRoots.length === 0) return null;
  const time = descendingRoots.reduce((best, candidate) =>
    Math.abs(candidate - horizontalTime) < Math.abs(best - horizontalTime) ? candidate : best, descendingRoots[0]);
  const point = input.ball.position.clone().addScaledVector(input.ball.velocity, time);
  point.y = contactHeight;
  return { time, point, descending: vertical - gravity * time <= 0.05 };
}

function contactPointFor(ball: THREE.Vector3) {
  // Keep the actual trajectory contact. Contest eligibility is bounded by
  // distance; it must never teleport the ball onto the winner's centre.
  return ball.clone();
}

function candidateScore(
  player: SimPlayer,
  ball: THREE.Vector3,
  contactHeight: number,
  config: AerialConfig
): AerialContestCandidate | null {
  const distance = horizontalDistance(player.position, ball);
  const keeperBonus = player.role === "GK" ? 0.1 : 0;
  const reach = player.role === "GK"
    ? config.maxJumpHeight + 0.55
    : config.maxJumpHeight;
  const verticalError = Math.abs(ball.y - (player.position.y + contactHeight));
  if (distance > config.contestRadius + (player.role === "GK" ? 0.3 : 0.0)) return null;
  if (verticalError > reach + 0.35) return null;
  const proximity = 1 - clamp(distance / Math.max(0.1, config.contestRadius), 0, 1);
  const heightFit = 1 - clamp(verticalError / Math.max(0.1, reach + 0.35), 0, 1);
  const physical = clamp(player.stats.physical / 100, 0, 1);
  return {
    player,
    distance,
    verticalError,
    score: proximity * 0.48 + heightFit * 0.3 + physical * 0.12 + keeperBonus +
      (player.role === "DEF" ? 0.04 : 0)
  };
}

function chooseTarget(
  player: SimPlayer,
  action: AerialPlayAction,
  attackingTeam: TeamId,
  requestedTarget: THREE.Vector3 | undefined,
  goalTarget: THREE.Vector3 | undefined
) {
  if (action === "keeperClaim") return player.position.clone();
  if (action === "clearance") {
    // Clear back through the defending side of the pitch, i.e. away from the
    // attacking team's goal direction. This remains correct when the second
    // half eventually flips the configured attacking directions.
    const direction = attackingTeam === "home" ? -1 : 1;
    return player.position.clone().add(new THREE.Vector3(0, 0.2, direction * 26));
  }
  if (goalTarget) return goalTarget.clone();
  if (requestedTarget) return requestedTarget.clone();
  const direction = attackingTeam === "home" ? 1 : -1;
  return new THREE.Vector3(0, 1.6, direction * 56);
}

function actionFor(player: SimPlayer, ball: Pick<SimBall, "position" | "velocity">, attackingTeam: TeamId, contactHeight: number) {
  if (player.role === "GK" && player.team !== attackingTeam) return "keeperClaim" as const;
  if (player.team !== attackingTeam) return "clearance" as const;
  // A ball arriving below the natural knee-to-waist window is a volley; a
  // descending ball above it is a header. Both are deterministic and share
  // the same contest boundary, so a defender cannot win by rerolling frames.
  return ball.position.y <= player.position.y + contactHeight * 0.9 &&
    Math.abs(ball.velocity.y) < 3.2 ? "volley" as const : "header" as const;
}

/**
 * Resolves one aerial touch. It does not mutate the ball or players and does
 * not use randomness; callers can apply the returned impulse and emit one
 * presentation/audio event at this exact contact point.
 */
export function resolveAerialContest(input: AerialContestInput): AerialContestResult | null {
  const config = withConfig(input.config);
  const contactHeight = Number.isFinite(input.contactHeight) ? input.contactHeight! : DEFAULT_CONTACT_HEIGHT;
  const descending = input.ball.velocity.y <= 0.05;
  const minimumHeight = contactHeight - 0.55;
  const maximumHeight = contactHeight + config.maxJumpHeight + 0.45;
  if (input.ball.position.y < minimumHeight || input.ball.position.y > maximumHeight || !descending) return null;

  const candidates = input.players
    .map((player) => candidateScore(player, input.ball.position, contactHeight, config))
    .filter((candidate): candidate is AerialContestCandidate => candidate !== null)
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.player.id.localeCompare(b.player.id));
  const winner = candidates[0];
  if (!winner) return null;

  const action = actionFor(winner.player, input.ball, input.attackingTeam, contactHeight);
  const point = contactPointFor(input.ball.position);
  const target = chooseTarget(winner.player, action, input.attackingTeam, input.target, input.goalTarget);
  const direction = target.clone().sub(point);
  direction.y = 0;
  if (direction.lengthSq() < 0.0001) direction.set(0, 0, winner.player.team === "home" ? 1 : -1);
  direction.normalize();
  const speed = action === "clearance"
    ? config.clearanceSpeed
    : action === "volley" ? config.volleySpeed : config.headerSpeed;
  const velocity = direction.multiplyScalar(speed);
  velocity.y = action === "clearance" ? 3.6 : action === "volley" ? 2.2 : 3.0;
  if (action === "keeperClaim") velocity.set(0, 0, 0);
  return { action, player: winner.player, point, target, velocity, score: winner.score, candidates };
}

export const resolveAerialPlay = resolveAerialContest;
