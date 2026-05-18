import type { TeamData } from "./types";

export const realMadrid: TeamData = {
  id: "home",
  name: "Real Madrid",
  short: "RMA",
  attackingDirection: 1,
  primary: 0xf6f2dc,
  secondary: 0x273f9f,
  accent: 0xd8b64b,
  players: [
    {
      name: "Thibaut Courtois",
      short: "Courtois",
      number: 1,
      role: "GK",
      formation: { x: 0, z: -50 },
      stats: { pace: 48, shooting: 25, passing: 72, dribbling: 52, defending: 86, physical: 82 }
    },
    {
      name: "Dani Carvajal",
      short: "Carvajal",
      number: 2,
      role: "DEF",
      formation: { x: 27, z: -34 },
      stats: { pace: 77, shooting: 58, passing: 78, dribbling: 76, defending: 84, physical: 78 }
    },
    {
      name: "Antonio Rudiger",
      short: "Rudiger",
      number: 22,
      role: "DEF",
      formation: { x: 9, z: -37 },
      stats: { pace: 82, shooting: 49, passing: 69, dribbling: 66, defending: 88, physical: 88 }
    },
    {
      name: "Eder Militao",
      short: "Militao",
      number: 3,
      role: "DEF",
      formation: { x: -9, z: -37 },
      stats: { pace: 84, shooting: 50, passing: 70, dribbling: 69, defending: 86, physical: 84 }
    },
    {
      name: "Ferland Mendy",
      short: "Mendy",
      number: 23,
      role: "DEF",
      formation: { x: -27, z: -34 },
      stats: { pace: 86, shooting: 47, passing: 72, dribbling: 78, defending: 82, physical: 80 }
    },
    {
      name: "Aurelien Tchouameni",
      short: "Tchouameni",
      number: 18,
      role: "MID",
      formation: { x: 0, z: -18 },
      stats: { pace: 74, shooting: 70, passing: 82, dribbling: 79, defending: 84, physical: 86 }
    },
    {
      name: "Federico Valverde",
      short: "Valverde",
      number: 15,
      role: "MID",
      formation: { x: 17, z: -7 },
      stats: { pace: 89, shooting: 83, passing: 84, dribbling: 83, defending: 80, physical: 86 }
    },
    {
      name: "Jude Bellingham",
      short: "Bellingham",
      number: 5,
      role: "MID",
      formation: { x: -14, z: -5 },
      stats: { pace: 82, shooting: 85, passing: 86, dribbling: 88, defending: 79, physical: 84 }
    },
    {
      name: "Rodrygo",
      short: "Rodrygo",
      number: 11,
      role: "FWD",
      formation: { x: 23, z: 18 },
      stats: { pace: 88, shooting: 84, passing: 80, dribbling: 89, defending: 42, physical: 68 }
    },
    {
      name: "Vinicius Junior",
      short: "Vini Jr.",
      number: 7,
      role: "FWD",
      formation: { x: -22, z: 20 },
      stats: { pace: 96, shooting: 86, passing: 80, dribbling: 93, defending: 36, physical: 73 }
    },
    {
      name: "Kylian Mbappe",
      short: "Mbappe",
      number: 9,
      role: "FWD",
      formation: { x: 0, z: 27 },
      stats: { pace: 97, shooting: 92, passing: 83, dribbling: 93, defending: 39, physical: 80 }
    }
  ]
};

export const manCity: TeamData = {
  id: "away",
  name: "Manchester City",
  short: "MCI",
  attackingDirection: -1,
  primary: 0x77cbed,
  secondary: 0x31206e,
  accent: 0xf0f7ff,
  players: [
    {
      name: "Ederson",
      short: "Ederson",
      number: 31,
      role: "GK",
      formation: { x: 0, z: 50 },
      stats: { pace: 64, shooting: 28, passing: 87, dribbling: 61, defending: 84, physical: 78 }
    },
    {
      name: "Kyle Walker",
      short: "Walker",
      number: 2,
      role: "DEF",
      formation: { x: -27, z: 34 },
      stats: { pace: 91, shooting: 63, passing: 77, dribbling: 76, defending: 85, physical: 83 }
    },
    {
      name: "Ruben Dias",
      short: "Dias",
      number: 3,
      role: "DEF",
      formation: { x: -9, z: 37 },
      stats: { pace: 69, shooting: 45, passing: 73, dribbling: 66, defending: 89, physical: 88 }
    },
    {
      name: "John Stones",
      short: "Stones",
      number: 5,
      role: "DEF",
      formation: { x: 9, z: 37 },
      stats: { pace: 72, shooting: 55, passing: 80, dribbling: 75, defending: 86, physical: 80 }
    },
    {
      name: "Josko Gvardiol",
      short: "Gvardiol",
      number: 24,
      role: "DEF",
      formation: { x: 27, z: 34 },
      stats: { pace: 82, shooting: 63, passing: 78, dribbling: 78, defending: 84, physical: 82 }
    },
    {
      name: "Rodri",
      short: "Rodri",
      number: 16,
      role: "MID",
      formation: { x: 0, z: 18 },
      stats: { pace: 66, shooting: 80, passing: 90, dribbling: 84, defending: 88, physical: 85 }
    },
    {
      name: "Kevin De Bruyne",
      short: "De Bruyne",
      number: 17,
      role: "MID",
      formation: { x: -17, z: 7 },
      stats: { pace: 75, shooting: 88, passing: 94, dribbling: 87, defending: 64, physical: 78 }
    },
    {
      name: "Bernardo Silva",
      short: "Bernardo",
      number: 20,
      role: "MID",
      formation: { x: 14, z: 5 },
      stats: { pace: 82, shooting: 79, passing: 86, dribbling: 92, defending: 72, physical: 68 }
    },
    {
      name: "Phil Foden",
      short: "Foden",
      number: 47,
      role: "FWD",
      formation: { x: -23, z: -18 },
      stats: { pace: 86, shooting: 86, passing: 84, dribbling: 91, defending: 57, physical: 65 }
    },
    {
      name: "Jeremy Doku",
      short: "Doku",
      number: 11,
      role: "FWD",
      formation: { x: 22, z: -20 },
      stats: { pace: 94, shooting: 78, passing: 76, dribbling: 91, defending: 42, physical: 72 }
    },
    {
      name: "Erling Haaland",
      short: "Haaland",
      number: 9,
      role: "FWD",
      formation: { x: 0, z: -27 },
      stats: { pace: 88, shooting: 94, passing: 72, dribbling: 82, defending: 49, physical: 92 }
    }
  ]
};

export const teams = [realMadrid, manCity] as const;
