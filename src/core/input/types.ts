import * as THREE from "three";

/** Input names are semantic so keyboard, touch and future gamepad controls
 * feed the same contextual football actions. */
export type GameActionName =
  | "move" | "sprint" | "pass" | "throughPass" | "lobPass" | "cross" | "shoot" | "chipShot"
  | "tackle" | "switchPlayer" | "switchCamera" | "restart" | "pause";
export type GameAction = {
  type: GameActionName;
  pressed?: boolean;
  direction?: THREE.Vector3;
};

export type InputState = {
  direction: THREE.Vector3;
  sprint: boolean;
  actions: Set<GameActionName>;
};
