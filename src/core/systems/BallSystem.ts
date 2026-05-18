import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";

type BallPhysicsInput = {
  ball: SimBall;
  ballOwner: SimPlayer | null;
  dt: number;
  bounds: FieldBounds;
  ballRadius: number;
  goalWidth: number;
  playerForward: (player: SimPlayer) => THREE.Vector3;
  onGoal: (team: TeamId) => void;
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
  onGoal
}: BallPhysicsInput) {
  if (ballOwner) {
    const forward = playerForward(ballOwner);
    const foot = ballOwner.position.clone().add(forward.multiplyScalar(1.05));
    foot.y = ballRadius;
    ball.position.lerp(foot, clamp(dt * 18, 0, 1));
    ball.mesh.position.copy(ball.position);
    return;
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

  if (Math.abs(ball.position.x) > bounds.halfWidth - ballRadius) {
    ball.position.x = Math.sign(ball.position.x) * (bounds.halfWidth - ballRadius);
    ball.velocity.x *= -0.52;
  }

  const inGoalMouth = Math.abs(ball.position.x) < goalWidth / 2 && ball.position.y < 4.8;
  if (Math.abs(ball.position.z) > bounds.halfLength - ballRadius) {
    if (inGoalMouth && Math.abs(ball.position.z) > bounds.halfLength + 0.8) {
      onGoal(ball.position.z > 0 ? "home" : "away");
      return;
    }
    if (Math.abs(ball.position.z) > bounds.halfLength - ballRadius && !inGoalMouth) {
      ball.position.z = Math.sign(ball.position.z) * (bounds.halfLength - ballRadius);
      ball.velocity.z *= -0.42;
    }
  }

  ball.mesh.position.copy(ball.position);
  ball.mesh.rotation.x += ball.velocity.z * dt * 0.7;
  ball.mesh.rotation.z -= ball.velocity.x * dt * 0.7;
}
