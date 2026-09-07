/**
 * Domain types for the home-team squad management screen.
 *
 * This module intentionally does not depend on the renderer or match
 * simulation.  A card can therefore be used by a menu, persisted in a save,
 * or converted to match data without pulling Three.js into the management
 * layer.
 */

export type SquadRole = "GK" | "DEF" | "MID" | "FWD";

/** Alias kept for callers that use the shorter role name. */
export type Role = SquadRole;

export type FormationId = "4-3-3" | "4-4-2" | "4-2-3-1";

export type CardRarity = "common" | "rare" | "epic" | "legendary";

export type PlayerAttributes = {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
};

/** A collectible player card in the home squad inventory. */
export type PlayerCard = {
  id: string;
  name: string;
  short: string;
  number: number;
  primaryRole: SquadRole;
  positions: SquadRole[];
  rarity: CardRarity;
  attributes: PlayerAttributes;
};

export type FormationSlot = {
  id: string;
  role: SquadRole;
  x: number;
  z: number;
};

export type FormationDefinition = {
  id: FormationId;
  name: string;
  slots: FormationSlot[];
};

export type PassingStyle = "short" | "balanced" | "direct";

export type PlayerInstructionRole = "balanced" | "stayBack" | "getForward" | "freeRoam";

export type TeamTactics = {
  defensiveLine: number;
  pressingIntensity: number;
  buildUpSpeed: number;
  passingStyle: PassingStyle;
  attackWidth: number;
  instructions: Record<string, { role: PlayerInstructionRole }>;
};

export type SetPieceType = "penalty" | "freeKick" | "corner";

export type SetPieces = {
  penalty: string | null;
  freeKick: string | null;
  corner: string | null;
};

/** Versioned shape written to localStorage. */
export type SquadState = {
  version: 2;
  formationId: FormationId;
  /** The value is a PlayerCard id.  Keys are FormationSlot ids. */
  starters: Record<string, string>;
  /** Up to seven PlayerCard ids. */
  bench: string[];
  /** The remaining inventory, in deterministic order. */
  reserves: string[];
  captainId: string | null;
  setPieces: SetPieces;
  tactics: TeamTactics;
};

/** Patch shape accepted by the store's ergonomic update helper. */
export type SquadStatePatch = Omit<Partial<SquadState>, "tactics" | "setPieces"> & {
  tactics?: Partial<TeamTactics>;
  setPieces?: Partial<SetPieces>;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type PersistenceDiagnostic = {
  code: "malformed" | "migration" | "read-failed" | "write-failed" | "quota";
  message: string;
  recoverable: boolean;
};

/** The renderer's existing player shape plus a stable card id. */
export type MatchTeamPlayerData = {
  id: string;
  name: string;
  short: string;
  role: SquadRole;
  number: number;
  formation: { x: number; z: number };
  stats: PlayerAttributes;
};
