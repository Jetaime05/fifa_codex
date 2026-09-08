import * as THREE from "three";
import type { FieldBounds, SimPlayer } from "./types";

/**
 * Tuning values for the player controller.
 *
 * The values use world units/second and world units/second². Keeping these
 * values in one object makes movement tuning safe to do without changing the
 * simulation contract or the input layer.
 */
export type MovementConfig = {
  walkSpeedBase: number;
  paceSpeedScale: number;
  sprintMultiplier: number;
  /** Maximum speed reduction for a player carrying the ball. */
  dribbleSpeedPenalty: number;
  acceleration: number;
  deceleration: number;
  /** Maximum horizontal direction change in radians per second. */
  turnRateRadiansPerSecond: number;
  /** Extra deceleration applied while carrying momentum through a turn. */
  turnDeceleration: number;
  /** Rotation smoothing rate in radians per second. */
  rotationSmoothing: number;
  sprintStaminaCost: number;
  staminaRecovery: number;
  /** A player at or below this value cannot start a sprint. */
  minSprintStamina: number;
  /** Speed multiplier while a sprint is requested but the player is exhausted. */
  exhaustedSprintMultiplier: number;
};

export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  walkSpeedBase: 6.2,
  paceSpeedScale: 0.052,
  sprintMultiplier: 1.4,
  dribbleSpeedPenalty: 0.14,
  acceleration: 21,
  deceleration: 15.5,
  turnRateRadiansPerSecond: 7.5,
  turnDeceleration: 10.5,
  rotationSmoothing: 12,
  sprintStaminaCost: 0.13,
  staminaRecovery: 0.045,
  minSprintStamina: 0.08,
  exhaustedSprintMultiplier: 0.86
};

export type MovementInput = {
  player: SimPlayer;
  inputDirection: THREE.Vector3;
  sprint: boolean;
  dt: number;
  bounds: FieldBounds;
  playerRadius: number;
  isControlled: boolean;
  hasBall: boolean;
  now?: number;
  config?: Partial<MovementConfig>;
};

export type MovementResult = {
  speed: number;
  maxSpeed: number;
  sprinting: boolean;
  staminaBefore: number;
  staminaAfter: number;
  turnedByRadians: number;
  /** Signed acceleration along the current travel direction. */
  acceleration: number;
  /** Ground distance travelled during this step. */
  distanceTravelled: number;
  /** True when the player is actively braking or turning against momentum. */
  braking: boolean;
};

const EPSILON = 0.0001;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const moveTowards = (current: number, target: number, maxDelta: number) => {
  if (Math.abs(target - current) <= maxDelta) {
    return target;
  }
  return current + Math.sign(target - current) * maxDelta;
};

const normalizeStat = (value: number) => clamp(value / 100, 0, 1);

const mergeConfig = (config?: Partial<MovementConfig>): MovementConfig => ({
  ...DEFAULT_MOVEMENT_CONFIG,
  ...config
});

const horizontalDirection = (value: THREE.Vector3) => {
  const direction = value.clone();
  direction.y = 0;
  if (direction.lengthSq() <= EPSILON) {
    return null;
  }
  return direction.normalize();
};

const angleDifference = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Moves a player for one deterministic simulation step.
 *
 * Existing callers can keep passing the Phase 1 input shape. The optional
 * config and return value are additive, so the function remains a small
 * integration point for both keyboard and AI movement.
 */
export function updatePlayerMovement({
  player,
  inputDirection,
  sprint,
  dt,
  bounds,
  playerRadius,
  isControlled,
  hasBall,
  now,
  config: configOverrides
}: MovementInput): MovementResult {
  // `isControlled` remains part of the public input contract for callers that
  // need to distinguish human movement. Movement tuning is shared by humans
  // and AI so that both obey the same physical rules.
  void isControlled;
  const config = mergeConfig(configOverrides);
  const safeDt = Math.max(0, Math.min(dt, 0.25));
  const staminaBefore = clamp(player.stamina, 0, 1);
  player.stamina = staminaBefore;

  const desiredDirection = horizontalDirection(inputDirection);
  const hasInput = desiredDirection !== null;
  const sprintRequested = sprint && hasInput;
  const sprinting = sprintRequested && staminaBefore > config.minSprintStamina;

  if (sprinting) {
    player.stamina = clamp(
      staminaBefore - config.sprintStaminaCost * safeDt,
      0,
      1
    );
  } else {
    player.stamina = clamp(
      staminaBefore + config.staminaRecovery * safeDt,
      0,
      1
    );
  }

  const dribbling = normalizeStat(player.stats.dribbling);
  const baseSpeed = config.walkSpeedBase + player.stats.pace * config.paceSpeedScale;
  // A technical player loses less speed while carrying the ball. A player
  // with 0 dribbling still receives the full configured penalty.
  const dribbleMultiplier = hasBall
    ? 1 - config.dribbleSpeedPenalty * (1 - dribbling)
    : 1;
  const staminaMultiplier = sprintRequested && !sprinting
    ? config.exhaustedSprintMultiplier
    : 1;
  const maxSpeed = baseSpeed * dribbleMultiplier *
    (sprinting ? config.sprintMultiplier : 1) * staminaMultiplier;

  const currentVelocity = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
  const currentSpeed = currentVelocity.length();
  let movementDirection = desiredDirection;
  let turnedByRadians = 0;
  let requestedTurn = 0;

  if (hasInput && currentSpeed > EPSILON) {
    const currentDirection = currentVelocity.normalize();
    const currentAngle = Math.atan2(currentDirection.x, currentDirection.z);
    const desiredAngle = Math.atan2(desiredDirection!.x, desiredDirection!.z);
    requestedTurn = angleDifference(currentAngle, desiredAngle);
    const maxTurn = config.turnRateRadiansPerSecond * safeDt;
    turnedByRadians = clamp(requestedTurn, -maxTurn, maxTurn);
    const limitedAngle = currentAngle + turnedByRadians;
    movementDirection = new THREE.Vector3(
      Math.sin(limitedAngle),
      0,
      Math.cos(limitedAngle)
    );
  } else if (!hasInput && currentSpeed > EPSILON) {
    // Preserve the current travel direction while braking. Without this,
    // stopping input would leave no direction to scale the remaining speed.
    movementDirection = currentVelocity.normalize();
  }

  const turnDemand = hasInput && currentSpeed > EPSILON
    ? clamp(Math.abs(requestedTurn) / Math.PI, 0, 1)
    : 0;
  let nextSpeed = hasInput
    ? moveTowards(currentSpeed, maxSpeed, config.acceleration * safeDt)
    : moveTowards(currentSpeed, 0, config.deceleration * safeDt);
  if (turnDemand > 0) {
    nextSpeed = Math.max(0, nextSpeed - turnDemand * config.turnDeceleration * safeDt);
  }
  const acceleration = safeDt > EPSILON ? (nextSpeed - currentSpeed) / safeDt : 0;
  const braking = currentSpeed > EPSILON && (!hasInput || (turnDemand > 0.12 && nextSpeed < currentSpeed));

  if (nextSpeed <= EPSILON) {
    player.velocity.set(0, 0, 0);
  } else {
    // A non-zero velocity always has a direction, even during deceleration.
    const direction = movementDirection ?? new THREE.Vector3(0, 0, 1);
    player.velocity.x = direction.x * nextSpeed;
    player.velocity.y = 0;
    player.velocity.z = direction.z * nextSpeed;
  }

  const previousPosition = player.position.clone();
  player.position.addScaledVector(player.velocity, safeDt);
  player.position.x = clamp(
    player.position.x,
    -bounds.halfWidth + playerRadius,
    bounds.halfWidth - playerRadius
  );
  player.position.z = clamp(
    player.position.z,
    -bounds.halfLength + playerRadius,
    bounds.halfLength - playerRadius
  );

  // Rotate toward actual movement, with a shortest-path interpolation and a
  // hard angular rate cap. This prevents a 180° input flip from snapping the
  // player while still allowing a stationary player to face a new direction.
  const facingDirection = nextSpeed > EPSILON
    ? movementDirection ?? new THREE.Vector3(0, 0, 1)
    : desiredDirection;
  if (facingDirection) {
    const desiredAngle = Math.atan2(facingDirection.x, facingDirection.z);
    const currentAngle = player.mesh.rotation.y;
    const delta = angleDifference(currentAngle, desiredAngle);
    const smoothingAlpha = 1 - Math.exp(-config.rotationSmoothing * safeDt);
    const maxRotation = config.turnRateRadiansPerSecond * safeDt;
    const rotationStep = clamp(delta * smoothingAlpha, -maxRotation, maxRotation);
    player.mesh.rotation.y = currentAngle + rotationStep;
  }

  // Gameplay owns the root transform. Presentation may animate a child rig,
  // but a frame clock must never bob or squash the collision body.
  void now;
  player.mesh.position.set(player.position.x, player.position.y, player.position.z);
  player.body.scale.y = 1;

  return {
    speed: nextSpeed,
    maxSpeed,
    sprinting,
    staminaBefore,
    staminaAfter: player.stamina,
    turnedByRadians,
    acceleration,
    distanceTravelled: previousPosition.distanceTo(player.position),
    braking
  };
}
