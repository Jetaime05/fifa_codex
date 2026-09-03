import * as THREE from "three";
import type { SimBall, SimPlayer } from "../core/systems/types";
import type { FieldBounds } from "../core/systems/types";

export class MinimapController {
  constructor(private readonly element: HTMLElement, private readonly bounds: FieldBounds) {}
  update(players: SimPlayer[], ball: SimBall, activePlayer: SimPlayer) {
    this.element.innerHTML = "";
    const toMini = (position: THREE.Vector3) => ({ x: ((position.x + this.bounds.halfWidth) / (this.bounds.halfWidth * 2)) * 100, y: ((this.bounds.halfLength - position.z) / (this.bounds.halfLength * 2)) * 100 });
    for (const player of players) {
      const dot = document.createElement("span"); dot.className = `mini-dot ${player.team}${player === activePlayer ? " active" : ""}`; const p = toMini(player.position); dot.style.left = `${p.x}%`; dot.style.top = `${p.y}%`; this.element.append(dot);
    }
    const dot = document.createElement("span"); dot.className = "mini-ball"; const p = toMini(ball.position); dot.style.left = `${p.x}%`; dot.style.top = `${p.y}%`; this.element.append(dot);
  }
}
