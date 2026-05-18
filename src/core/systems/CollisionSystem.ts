import type { SimPlayer } from "./types";

type CollisionInput = {
  players: SimPlayer[];
  activePlayer: SimPlayer;
  playerRadius: number;
};

export function separatePlayers({ players, activePlayer, playerRadius }: CollisionInput) {
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      const delta = a.position.clone().sub(b.position);
      const distance = delta.length();
      const min = playerRadius * 1.58;
      if (distance > 0 && distance < min) {
        const push = delta.normalize().multiplyScalar((min - distance) * 0.5);
        if (a !== activePlayer) {
          a.position.add(push);
        }
        if (b !== activePlayer) {
          b.position.sub(push);
        }
      }
    }
  }
}
