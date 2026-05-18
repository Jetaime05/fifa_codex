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
