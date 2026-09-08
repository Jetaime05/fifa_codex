import * as THREE from "three";

export type SweptKeeperContactInput = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  keeperCenter: THREE.Vector3;
  reach: number;
  /** Direction from the pitch toward the goal: +1 or -1 on z. */
  goalSide: number;
  wholeBallGoalPlane: number;
  maxContactHeight?: number;
};

export type SweptKeeperContact = {
  point: THREE.Vector3;
  time: number;
  planeTime: number;
};

export type KeeperGoalLineDecision =
  | { kind: "keeper-contact"; contact: SweptKeeperContact; goalPosition: THREE.Vector3 }
  | { kind: "goal"; contact: null; goalPosition: THREE.Vector3 };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function firstSphereContact(start: THREE.Vector3, end: THREE.Vector3, center: THREE.Vector3, radius: number) {
  const movement = end.clone().sub(start);
  const offset = start.clone().sub(center);
  const radiusSq = radius * radius;
  if (offset.lengthSq() <= radiusSq + 0.000001) return { time: 0, point: start.clone() };
  const a = movement.lengthSq();
  if (a <= 0.000001) return null;
  const b = 2 * offset.dot(movement);
  const c = offset.lengthSq() - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const first = (-b - root) / (2 * a);
  if (first < 0 || first > 1) return null;
  return { time: first, point: start.clone().lerp(end, first) };
}

/**
 * Returns only a swept contact that occurs before the whole-ball goal plane.
 * In particular, a ball whose segment starts beyond that plane cannot be
 * rescued by teleporting it back to a keeper.
 */
export function sweptKeeperContactBeforeGoalPlane(input: SweptKeeperContactInput): SweptKeeperContact | null {
  const side = input.goalSide >= 0 ? 1 : -1;
  const plane = Math.max(0, input.wholeBallGoalPlane);
  const startAlong = input.start.z * side;
  const endAlong = input.end.z * side;
  if (startAlong >= plane - 0.000001 || endAlong < plane - 0.000001) return null;
  const delta = input.end.z - input.start.z;
  const planeTime = delta === 0 ? 1 : clamp((side * plane - input.start.z) / delta, 0, 1);
  const contact = firstSphereContact(input.start, input.end, input.keeperCenter, Math.max(0.001, input.reach));
  if (!contact || contact.time > planeTime + 0.000001) return null;
  const maxHeight = input.maxContactHeight ?? Number.POSITIVE_INFINITY;
  if (contact.point.y > maxHeight) return null;
  return { point: contact.point, time: contact.time, planeTime };
}

/**
 * Pure goal-line adjudication seam used by the live orchestrator. It answers
 * only whether a reachable swept keeper contact exists before the whole-ball
 * line; keeper save/parry/goal probability remains in GoalkeeperSystem and is
 * still resolved exactly once by main.ts.
 */
export function adjudicateKeeperGoalLine(input: SweptKeeperContactInput): KeeperGoalLineDecision {
  const goalPosition = input.end.clone();
  const contact = sweptKeeperContactBeforeGoalPlane(input);
  return contact
    ? { kind: "keeper-contact", contact, goalPosition }
    : { kind: "goal", contact: null, goalPosition };
}
