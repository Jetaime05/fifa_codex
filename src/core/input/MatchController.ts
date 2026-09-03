import type { GameAction, GameActionName } from "./types";

export type ActionHandlers = Partial<Record<GameActionName, () => void>>;

/** Single action boundary shared by keyboard, touch, and future gamepad input. */
export class MatchController {
  constructor(private readonly handlers: ActionHandlers) {}
  dispatch(actions: GameAction[]) {
    for (const action of actions) this.handlers[action.type]?.();
  }
}
