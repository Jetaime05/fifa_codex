import * as THREE from "three";
import type { GameAction, GameActionName } from "./types";

export type ActionHandlers = Partial<Record<GameActionName, (action?: GameAction) => void>>;

/**
 * Maps the input stick's x/right and z/forward axes onto the camera's
 * horizontal frame. Both the follow camera and the sideline broadcast camera
 * use this helper, so controls stay screen-relative when the camera moves.
 */
export function cameraRelativeDirection(direction: THREE.Vector3, cameraForward: THREE.Vector3) {
  const forward = cameraForward.clone().setY(0);
  if (forward.lengthSq() < 0.000001) forward.set(0, 0, 1);
  else forward.normalize();
  // Camera forward points from the lens into the pitch. Screen-right is the
  // forward × world-up basis (the previous up × forward order mirrored
  // horizontal controls in the sideline view).
  const right = forward.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
  return right.multiplyScalar(direction.x).add(forward.multiplyScalar(direction.z));
}

/** Single action boundary shared by keyboard, touch, and future gamepad input. */
export class MatchController {
  constructor(private readonly handlers: ActionHandlers) {}
  dispatch(actions: GameAction[]) {
    for (const action of actions) this.handlers[action.type]?.(action);
  }
}
