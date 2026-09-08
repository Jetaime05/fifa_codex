import * as THREE from "three";
import type { SimBall, SimPlayer } from "./types";
import { DEFAULT_BALL_PHYSICS_CONFIG } from "./GameplayConfig";

/** Tuning values for receiving a moving ball. */
export type FirstTouchConfig = {
  /** Base control quality before stats and ball speed are applied. */
  baseControlQuality: number;
  /** Maximum quality contribution from the dribbling stat. */
  dribblingInfluence: number;
  /** Quality lost at the configured maximum incoming speed. */
  incomingSpeedPenalty: number;
  maxIncomingSpeed: number;
  /** Touch-point range for a failed versus perfect control. */
  minControlDistance: number;
  maxControlDistance: number;
  ballHeight: number;
  /** How much horizontal velocity remains after a controlled touch. */
  controlledVelocityRetention: number;
  /** How much velocity remains after a missed/poor touch. */
  missedVelocityRetention: number;
  minimumRetentionQuality: number;
  /** Optional deterministic stat jitter, normally disabled in tests. */
  randomJitter: number;
  /** Pressure applied by a nearby opponent during the receiving touch. */
  pressurePenalty: number;
  /** Portion of player momentum blended into a controlled touch. */
  receiverMomentumInfluence: number;
};

export const DEFAULT_FIRST_TOUCH_CONFIG: FirstTouchConfig = {
  baseControlQuality: 0.28,
  dribblingInfluence: 0.62,
  incomingSpeedPenalty: 0.52,
  maxIncomingSpeed: 28,
  minControlDistance: 0.72,
  maxControlDistance: 1.72,
  ballHeight: DEFAULT_BALL_PHYSICS_CONFIG.radius,
  controlledVelocityRetention: 0.16,
  missedVelocityRetention: 0.72,
  minimumRetentionQuality: 0.27,
  randomJitter: 0,
  pressurePenalty: 0.24,
  receiverMomentumInfluence: 0.18
};

export type FirstTouchInput = {
  player: SimPlayer;
  ball: SimBall;
  /** Direction the player is trying to take the touch. */
  controlDirection?: THREE.Vector3;
  incomingVelocity?: THREE.Vector3;
  /** Optional pressure context; callers can pass opponents instead. */
  pressure?: number;
  opponents?: readonly SimPlayer[];
  random?: () => number;
  config?: Partial<FirstTouchConfig>;
};

export type FirstTouchResult = {
  touchQuality: number;
  retained: boolean;
  shouldReleaseBall: boolean;
  incomingSpeed: number;
  controlDistance: number;
  controlPoint: THREE.Vector3;
  outgoingVelocity: THREE.Vector3;
  pressure: number;
};

const EPSILON = 0.0001;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const mergeConfig = (config?: Partial<FirstTouchConfig>): FirstTouchConfig => ({
  ...DEFAULT_FIRST_TOUCH_CONFIG,
  ...config
});

const normalizeStat = (value: number) => clamp(value / 100, 0, 1);

const horizontalDistance = (a: THREE.Vector3, b: THREE.Vector3) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const inferPressure = (player: SimPlayer, opponents: readonly SimPlayer[] = []) => {
  if (opponents.length === 0) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const opponent of opponents) nearest = Math.min(nearest, horizontalDistance(player.position, opponent.position));
  return clamp(1 - nearest / 4.5, 0, 1);
};

const defaultDirection = (player: SimPlayer) =>
  new THREE.Vector3(0, 0, player.team === "home" ? 1 : -1);

const resolveDirection = (
  player: SimPlayer,
  controlDirection: THREE.Vector3 | undefined,
  incomingVelocity: THREE.Vector3
) => {
  const desired = (controlDirection ?? incomingVelocity).clone();
  desired.y = 0;
  if (desired.lengthSq() <= EPSILON) {
    return defaultDirection(player);
  }
  return desired.normalize();
};

/**
 * Evaluates a first touch without mutating the ball. This is useful for UI
 * feedback, AI decisions, or a replay system that wants to inspect outcomes.
 */
export function evaluateFirstTouch({
  player,
  ball,
  controlDirection,
  incomingVelocity,
  pressure,
  opponents,
  random,
  config: configOverrides
}: FirstTouchInput): FirstTouchResult {
  const config = mergeConfig(configOverrides);
  const incoming = (incomingVelocity ?? ball.velocity).clone();
  const incomingSpeed = incoming.length();
  const dribbling = normalizeStat(player.stats.dribbling);
  const resolvedPressure = clamp(pressure ?? inferPressure(player, opponents), 0, 1);
  const speedPenalty = clamp(
    incomingSpeed / Math.max(config.maxIncomingSpeed, EPSILON),
    0,
    1
  ) * config.incomingSpeedPenalty;
  const jitter = random && config.randomJitter > 0
    ? (random() * 2 - 1) * config.randomJitter
    : 0;
  const touchQuality = clamp(
    config.baseControlQuality + dribbling * config.dribblingInfluence - speedPenalty - resolvedPressure * config.pressurePenalty + jitter,
    0,
    1
  );
  const retained = touchQuality >= config.minimumRetentionQuality;
  const controlDistance = THREE.MathUtils.lerp(
    config.maxControlDistance,
    config.minControlDistance,
    touchQuality
  );
  const direction = resolveDirection(player, controlDirection, incoming);
  const controlPoint = player.position.clone().addScaledVector(direction, controlDistance);
  controlPoint.y = config.ballHeight;

  let outgoingVelocity: THREE.Vector3;
  if (retained) {
    // A good touch kills most of the incoming pace while leaving a small
    // amount in the player's chosen direction for a natural next action.
    const incomingDirection = incoming.clone();
    incomingDirection.y = 0;
    if (incomingDirection.lengthSq() > EPSILON) incomingDirection.normalize();
    const retainedSpeed = incomingSpeed * (
      config.controlledVelocityRetention + (1 - touchQuality) * 0.36 + resolvedPressure * 0.12
    );
    const momentum = new THREE.Vector3(player.velocity.x, 0, player.velocity.z)
      .multiplyScalar(config.receiverMomentumInfluence);
    outgoingVelocity = direction.clone().multiplyScalar(retainedSpeed * 0.75)
      .add(incomingDirection.multiplyScalar(retainedSpeed * 0.25))
      .add(momentum);
  } else {
    // A poor touch keeps the incoming trajectory, making a hard pass readable
    // as a mistake rather than silently snapping to the player's feet.
    outgoingVelocity = incoming.clone().multiplyScalar(config.missedVelocityRetention);
  }

  return {
    touchQuality,
    retained,
    shouldReleaseBall: !retained,
    incomingSpeed,
    pressure: resolvedPressure,
    controlDistance,
    controlPoint,
    outgoingVelocity
  };
}

/** Applies a first-touch result to the ball and mirrors its render position. */
export function applyFirstTouch(input: FirstTouchInput): FirstTouchResult {
  const result = evaluateFirstTouch(input);
  if (result.retained) {
    input.ball.position.copy(result.controlPoint);
    input.ball.velocity.copy(result.outgoingVelocity);
  } else {
    input.ball.velocity.copy(result.outgoingVelocity);
    // Nudge a failed touch along the incoming path so it cannot be immediately
    // re-captured at the exact same point by a possession check.
    const escape = result.outgoingVelocity.clone();
    if (escape.lengthSq() > EPSILON) {
      input.ball.position.addScaledVector(
        escape.normalize(),
        Math.min(0.35, 0.08 + result.incomingSpeed * 0.01)
      );
    }
  }
  input.ball.mesh.position.copy(input.ball.position);
  return result;
}

/** Runtime-friendly name; equivalent to `applyFirstTouch`. */
export function updateFirstTouch(input: FirstTouchInput): FirstTouchResult {
  return applyFirstTouch(input);
}

export class FirstTouchSystem {
  readonly config: FirstTouchConfig;

  constructor(config: Partial<FirstTouchConfig> = {}) {
    this.config = mergeConfig(config);
  }

  evaluate(input: Omit<FirstTouchInput, "config">) {
    return evaluateFirstTouch({ ...input, config: this.config });
  }

  update(input: Omit<FirstTouchInput, "config">) {
    return applyFirstTouch({ ...input, config: this.config });
  }
}
