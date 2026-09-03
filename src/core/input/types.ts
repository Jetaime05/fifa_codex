import * as THREE from "three";

export type GameActionName = "move" | "sprint" | "pass" | "shoot" | "tackle" | "switchPlayer" | "switchCamera" | "restart" | "pause";
export type GameAction = { type: GameActionName; pressed?: boolean; direction?: THREE.Vector3 };

export type InputState = {
  direction: THREE.Vector3;
  sprint: boolean;
  actions: Set<GameActionName>;
};
