import type { GameAction, InputState } from "./types";
import * as THREE from "three";

const actionCodes: Record<string, GameAction["type"]> = {
  KeyJ: "pass", KeyK: "shoot", KeyL: "tackle", Tab: "switchPlayer", KeyC: "switchCamera", KeyR: "restart", Space: "pause"
};

export class KeyboardInput {
  private readonly keys = new Set<string>();
  private readonly actions = new Set<GameAction["type"]>();
  private readonly actionQueue: GameAction["type"][] = [];
  private readonly onDown = (event: KeyboardEvent) => {
    if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    const wasDown = this.keys.has(event.code);
    this.keys.add(event.code);
    const action = actionCodes[event.code];
    if (action && !wasDown) { this.actions.add(action); this.actionQueue.push(action); }
  };
  private readonly onUp = (event: KeyboardEvent) => { this.keys.delete(event.code); const action = actionCodes[event.code]; if (action) this.actions.delete(action); };

  attach(target: Window = window) { target.addEventListener("keydown", this.onDown); target.addEventListener("keyup", this.onUp); return this; }
  detach(target: Window = window) { target.removeEventListener("keydown", this.onDown); target.removeEventListener("keyup", this.onUp); }
  getState(): InputState {
    const direction = new THREE.Vector3(
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")),
      0,
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) - Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"))
    );
    return { direction, sprint: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"), actions: new Set(this.actions) };
  }
  consumeActions(): GameAction[] {
    const actions = this.actionQueue.splice(0).map((type) => ({ type }));
    return actions;
  }
}
