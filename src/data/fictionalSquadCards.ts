import { realMadrid } from "./teams";
import type { PlayerCard, SquadRole } from "../management/types";

const toCardId = (name: string): string =>
  `rma-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

export const realMadridCards: PlayerCard[] = realMadrid.players.map((player) => ({
  id: toCardId(player.name),
  name: player.name,
  short: player.short,
  number: player.number,
  primaryRole: player.role,
  positions: [player.role],
  rarity: "legendary",
  attributes: { ...player.stats }
}));

/**
 * Fictional academy/reserve cards.  They deliberately use generic invented
 * names and no external club or player artwork/licensing data.
 */
export const fictionalSquadCards: PlayerCard[] = [
  {
    id: "academy-mateo-soler",
    name: "Mateo Soler",
    short: "M. Soler",
    number: 12,
    primaryRole: "GK",
    positions: ["GK"],
    rarity: "rare",
    attributes: { pace: 55, shooting: 22, passing: 67, dribbling: 45, defending: 76, physical: 74 }
  },
  {
    id: "academy-nico-vale",
    name: "Nico Vale",
    short: "N. Vale",
    number: 13,
    primaryRole: "DEF",
    positions: ["DEF", "MID"],
    rarity: "rare",
    attributes: { pace: 79, shooting: 44, passing: 68, dribbling: 63, defending: 76, physical: 72 }
  },
  {
    id: "academy-leo-navarro",
    name: "Leo Navarro",
    short: "L. Navarro",
    number: 14,
    primaryRole: "DEF",
    positions: ["DEF"],
    rarity: "common",
    attributes: { pace: 73, shooting: 39, passing: 62, dribbling: 57, defending: 72, physical: 76 }
  },
  {
    id: "academy-tomas-rios",
    name: "Tomas Rios",
    short: "T. Rios",
    number: 16,
    primaryRole: "MID",
    positions: ["MID", "DEF"],
    rarity: "rare",
    attributes: { pace: 77, shooting: 57, passing: 74, dribbling: 71, defending: 64, physical: 69 }
  },
  {
    id: "academy-iker-costa",
    name: "Iker Costa",
    short: "I. Costa",
    number: 17,
    primaryRole: "MID",
    positions: ["MID", "FWD"],
    rarity: "common",
    attributes: { pace: 82, shooting: 64, passing: 72, dribbling: 78, defending: 46, physical: 61 }
  },
  {
    id: "academy-adrian-mora",
    name: "Adrian Mora",
    short: "A. Mora",
    number: 20,
    primaryRole: "FWD",
    positions: ["FWD", "MID"],
    rarity: "rare",
    attributes: { pace: 86, shooting: 75, passing: 69, dribbling: 82, defending: 34, physical: 64 }
  },
  {
    id: "academy-bruno-vega",
    name: "Bruno Vega",
    short: "B. Vega",
    number: 21,
    primaryRole: "FWD",
    positions: ["FWD"],
    rarity: "common",
    attributes: { pace: 80, shooting: 70, passing: 61, dribbling: 74, defending: 31, physical: 71 }
  }
];

export const realMadridSquadCards: PlayerCard[] = realMadridCards;
export const squadCards: PlayerCard[] = [...realMadridCards, ...fictionalSquadCards];
export const playerCards = squadCards;

/** The role list is exported for small UI adapters that need a type guard. */
export const squadRoles: readonly SquadRole[] = ["GK", "DEF", "MID", "FWD"];
