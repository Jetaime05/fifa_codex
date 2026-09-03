import * as THREE from "three";
import type { GameAction, InputState } from "./types";

export class TouchInput {
  private readonly state: InputState = { direction: new THREE.Vector3(), sprint: false, actions: new Set() };
  private readonly actionQueue: GameAction["type"][] = [];
  private pointerId = -1;
  private baseX = 0;
  private baseY = 0;
  constructor(private readonly stick: HTMLElement, private readonly buttons: NodeListOf<HTMLElement>) {}

  attach() {
    this.stick.addEventListener("pointerdown", this.onStickDown);
    this.stick.addEventListener("pointermove", this.onStickMove);
    this.stick.addEventListener("pointerup", this.onStickEnd);
    this.stick.addEventListener("pointercancel", this.onStickEnd);
    this.buttons.forEach((button) => {
      button.addEventListener("pointerdown", this.onButtonDown);
      button.addEventListener("pointerup", this.onButtonUp);
      button.addEventListener("pointercancel", this.onButtonUp);
    });
    return this;
  }
  private readonly onStickDown = (event: PointerEvent) => { this.pointerId = event.pointerId; this.baseX = event.clientX; this.baseY = event.clientY; this.stick.setPointerCapture(event.pointerId); };
  private readonly onStickMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    this.state.direction.set(Math.max(-1, Math.min(1, (event.clientX - this.baseX) / 42)), 0, Math.max(-1, Math.min(1, (this.baseY - event.clientY) / 42)));
  };
  private readonly onStickEnd = (event: PointerEvent) => { if (event.pointerId === this.pointerId) { this.pointerId = -1; this.state.direction.set(0, 0, 0); } };
  private readonly onButtonDown = (event: Event) => { event.preventDefault(); const type = (event.currentTarget as HTMLElement).dataset.action as GameAction["type"] | undefined; if (type) { this.state.actions.add(type); this.actionQueue.push(type); if (type === "sprint") this.state.sprint = true; } };
  private readonly onButtonUp = (event: Event) => { const type = (event.currentTarget as HTMLElement).dataset.action; if (type === "sprint") this.state.sprint = false; };
  getState(): InputState { return { direction: this.state.direction.clone(), sprint: this.state.sprint, actions: new Set(this.state.actions) }; }
  consumeActions(): GameAction[] { const actions = this.actionQueue.splice(0).map((type) => ({ type })); this.state.actions.clear(); return actions; }
}
