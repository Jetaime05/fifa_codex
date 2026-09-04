import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";
import { isGoalCrossed, isInsideGoalMouth } from "./MatchRuleSystem";
import { resolveOutOfPlay } from "./RestartSystem";
import type { AttackingDirections, RestartPlan } from "./RestartSystem";

type BallPhysicsInput = {
  ball: SimBall;
  ballOwner: SimPlayer | null;
  dt: number;
  bounds: FieldBounds;
  ballRadius: number;
  goalWidth: number;
  playerForward: (player: SimPlayer) => THREE.Vector3;
  onGoal: (team: TeamId) => void;
  /** Opt into Phase 4 boundaries. Omitting this retains the legacy rebound game. */
  onOutOfPlay?: (restart: RestartPlan) => void;
  lastTouchTeam?: TeamId | null;
  attackingDirections?: AttackingDirections;
};

export type BallKickOptions = {
  /** Spin around the local x/y/z axes. y is the horizontal curl placeholder. */
  spin?: THREE.Vector3;
  /** Convenience alias for horizontal curl when a full spin vector is not needed. */
  curve?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function updateBallPhysics({
  ball,
  ballOwner,
  dt,
  bounds,
  ballRadius,
  goalWidth,
  playerForward,
  onGoal,
  onOutOfPlay,
  lastTouchTeam,
  attackingDirections
}: BallPhysicsInput) {
  const previousPosition = ball.position.clone();
  const checkBoundary = () => {
    if (!onOutOfPlay) return false;
    const result = resolveOutOfPlay({ previousPosition, position: ball.position, bounds, ballRadius, goalWidth, lastTouchTeam: ballOwner?.team ?? lastTouchTeam, attackingDirections });
    if (!result) return false;
    ball.mesh.position.copy(ball.position);
    if (result.kind === "goal") onGoal(result.team);
    else onOutOfPlay(result.restart);
    return true;
  };
  if (ballOwner) {
    const forward = playerForward(ballOwner);
    const foot = ballOwner.position.clone().add(forward.multiplyScalar(1.05));
    foot.y = ballRadius;
    ball.position.lerp(foot, clamp(dt * 18, 0, 1));
    if (ball.spin) ball.spin.multiplyScalar(Math.pow(0.08, dt));
    ball.mesh.position.copy(ball.position);
    checkBoundary();
    return;
  }

  // Phase 2 placeholder spin: y bends the horizontal velocity and x adds a
  // small backspin/lift bias. Keeping this in BallSystem means passing and
  // shooting can share the same trajectory contract without owning physics.
  if (ball.spin && ball.spin.lengthSq() > 0.000001) {
    const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (horizontalSpeed > 0.05) {
      const curve = ball.spin.y * 0.035 * horizontalSpeed * dt;
      const perpendicularX = -ball.velocity.z / horizontalSpeed;
      const perpendicularZ = ball.velocity.x / horizontalSpeed;
      ball.velocity.x += perpendicularX * curve;
      ball.velocity.z += perpendicularZ * curve;
    }
    ball.velocity.y += ball.spin.x * 1.8 * dt;
    ball.spin.multiplyScalar(Math.pow(0.24, dt));
  }

  ball.velocity.y -= 12.5 * dt;
  ball.position.addScaledVector(ball.velocity, dt);

  if (ball.position.y < ballRadius) {
    ball.position.y = ballRadius;
    if (ball.velocity.y < 0) {
      ball.velocity.y *= -0.32;
    }
    const friction = Math.pow(0.28, dt);
    ball.velocity.x *= friction;
    ball.velocity.z *= friction;
  } else {
    const air = Math.pow(0.91, dt);
    ball.velocity.x *= air;
    ball.velocity.z *= air;
  }

  if (checkBoundary()) return;

  if (!onOutOfPlay && Math.abs(ball.position.x) > bounds.halfWidth - ballRadius) {
    ball.position.x = Math.sign(ball.position.x) * (bounds.halfWidth - ballRadius);
    ball.velocity.x *= -0.52;
  }

  if (!onOutOfPlay && Math.abs(ball.position.z) > bounds.halfLength - ballRadius) {
    if (isGoalCrossed(ball.position.z, ball.position.x, ball.position.y, bounds.halfLength, goalWidth)) {
      onGoal(ball.position.z > 0 ? "home" : "away");
      return;
    }
    // Leave the goal mouth open while the ball travels from the pitch edge
    // to the scoring plane. Bouncing here used to make 60 Hz goals impossible.
    if (!isInsideGoalMouth(ball.position.x, ball.position.y, goalWidth)) {
      ball.position.z = Math.sign(ball.position.z) * (bounds.halfLength - ballRadius);
      ball.velocity.z *= -0.42;
    }
  }

  ball.mesh.position.copy(ball.position);
  ball.mesh.rotation.x += ball.velocity.z * dt * 0.7;
  ball.mesh.rotation.z -= ball.velocity.x * dt * 0.7;
}

export function kickBall(ball: SimBall, target: THREE.Vector3, strength: number, lift = 0, options: BallKickOptions = {}) {
  const direction = target.clone().sub(ball.position);
  if (direction.lengthSq() < 0.000001) {
    direction.set(0, 0, 1);
  } else {
    direction.normalize();
  }
  ball.velocity.copy(direction.multiplyScalar(strength));
  ball.velocity.y += lift;
  if (ball.spin) ball.spin.set(0, 0, 0);
  if (options.spin || options.curve !== undefined) {
    if (!ball.spin) ball.spin = new THREE.Vector3();
    if (options.spin) ball.spin.copy(options.spin);
    if (options.curve !== undefined) ball.spin.y = options.curve;
  }
}

/** Apply a precomputed trajectory from PassingSystem or ShootingSystem. */
export function applyBallTrajectory(ball: SimBall, velocity: THREE.Vector3, spin?: THREE.Vector3) {
  ball.velocity.copy(velocity);
  if (spin) {
    if (!ball.spin) ball.spin = new THREE.Vector3();
    ball.spin.copy(spin);
  } else if (ball.spin) {
    ball.spin.set(0, 0, 0);
  }
  return ball;
}
