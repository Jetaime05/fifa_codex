export type TeamId = "home" | "away";

export type Role = "GK" | "DEF" | "MID" | "FWD";

export type PlayerStats = {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
};

export type PreferredFoot = "left" | "right";

export type FormationSlot = {
  x: number;
  z: number;
};

export type PlayerData = {
  name: string;
  short: string;
  role: Role;
  number: number;
  formation: FormationSlot;
  stats: PlayerStats;
  /** Optional realism metadata; legacy squad data defaults to right-footed. */
  preferredFoot?: PreferredFoot;
  /** Small body variation in the existing world-unit scale. */
  heightScale?: number;
  weightScale?: number;
};

export type TeamData = {
  id: TeamId;
  name: string;
  short: string;
  attackingDirection: number;
  primary: number;
  secondary: number;
  accent: number;
  players: PlayerData[];
};
