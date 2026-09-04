import * as THREE from "three";
import type { SimPlayer } from "./types";

type PossessionInput = {
  players: SimPlayer[];
  homePlayers: SimPlayer[];
  awayPlayers: SimPlayer[];
  activePlayer: SimPlayer;
  ballOwner: SimPlayer | null;
  ballPosition: THREE.Vector3;
  random: (min: number, max: number) => number;
  /** Players temporarily ineligible to recollect their own freshly released ball. */
  excludedPlayerIds?: readonly string[];
};

export type PossessionResolution = {
  owner: SimPlayer;
  feedText?: string;
  shouldControlOwner: boolean;
};

function findNearestPlayer(players: SimPlayer[], position: THREE.Vector3, includeKeeper = true) {
  let closest = players[0];
  let best = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (!includeKeeper && player.role === "GK") {
      continue;
    }
    const distance = player.position.distanceToSquared(position);
    if (distance < best) {
      closest = player;
      best = distance;
    }
  }
  return closest;
}

export function resolvePossession({
  players,
  homePlayers,
  awayPlayers,
  activePlayer,
  ballOwner,
  ballPosition,
  random,
  excludedPlayerIds = []
}: PossessionInput): PossessionResolution | null {
  if (ballOwner) {
    const opponents = ballOwner.team === "home" ? awayPlayers : homePlayers;
    const opponent = findNearestPlayer(opponents, ballOwner.position, true);
    if (opponent && opponent.position.distanceTo(ballOwner.position) < 1.35) {
      const keeperBonus = opponent.role === "GK" ? 28 : 0;
      const challenge =
        opponent.stats.defending + opponent.stats.physical * 0.28 + keeperBonus + random(0, 26);
      const resistance = ballOwner.stats.dribbling + random(0, 34);
      if (challenge > resistance) {
        return {
          owner: opponent,
          feedText: `${opponent.short} takes possession.`,
          shouldControlOwner: false
        };
      }
    }
    return null;
  }

  let collector: SimPlayer | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const player of players) {
    if (excludedPlayerIds.includes(player.id)) continue;
    const distance = player.position.distanceTo(ballPosition);
    const catchRadius = player.role === "GK" ? 2.6 : 1.55;
    if (distance < catchRadius && ballPosition.y < (player.role === "GK" ? 3.1 : 1.8)) {
      if (distance < closestDistance || (distance === closestDistance && player.id < (collector?.id ?? ""))) {
        collector = player;
        closestDistance = distance;
      }
    }
  }
  return collector ? {
    owner: collector,
    shouldControlOwner: collector.team === "home" && collector !== activePlayer
  } : null;
}
