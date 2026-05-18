import * as THREE from "three";
import type { FieldBounds, SimPlayer } from "./types";

type MovementInput = {
  player: SimPlayer;
  inputDirection: THREE.Vector3;
  sprint: boolean;
  dt: number;
  bounds: FieldBounds;
  playerRadius: number;
  isControlled: boolean;
  hasBall: boolean;
  now?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function updatePlayerMovement({
  player,
  inputDirection,
  sprint,
  dt,
  bounds,
  playerRadius,
  isControlled,
  hasBall,
  now = performance.now()
}: MovementInput) {
  const speedBase = 6.2 + player.stats.pace * 0.052;
  const dribblePenalty = hasBall ? 0.86 : 1;
  const sprintBoost = sprint && player.stamina > 0.08 ? 1.4 : 1;
  const maxSpeed = speedBase * dribblePenalty * sprintBoost;
  const accel = 21 + player.stats.dribbling * 0.06;

  if (inputDirection.lengthSq() > 0.0001) {
    const desired = inputDirection.clone().normalize().multiplyScalar(maxSpeed);
    player.velocity.lerp(desired, clamp(dt * accel * 0.12, 0, 1));
  } else {
    player.velocity.multiplyScalar(Math.pow(0.05, dt));
  }

  if (sprint && isControlled && inputDirection.lengthSq() > 0.0001) {
    player.stamina = clamp(player.stamina - dt * 0.13, 0, 1);
  } else {
    player.stamina = clamp(player.stamina + dt * 0.045, 0, 1);
  }

  const prev = player.position.clone();
  player.position.addScaledVector(player.velocity, dt);
  player.position.x = clamp(player.position.x, -bounds.halfWidth + playerRadius, bounds.halfWidth - playerRadius);
  player.position.z = clamp(player.position.z, -bounds.halfLength + playerRadius, bounds.halfLength - playerRadius);

  if (player.velocity.lengthSq() > 0.02) {
    const angle = Math.atan2(player.velocity.x, player.velocity.z);
    player.mesh.rotation.y = THREE.MathUtils.lerp(player.mesh.rotation.y, angle, clamp(dt * 8, 0, 1));
  }

  const bob = Math.sin(now * 0.012 + player.number) * Math.min(player.velocity.length() * 0.018, 0.12);
  player.mesh.position.set(player.position.x, bob, player.position.z);

  if (prev.distanceToSquared(player.position) > 0.0001) {
    player.body.scale.y = 1 + Math.min(player.velocity.length() * 0.01, 0.08);
  } else {
    player.body.scale.y = THREE.MathUtils.lerp(player.body.scale.y, 1, dt * 8);
  }
}
