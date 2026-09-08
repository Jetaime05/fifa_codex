import * as THREE from "three";
import type { FieldBounds, SimPlayer } from "./types";

export type CollisionInput = {
  players: SimPlayer[];
  /** Kept for source compatibility; every body now separates symmetrically. */
  activePlayer?: SimPlayer;
  playerRadius: number;
  /** Optional multiplier for formations with different body radii. */
  radiusMultiplier?: number;
  /** Optional pitch clamp applied after each solver pass. */
  bounds?: FieldBounds;
  /** A second pass resolves chains of three or more overlapping bodies. */
  iterations?: number;
  /** Shared movement cap; defaults to the existing pace/sprint envelope. */
  maxSpeed?: (player: SimPlayer) => number;
};

export type PlayerCollision = {
  firstId: string;
  secondId: string;
  distanceBefore: number;
  overlap: number;
  normal: { x: number; y: number; z: number };
};

const EPSILON = 0.000001;

const stableNormal = (a: SimPlayer, b: SimPlayer) => {
  // A deterministic id-derived axis avoids NaNs when two bodies spawn at the
  // same location and keeps replays independent of array order. The canonical
  // pair makes reversing the input array produce the same world separation.
  const canonicalFirst = a.id <= b.id ? a.id : b.id;
  const canonicalSecond = a.id <= b.id ? b.id : a.id;
  let hash = 2166136261;
  for (const char of `${canonicalFirst}:${canonicalSecond}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const axis = Math.abs(hash) % 2;
  const sign = (hash & 2) === 0 ? 1 : -1;
  const canonicalNormal = axis === 0
    ? new THREE.Vector3(sign, 0, 0)
    : new THREE.Vector3(0, 0, sign);
  return a.id <= b.id ? canonicalNormal : canonicalNormal.negate();
};

/**
 * Resolves body overlap for both controlled and AI players. The previous
 * active-player exemption let the human capsule pass through opponents and
 * made body contact depend on which player happened to be selected.
 */
export function separatePlayers({ players, playerRadius, radiusMultiplier = 1, bounds, iterations = 2, maxSpeed }: CollisionInput): PlayerCollision[] {
  const collisions: PlayerCollision[] = [];
  const safeRadius = Math.max(0, playerRadius * Math.max(0.1, radiusMultiplier));
  const min = safeRadius * 1.58;
  for (let pass = 0; pass < Math.max(1, Math.floor(iterations)); pass += 1) {
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const a = players[i];
        const b = players[j];
        const delta = a.position.clone().sub(b.position);
        const distance = delta.length();
        if (distance >= min || min <= EPSILON) continue;
        const normal = distance > EPSILON
          ? delta.multiplyScalar(1 / distance)
          : stableNormal(a, b);
        const overlap = min - distance;
        const push = normal.clone().multiplyScalar(overlap * 0.5);
        a.position.add(push);
        b.position.sub(push);
        // Remove only inward relative velocity. This makes a contact settle
        // without stealing a player's tangential momentum or creating energy.
        const relative = a.velocity.clone().sub(b.velocity);
        const closingSpeed = relative.dot(normal);
        if (closingSpeed < 0) {
          const impulse = normal.clone().multiplyScalar(-closingSpeed * 0.5);
          a.velocity.add(impulse);
          b.velocity.sub(impulse);
        }
        const cap = (player: SimPlayer) => Math.max(0, maxSpeed?.(player) ?? (6.2 + player.stats.pace * 0.052) * 1.4);
        const capVelocity = (player: SimPlayer) => {
          const speed = Math.hypot(player.velocity.x, player.velocity.z);
          const limit = cap(player);
          if (speed > limit && speed > EPSILON) {
            const scale = limit / speed;
            player.velocity.x *= scale;
            player.velocity.z *= scale;
          }
        };
        capVelocity(a);
        capVelocity(b);
        collisions.push({
          firstId: a.id,
          secondId: b.id,
          distanceBefore: distance,
          overlap,
          normal: { x: normal.x, y: normal.y, z: normal.z }
        });
      }
    }
    if (bounds) {
      for (const player of players) {
        player.position.x = Math.max(-bounds.halfWidth + safeRadius, Math.min(bounds.halfWidth - safeRadius, player.position.x));
        player.position.z = Math.max(-bounds.halfLength + safeRadius, Math.min(bounds.halfLength - safeRadius, player.position.z));
      }
    }
  }
  for (const player of players) {
    // Collision resolution can move a player after MovementSystem has synced
    // the root, so mirror the corrected grounded position immediately.
    player.mesh.position.set(player.position.x, player.position.y, player.position.z);
  }
  return collisions;
}
