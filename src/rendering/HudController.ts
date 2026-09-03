import type { MatchState } from "../core/match/MatchState";
import { clockText, scoreText } from "../core/match/MatchState";
import type { SimPlayer } from "../core/systems/types";

export type HudElements = { score: HTMLElement; clock: HTMLElement; camera: HTMLElement; possession: HTMLElement; playerName: HTMLElement; playerRole: HTMLElement; playerStatus: HTMLElement; stamina: HTMLElement };

export class HudController {
  constructor(private readonly el: HudElements) {}
  update(state: MatchState, player: SimPlayer & { name: string }, owner: SimPlayer | null) {
    this.el.score.textContent = scoreText(state);
    this.el.clock.textContent = clockText(state);
    this.el.camera.textContent = state.cameraMode === "broadcast" ? "Broadcast Cam" : "Follow Cam";
    this.el.possession.textContent = state.status === "paused" ? "Paused" : owner ? `${owner.team === "home" ? "RMA" : "MCI"} possession` : "Loose ball";
    this.el.playerName.textContent = player.name;
    this.el.playerRole.textContent = `${player.role}  #${player.number}`;
    this.el.playerStatus.textContent = owner === player ? "On ball" : player.intent;
    this.el.stamina.style.width = `${Math.round(player.stamina * 100)}%`;
  }
}
