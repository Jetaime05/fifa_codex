import { fictionalSquadCards, realMadridCards, squadCards } from "../data/fictionalSquadCards";
import type {
  CardRarity,
  FormationDefinition,
  FormationId,
  FormationSlot,
  MatchTeamPlayerData,
  PassingStyle,
  PersistenceDiagnostic,
  PlayerAttributes,
  PlayerCard,
  PlayerInstructionRole,
  Role,
  SetPieceType,
  SquadRole,
  SquadState,
  SquadStatePatch,
  StorageLike,
  TeamTactics,
  ValidationResult
} from "./types";

export type {
  CardRarity,
  FormationDefinition,
  FormationId,
  FormationSlot,
  MatchTeamPlayerData,
  PassingStyle,
  PersistenceDiagnostic,
  PlayerAttributes,
  PlayerCard,
  PlayerInstructionRole,
  Role,
  SetPieceType,
  SquadRole,
  SquadState,
  SquadStatePatch,
  StorageLike,
  TeamTactics,
  ValidationResult
} from "./types";

export const DEFAULT_SQUAD_STORAGE_KEY = "elite-kickoff:squad:v2";
export const MAX_BENCH_SIZE = 7;
export const MAX_BENCH = MAX_BENCH_SIZE;

const allRoles: readonly SquadRole[] = ["GK", "DEF", "MID", "FWD"];
const allPassingStyles: readonly PassingStyle[] = ["short", "balanced", "direct"];
const allInstructionRoles: readonly PlayerInstructionRole[] = [
  "balanced",
  "stayBack",
  "getForward",
  "freeRoam"
];

/**
 * Formation coordinates use the same compact pitch coordinate system as the
 * match renderer: x is horizontal and z runs from the home goal towards the
 * opponent goal.  Slot ids are stable so a saved squad survives formation
 * changes and UI components can use them as keys.
 */
export const formations: Record<FormationId, FormationDefinition> = {
  "4-3-3": {
    id: "4-3-3",
    name: "4-3-3",
    slots: [
      { id: "gk", role: "GK", x: 0, z: -50 },
      { id: "rb", role: "DEF", x: 27, z: -34 },
      { id: "rcb", role: "DEF", x: 9, z: -37 },
      { id: "lcb", role: "DEF", x: -9, z: -37 },
      { id: "lb", role: "DEF", x: -27, z: -34 },
      { id: "cm", role: "MID", x: 0, z: -18 },
      { id: "rcm", role: "MID", x: 17, z: -7 },
      { id: "lcm", role: "MID", x: -14, z: -5 },
      { id: "rw", role: "FWD", x: 23, z: 18 },
      { id: "lw", role: "FWD", x: -22, z: 20 },
      { id: "st", role: "FWD", x: 0, z: 27 }
    ]
  },
  "4-4-2": {
    id: "4-4-2",
    name: "4-4-2",
    slots: [
      { id: "gk", role: "GK", x: 0, z: -50 },
      { id: "rb", role: "DEF", x: 27, z: -34 },
      { id: "rcb", role: "DEF", x: 9, z: -37 },
      { id: "lcb", role: "DEF", x: -9, z: -37 },
      { id: "lb", role: "DEF", x: -27, z: -34 },
      { id: "rm", role: "MID", x: 24, z: -13 },
      { id: "rcm", role: "MID", x: 8, z: -11 },
      { id: "lcm", role: "MID", x: -8, z: -11 },
      { id: "lm", role: "MID", x: -24, z: -13 },
      { id: "rs", role: "FWD", x: 12, z: 22 },
      { id: "ls", role: "FWD", x: -12, z: 22 }
    ]
  },
  "4-2-3-1": {
    id: "4-2-3-1",
    name: "4-2-3-1",
    slots: [
      { id: "gk", role: "GK", x: 0, z: -50 },
      { id: "rb", role: "DEF", x: 27, z: -34 },
      { id: "rcb", role: "DEF", x: 9, z: -37 },
      { id: "lcb", role: "DEF", x: -9, z: -37 },
      { id: "lb", role: "DEF", x: -27, z: -34 },
      { id: "rdm", role: "MID", x: 10, z: -18 },
      { id: "ldm", role: "MID", x: -10, z: -18 },
      { id: "ram", role: "MID", x: 22, z: 1 },
      { id: "cam", role: "MID", x: 0, z: 4 },
      { id: "lam", role: "MID", x: -22, z: 1 },
      { id: "st", role: "FWD", x: 0, z: 27 }
    ]
  }
};

/** Naming aliases make the definitions convenient for both UI and tests. */
export const formationDefinitions = formations;
export const FORMATIONS = formations;
export const defaultFormation = formations["4-3-3"];
export const getFormation = (formationId: FormationId): FormationDefinition => formations[formationId];

export { squadCards };
export { fictionalSquadCards, realMadridCards };
export const homeSquadCards: readonly PlayerCard[] = squadCards;
export const playerCards: readonly PlayerCard[] = squadCards;
export const getPlayerCard = (cardId: string): PlayerCard | undefined =>
  squadCards.find((card) => card.id === cardId);

const cardMapFor = (cards: readonly PlayerCard[]): Map<string, PlayerCard> =>
  new Map(cards.map((card) => [card.id, card]));

const cloneAttributes = (attributes: PlayerAttributes): PlayerAttributes => ({ ...attributes });

const cloneTactics = (tactics: TeamTactics): TeamTactics => ({
  defensiveLine: tactics.defensiveLine,
  pressingIntensity: tactics.pressingIntensity,
  buildUpSpeed: tactics.buildUpSpeed,
  passingStyle: tactics.passingStyle,
  attackWidth: tactics.attackWidth,
  instructions: Object.fromEntries(
    Object.entries(tactics.instructions).map(([cardId, instruction]) => [cardId, { role: instruction.role }])
  )
});

const cloneState = (state: SquadState): SquadState => ({
  version: 2,
  formationId: state.formationId,
  starters: { ...state.starters },
  bench: [...state.bench],
  reserves: [...state.reserves],
  captainId: state.captainId,
  setPieces: { ...state.setPieces },
  tactics: cloneTactics(state.tactics)
});

const clamp = (value: unknown, min = 0, max = 100, fallback = 50): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
};

const validFormationId = (value: unknown): value is FormationId =>
  value === "4-3-3" || value === "4-4-2" || value === "4-2-3-1";

const validRole = (value: unknown): value is SquadRole =>
  typeof value === "string" && allRoles.includes(value as SquadRole);

const validPassingStyle = (value: unknown): value is PassingStyle =>
  typeof value === "string" && allPassingStyles.includes(value as PassingStyle);

const validInstructionRole = (value: unknown): value is PlayerInstructionRole =>
  typeof value === "string" && allInstructionRoles.includes(value as PlayerInstructionRole);

const defaultTactics = (): TeamTactics => ({
  defensiveLine: 50,
  pressingIntensity: 50,
  buildUpSpeed: 50,
  passingStyle: "balanced",
  attackWidth: 50,
  instructions: {}
});

const defaultSetPieces = (): SquadState["setPieces"] => ({
  penalty: null,
  freeKick: null,
  corner: null
});

const validCardId = (value: unknown, cards: readonly PlayerCard[]): value is string =>
  typeof value === "string" && cardMapFor(cards).has(value);

const slotIds = (formationId: FormationId): string[] => formations[formationId].slots.map((slot) => slot.id);

const slotById = (formationId: FormationId, id: string): FormationSlot | undefined =>
  formations[formationId].slots.find((slot) => slot.id === id);

const cardFitsRole = (card: PlayerCard, role: SquadRole): boolean =>
  card.primaryRole === role || card.positions.includes(role);

const roleMatchScore = (card: PlayerCard, role: SquadRole): number => {
  if (card.primaryRole === role) return 2;
  if (card.positions.includes(role)) return 1;
  return 0;
};

const orderedUnique = (values: readonly string[], cards: readonly PlayerCard[]): string[] => {
  const known = cardMapFor(cards);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && known.has(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
};

const firstAvailableCard = (
  candidates: readonly string[],
  used: Set<string>,
  role: SquadRole,
  cards: readonly PlayerCard[]
): string | undefined => {
  const map = cardMapFor(cards);
  let fallback: string | undefined;
  for (const id of candidates) {
    if (used.has(id)) continue;
    const card = map.get(id);
    if (!card) continue;
    if (!fallback) fallback = id;
    if (cardFitsRole(card, role)) return id;
  }
  return fallback;
};

const chooseStartingAssignments = (
  formationId: FormationId,
  candidates: readonly string[],
  cards: readonly PlayerCard[]
): Record<string, string> => {
  const starters: Record<string, string> = {};
  const used = new Set<string>();
  for (const slot of formations[formationId].slots) {
    const cardId = firstAvailableCard(candidates, used, slot.role, cards);
    if (!cardId) continue;
    starters[slot.id] = cardId;
    used.add(cardId);
  }
  return starters;
};

const chooseCaptain = (starters: Record<string, string>, cards: readonly PlayerCard[]): string | null => {
  const map = cardMapFor(cards);
  const values = Object.values(starters);
  if (values.length === 0) return null;
  return (
    values
      .map((id) => map.get(id))
      .filter((card): card is PlayerCard => Boolean(card))
      .sort((a, b) => calculateCardOverall(b, b.primaryRole) - calculateCardOverall(a, a.primaryRole))[0]?.id ??
    values[0]
  );
};

const chooseSetPiece = (
  starters: Record<string, string>,
  cards: readonly PlayerCard[],
  preferred: SquadRole[]
): string | null => {
  const map = cardMapFor(cards);
  const entries = Object.entries(starters);
  for (const role of preferred) {
    const found = entries.find(([, cardId]) => map.get(cardId)?.primaryRole === role);
    if (found) return found[1];
  }
  return entries[0]?.[1] ?? null;
};

const tidyStateCollections = (state: SquadState, cards: readonly PlayerCard[]): SquadState => {
  const known = cardMapFor(cards);
  const formation = formations[state.formationId];
  const starters: Record<string, string> = {};
  const used = new Set<string>();

  for (const slot of formation.slots) {
    const id = state.starters[slot.id];
    if (typeof id === "string" && known.has(id) && !used.has(id)) {
      starters[slot.id] = id;
      used.add(id);
    }
  }

  const remainingInventory = cards.map((card) => card.id).filter((id) => !used.has(id));
  const requested = [...state.bench, ...state.reserves];
  const extras = orderedUnique([...requested, ...remainingInventory], cards).filter((id) => !used.has(id));

  // A valid store state always contains a full XI.  Fill holes from the
  // requested inventory first and then from the card catalog deterministically.
  for (const slot of formation.slots) {
    if (starters[slot.id]) continue;
    const id = firstAvailableCard(extras, used, slot.role, cards);
    if (!id) continue;
    starters[slot.id] = id;
    used.add(id);
  }

  const rest = orderedUnique(
    [...state.bench, ...state.reserves, ...cards.map((card) => card.id)],
    cards
  ).filter((id) => !used.has(id));
  const bench = rest.slice(0, MAX_BENCH_SIZE);
  const reserves = rest.slice(MAX_BENCH_SIZE);

  const starterValues = new Set(Object.values(starters));
  const captainId = state.captainId && starterValues.has(state.captainId) ? state.captainId : chooseCaptain(starters, cards);
  const setPieces = { ...defaultSetPieces() };
  for (const key of ["penalty", "freeKick", "corner"] as const) {
    const value = state.setPieces?.[key];
    setPieces[key] = typeof value === "string" && starterValues.has(value) ? value : null;
  }
  if (!setPieces.penalty) setPieces.penalty = chooseSetPiece(starters, cards, ["FWD", "MID"]);
  if (!setPieces.freeKick) setPieces.freeKick = chooseSetPiece(starters, cards, ["MID", "FWD"]);
  if (!setPieces.corner) setPieces.corner = chooseSetPiece(starters, cards, ["MID", "FWD"]);

  return {
    version: 2,
    formationId: state.formationId,
    starters,
    bench,
    reserves,
    captainId,
    setPieces,
    tactics: normalizeTactics(state.tactics)
  };
};

const normalizeTactics = (value: unknown): TeamTactics => {
  const source = value && typeof value === "object" ? (value as Partial<TeamTactics> & Record<string, unknown>) : {};
  const instructions: TeamTactics["instructions"] = {};
  if (source.instructions && typeof source.instructions === "object") {
    for (const [cardId, raw] of Object.entries(source.instructions)) {
      const role = raw && typeof raw === "object" && validInstructionRole((raw as { role?: unknown }).role)
        ? (raw as { role: PlayerInstructionRole }).role
        : "balanced";
      instructions[cardId] = { role };
    }
  }
  return {
    defensiveLine: clamp(source.defensiveLine ?? source.defenceLine ?? source.line),
    pressingIntensity: clamp(source.pressingIntensity ?? source.pressing),
    buildUpSpeed: clamp(source.buildUpSpeed ?? source.buildUp ?? source.tempo),
    passingStyle: validPassingStyle(source.passingStyle ?? source.style) ? (source.passingStyle ?? source.style) as PassingStyle : "balanced",
    attackWidth: clamp(source.attackWidth ?? source.width),
    instructions
  };
};

const makeDefaultState = (cards: readonly PlayerCard[] = homeSquadCards): SquadState => {
  const ids = cards.map((card) => card.id);
  const starters = chooseStartingAssignments("4-3-3", ids, cards);
  const used = new Set(Object.values(starters));
  const rest = ids.filter((id) => !used.has(id));
  const captainId = chooseCaptain(starters, cards);
  return tidyStateCollections(
    {
      version: 2,
      formationId: "4-3-3",
      starters,
      bench: rest.slice(0, MAX_BENCH_SIZE),
      reserves: rest.slice(MAX_BENCH_SIZE),
      captainId,
      setPieces: {
        penalty: chooseSetPiece(starters, cards, ["FWD", "MID"]),
        freeKick: chooseSetPiece(starters, cards, ["MID", "FWD"]),
        corner: chooseSetPiece(starters, cards, ["MID", "FWD"])
      },
      tactics: defaultTactics()
    },
    cards
  );
};

export function createDefaultSquad(cards: readonly PlayerCard[] = homeSquadCards): SquadState {
  return cloneState(makeDefaultState(cards));
}

/**
 * Convert older save shapes into the current version.  Version 1 was not
 * shipped to players, but accepting its common aliases makes local previews
 * and test fixtures forward-compatible.
 */
export function migrateSquadState(
  raw: unknown,
  cards: readonly PlayerCard[] = homeSquadCards
): SquadState {
  const fallback = makeDefaultState(cards);
  if (!raw || typeof raw !== "object") return cloneState(fallback);
  const root = raw as Record<string, unknown>;
  const source = root.state && typeof root.state === "object" ? (root.state as Record<string, unknown>) : root;
  const formationId = validFormationId(source.formationId)
    ? source.formationId
    : validFormationId(source.formation)
      ? source.formation
      : "4-3-3";
  const rawStarters = source.starters ?? source.startingXI ?? source.startingPlayers;
  const starters: Record<string, string> = {};
  if (rawStarters && typeof rawStarters === "object" && !Array.isArray(rawStarters)) {
    for (const [slotId, cardId] of Object.entries(rawStarters)) {
      if (typeof cardId === "string") starters[slotId] = cardId;
    }
  } else if (Array.isArray(rawStarters)) {
    for (const [index, cardId] of rawStarters.entries()) {
      const slot = formations[formationId].slots[index];
      if (slot && typeof cardId === "string") starters[slot.id] = cardId;
    }
  }
  const bench = Array.isArray(source.bench)
    ? source.bench.filter((value): value is string => typeof value === "string")
    : [];
  const reserves = Array.isArray(source.reserves)
    ? source.reserves.filter((value): value is string => typeof value === "string")
    : [];
  const rawSetPieces = source.setPieces && typeof source.setPieces === "object"
    ? (source.setPieces as Record<string, unknown>)
    : {};
  const migrated: SquadState = {
    version: 2,
    formationId,
    starters,
    bench,
    reserves,
    captainId: typeof source.captainId === "string" ? source.captainId : null,
    setPieces: {
      penalty: typeof rawSetPieces.penalty === "string" ? rawSetPieces.penalty : null,
      freeKick: typeof rawSetPieces.freeKick === "string" ? rawSetPieces.freeKick : null,
      corner: typeof rawSetPieces.corner === "string" ? rawSetPieces.corner : null
    },
    tactics: normalizeTactics(source.tactics)
  };
  return tidyStateCollections(migrated, cards);
}

/** Role-specific weights sum to one, making the output easy to audit. */
export const ROLE_ATTRIBUTE_WEIGHTS: Record<Role, Record<keyof PlayerAttributes, number>> = {
  GK: { pace: 0.08, shooting: 0.02, passing: 0.15, dribbling: 0.08, defending: 0.42, physical: 0.25 },
  DEF: { pace: 0.18, shooting: 0.04, passing: 0.16, dribbling: 0.08, defending: 0.38, physical: 0.16 },
  MID: { pace: 0.12, shooting: 0.14, passing: 0.28, dribbling: 0.24, defending: 0.12, physical: 0.10 },
  FWD: { pace: 0.25, shooting: 0.30, passing: 0.10, dribbling: 0.25, defending: 0.03, physical: 0.07 }
};

export function calculateCardOverall(card: PlayerCard, role: Role = card.primaryRole): number {
  const weights = ROLE_ATTRIBUTE_WEIGHTS[role] ?? ROLE_ATTRIBUTE_WEIGHTS[card.primaryRole];
  const raw = (Object.keys(weights) as Array<keyof PlayerAttributes>).reduce(
    (total, attribute) => total + clamp(card.attributes[attribute], 0, 100, 0) * weights[attribute],
    0
  );
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/** Alias used by a few UI callers. */
export const cardOverall = calculateCardOverall;

export function validateSquad(
  state: unknown,
  cards: readonly PlayerCard[] = homeSquadCards
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const map = cardMapFor(cards);

  if (!state || typeof state !== "object") {
    return { valid: false, errors: ["state must be an object"], warnings };
  }
  const value = state as Partial<SquadState>;
  if (value.version !== 2) errors.push("unsupported squad version");
  if (!validFormationId(value.formationId)) {
    errors.push("formationId is invalid");
    return { valid: false, errors, warnings };
  }
  const formation = formations[value.formationId];
  const starters = value.starters && typeof value.starters === "object" ? value.starters : {};
  const starterEntries = Object.entries(starters);
  if (starterEntries.length !== formation.slots.length) errors.push("missing11: starters must contain 11 slots");

  const allAssigned: string[] = [];
  const starterIds = new Set<string>();
  for (const [slotId, cardId] of starterEntries) {
    const slot = slotById(value.formationId, slotId);
    if (!slot) {
      errors.push(`unknown starter slot: ${slotId}`);
      continue;
    }
    if (typeof cardId !== "string" || !map.has(cardId)) {
      errors.push(`unknown starter card: ${String(cardId)}`);
      continue;
    }
    if (starterIds.has(cardId)) errors.push(`duplicate card: ${cardId}`);
    starterIds.add(cardId);
    allAssigned.push(cardId);
    const card = map.get(cardId)!;
    if (!card.positions.includes(slot.role)) {
      warnings.push(`${card.short} is out of position in ${slot.id}`);
    }
  }
  const bench = Array.isArray(value.bench) ? value.bench : [];
  const reserves = Array.isArray(value.reserves) ? value.reserves : [];
  if (bench.length > MAX_BENCH_SIZE) errors.push(`bench must contain at most ${MAX_BENCH_SIZE} cards`);
  for (const [collectionName, collection] of [["bench", bench], ["reserves", reserves]] as const) {
    for (const cardId of collection) {
      if (typeof cardId !== "string" || !map.has(cardId)) {
        errors.push(`unknown ${collectionName} card: ${String(cardId)}`);
        continue;
      }
      if (allAssigned.includes(cardId)) errors.push(`duplicate card: ${cardId}`);
      allAssigned.push(cardId);
    }
  }
  const numbers = new Set<number>();
  for (const cardId of starterIds) {
    const number = map.get(cardId)?.number;
    if (number !== undefined) {
      if (numbers.has(number)) errors.push(`duplicate shirt number: ${number}`);
      numbers.add(number);
    }
  }
  const hasGoalkeeper = [...starterIds].some((cardId) => map.get(cardId)?.primaryRole === "GK");
  if (!hasGoalkeeper) errors.push("noGK: starting XI needs a goalkeeper");

  const starterSet = new Set(starterIds);
  if (value.captainId !== null && typeof value.captainId !== "string") {
    errors.push("captainId must be a card id or null");
  } else if (value.captainId && !starterSet.has(value.captainId)) {
    errors.push("captain must be a starter");
  }
  const setPieces = value.setPieces;
  for (const key of ["penalty", "freeKick", "corner"] as const) {
    const taker = setPieces?.[key];
    if (taker !== null && typeof taker !== "string") errors.push(`${key} taker must be a card id or null`);
    else if (taker && !starterSet.has(taker)) errors.push(`${key} taker must be a starter`);
  }
  const tactics = value.tactics;
  if (tactics) {
    for (const [key, tacticValue] of [
      ["defensiveLine", tactics.defensiveLine],
      ["pressingIntensity", tactics.pressingIntensity],
      ["buildUpSpeed", tactics.buildUpSpeed],
      ["attackWidth", tactics.attackWidth]
    ] as const) {
      if (typeof tacticValue !== "number" || tacticValue < 0 || tacticValue > 100) {
        errors.push(`${key} must be between 0 and 100`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function chemistry(
  state: SquadState,
  cards: readonly PlayerCard[] = homeSquadCards
): number {
  const map = cardMapFor(cards);
  const formation = formations[state.formationId] ?? defaultFormation;
  let positionFit = 0;
  let roleBalance = 0;
  for (const slot of formation.slots) {
    const card = map.get(state.starters?.[slot.id]);
    if (!card) continue;
    positionFit += card.positions.includes(slot.role) ? 100 : 35;
    roleBalance += card.primaryRole === slot.role ? 100 : card.positions.includes(slot.role) ? 70 : 25;
  }
  const total = formation.slots.length * 100;
  if (total === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((positionFit / total) * 70 + (roleBalance / total) * 30)));
}

export const calculateChemistry = chemistry;
export const getChemistry = chemistry;

export function teamOverall(
  state: SquadState,
  cards: readonly PlayerCard[] = homeSquadCards
): number {
  const map = cardMapFor(cards);
  const formation = formations[state.formationId] ?? defaultFormation;
  const ratings = formation.slots
    .map((slot) => {
      const card = map.get(state.starters?.[slot.id]);
      return card ? calculateCardOverall(card, slot.role) : undefined;
    })
    .filter((rating): rating is number => rating !== undefined);
  if (ratings.length === 0) return 0;
  return Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
}

export const calculateTeamOverall = teamOverall;
export const getTeamOverall = teamOverall;

const nextUniqueNumber = (used: Set<number>, preferred: number): number => {
  if (!used.has(preferred)) return preferred;
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
};

/**
 * Convert a squad snapshot to the renderer's 11-player data.  Invalid or
 * partially edited snapshots are repaired deterministically for the match
 * boundary so this function always returns one row per formation slot.
 */
export function buildMatchTeamData(
  state: SquadState,
  cards: readonly PlayerCard[] = homeSquadCards
): MatchTeamPlayerData[] {
  const map = cardMapFor(cards);
  const formation = formations[state.formationId] ?? defaultFormation;
  const used = new Set<string>();
  const usedNumbers = new Set<number>();
  const available = cards.map((card) => card.id);
  return formation.slots.map((slot) => {
    let card = map.get(state.starters?.[slot.id]);
    if (!card || used.has(card.id)) {
      const fallbackId = firstAvailableCard(available, used, slot.role, cards);
      card = fallbackId ? map.get(fallbackId) : undefined;
    }
    if (!card) {
      // The built-in catalog always has enough cards.  This error is clearer
      // than returning malformed simulation data for a caller-supplied set.
      throw new Error(`Unable to build match team: no card available for ${slot.id}`);
    }
    used.add(card.id);
    const number = nextUniqueNumber(usedNumbers, card.number);
    usedNumbers.add(number);
    return {
      id: card.id,
      name: card.name,
      short: card.short,
      role: slot.role,
      number,
      formation: { x: slot.x, z: slot.z },
      stats: cloneAttributes(card.attributes),
      preferredFoot: card.preferredFoot,
      heightScale: card.heightScale,
      weightScale: card.weightScale
    };
  });
}

type SquadStoreListener = (snapshot: SquadState, revision: number) => void;

export type SquadStore = {
  readonly snapshot: SquadState;
  /** Alias for adapters that prefer state terminology. */
  readonly state: SquadState;
  readonly revision: number;
  readonly serialized: string;
  readonly diagnostics: readonly PersistenceDiagnostic[];
  readonly persistenceDiagnostics: readonly PersistenceDiagnostic[];
  readonly diagnosticMessages: readonly string[];
  getDiagnostics(): PersistenceDiagnostic[];
  update(change: SquadStatePatch | ((draft: SquadState) => void | SquadState | SquadStatePatch)): SquadState;
  move(cardIdOrSlot: string, destination: string, slotId?: string): SquadState;
  swap(first: string, second: string): SquadState;
  setFormation(formationId: FormationId): SquadState;
  setTactics(tactics: Partial<TeamTactics> & Record<string, unknown>): SquadState;
  setCaptain(cardId: string | null): SquadState;
  setPiece(type: SetPieceType | string, cardId: string | null): SquadState;
  setPenaltyTaker(cardId: string | null): SquadState;
  setFreeKickTaker(cardId: string | null): SquadState;
  setCornerTaker(cardId: string | null): SquadState;
  setPieceTaker(cardId: string | null, field?: string): SquadState;
  reset(): SquadState;
  /** Persistence is automatic after mutations; these aliases let a UI expose an explicit Save action. */
  save(): SquadState;
  persist(): SquadState;
  subscribe(listener: SquadStoreListener): () => void;
};

export type CreateSquadStoreOptions = {
  storage?: StorageLike;
  key?: string;
  cards?: readonly PlayerCard[];
};

const getBrowserStorage = (): StorageLike | undefined => {
  try {
    if (typeof globalThis !== "undefined" && "localStorage" in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Accessing localStorage can throw in privacy mode or SSR-like contexts.
  }
  return undefined;
};

const diagnostic = (
  code: PersistenceDiagnostic["code"],
  message: string,
  recoverable = true
): PersistenceDiagnostic => ({ code, message, recoverable });

const locationOf = (
  state: SquadState,
  value: string
): { kind: "starter"; slotId: string } | { kind: "bench"; index: number } | { kind: "reserve"; index: number } | null => {
  const starter = Object.entries(state.starters).find(([, cardId]) => cardId === value);
  if (starter) return { kind: "starter", slotId: starter[0] };
  const benchIndex = state.bench.indexOf(value);
  if (benchIndex >= 0) return { kind: "bench", index: benchIndex };
  const reserveIndex = state.reserves.indexOf(value);
  if (reserveIndex >= 0) return { kind: "reserve", index: reserveIndex };
  return null;
};

const removeFromArray = (array: string[], value: string): void => {
  const index = array.indexOf(value);
  if (index >= 0) array.splice(index, 1);
};

const fillVacantSlot = (state: SquadState, slotId: string, cards: readonly PlayerCard[]): void => {
  if (state.starters[slotId]) return;
  const slot = slotById(state.formationId, slotId);
  if (!slot) return;
  const candidates = [...state.bench, ...state.reserves];
  const used = new Set(Object.values(state.starters));
  const cardId = firstAvailableCard(candidates, used, slot.role, cards);
  if (!cardId) return;
  state.starters[slotId] = cardId;
  removeFromArray(state.bench, cardId);
  removeFromArray(state.reserves, cardId);
};

const moveToStarter = (
  state: SquadState,
  cardId: string,
  slotId: string,
  cards: readonly PlayerCard[]
): void => {
  if (!slotById(state.formationId, slotId)) return;
  const origin = locationOf(state, cardId);
  if (!origin) return;
  const occupant = state.starters[slotId];
  if (origin.kind === "starter") {
    if (origin.slotId === slotId) return;
    state.starters[origin.slotId] = occupant;
    state.starters[slotId] = cardId;
    return;
  }
  if (origin.kind === "bench") state.bench.splice(origin.index, 1);
  else state.reserves.splice(origin.index, 1);
  if (occupant && occupant !== cardId) {
    if (state.bench.length < MAX_BENCH_SIZE) state.bench.push(occupant);
    else state.reserves.unshift(occupant);
  }
  state.starters[slotId] = cardId;
  // If the moved card came from a full bench, the normalizer will restore the
  // seven-card invariant while retaining deterministic order.
  void cards;
};

const moveToCollection = (
  state: SquadState,
  cardId: string,
  destination: "bench" | "reserve",
  cards: readonly PlayerCard[]
): void => {
  const origin = locationOf(state, cardId);
  if (!origin) return;
  if (destination === "bench" && origin.kind === "bench") return;
  if (destination === "reserve" && origin.kind === "reserve") return;
  if (origin.kind === "starter") {
    delete state.starters[origin.slotId];
    fillVacantSlot(state, origin.slotId, cards);
  } else if (origin.kind === "bench") {
    state.bench.splice(origin.index, 1);
  } else {
    state.reserves.splice(origin.index, 1);
  }
  if (destination === "bench" && state.bench.length < MAX_BENCH_SIZE) state.bench.push(cardId);
  else state.reserves.push(cardId);
};

const remapFormation = (
  state: SquadState,
  formationId: FormationId,
  cards: readonly PlayerCard[]
): SquadState => {
  const oldFormationId = state.formationId;
  const oldSlots = formations[oldFormationId].slots;
  const oldStarterIds = oldSlots.map((slot) => state.starters[slot.id]).filter((id): id is string => Boolean(id));
  const inventory = [...oldStarterIds, ...state.bench, ...state.reserves, ...cards.map((card) => card.id)];
  const candidates = orderedUnique(inventory, cards);
  const used = new Set<string>();
  const starters: Record<string, string> = {};

  // Preserve exact slot ids whenever the new formation has the same slot.
  for (const slot of formations[formationId].slots) {
    const cardId = state.starters[slot.id];
    if (cardId && !used.has(cardId) && cardMapFor(cards).has(cardId)) {
      starters[slot.id] = cardId;
      used.add(cardId);
    }
  }
  // Then preserve the rest of the old XI, preferring a natural position.
  for (const slot of formations[formationId].slots) {
    if (starters[slot.id]) continue;
    const cardId = firstAvailableCard(candidates, used, slot.role, cards);
    if (cardId) {
      starters[slot.id] = cardId;
      used.add(cardId);
    }
  }
  const rest = candidates.filter((cardId) => !used.has(cardId));
  const remapped: SquadState = {
    version: 2,
    formationId,
    starters,
    bench: rest.slice(0, MAX_BENCH_SIZE),
    reserves: rest.slice(MAX_BENCH_SIZE),
    captainId: state.captainId,
    setPieces: { ...state.setPieces },
    tactics: cloneTactics(state.tactics)
  };
  return tidyStateCollections(remapped, cards);
};

const asPartialState = (change: SquadStatePatch): SquadStatePatch | null => {
  if (!change || typeof change !== "object") return null;
  return change;
};

export function createSquadStore(options: CreateSquadStoreOptions = {}): SquadStore {
  const cards = options.cards ?? homeSquadCards;
  const storage = options.storage ?? getBrowserStorage();
  const key = options.key ?? DEFAULT_SQUAD_STORAGE_KEY;
  const diagnostics: PersistenceDiagnostic[] = [];
  const listeners = new Set<SquadStoreListener>();
  let current = makeDefaultState(cards);
  let revision = 0;

  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            const version = (parsed as { version?: unknown }).version;
            if (version !== 2) {
              diagnostics.push(diagnostic("migration", `Migrated squad save ${String(version ?? "1")} to version 2`));
            }
            current = migrateSquadState(parsed, cards);
          } else {
            diagnostics.push(diagnostic("malformed", "Squad save was not an object; loaded defaults"));
          }
        } catch {
          diagnostics.push(diagnostic("malformed", "Squad save contained invalid JSON; loaded defaults"));
        }
      }
    } catch {
      diagnostics.push(diagnostic("read-failed", "Unable to read squad save; loaded defaults"));
    }
  }

  const persist = (): void => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(current));
    } catch (error) {
      const errorText = error && typeof error === "object"
        ? `${String((error as { name?: unknown }).name ?? "")} ${String((error as { message?: unknown }).message ?? "")}`
        : String(error);
      const isQuota = /quota|space|storage/i.test(errorText);
      diagnostics.push(
        diagnostic(
          isQuota ? "quota" : "write-failed",
          isQuota ? "Squad save exceeded storage quota" : "Unable to persist squad changes"
        )
      );
    }
  };

  const commit = (next: SquadState): SquadState => {
    current = tidyStateCollections(
      {
        ...next,
        version: 2,
        starters: { ...next.starters },
        bench: [...next.bench],
        reserves: [...next.reserves],
        setPieces: { ...next.setPieces },
        tactics: cloneTactics(next.tactics)
      },
      cards
    );
    revision += 1;
    persist();
    const snapshot = cloneState(current);
    for (const listener of listeners) listener(cloneState(snapshot), revision);
    return snapshot;
  };

  const store: SquadStore = {
    get snapshot() {
      return cloneState(current);
    },
    get state() {
      return cloneState(current);
    },
    get revision() {
      return revision;
    },
    get serialized() {
      return JSON.stringify(current);
    },
    get diagnostics() {
      return diagnostics.map((item) => ({ ...item }));
    },
    get persistenceDiagnostics() {
      return diagnostics.map((item) => ({ ...item }));
    },
    get diagnosticMessages() {
      return diagnostics.map((item) => item.message);
    },
    getDiagnostics() {
      return diagnostics.map((item) => ({ ...item }));
    },
    update(change) {
      const draft = cloneState(current);
      const result = typeof change === "function" ? change(draft) : undefined;
      const direct = typeof change === "function" ? result : asPartialState(change);
      const next = direct
        ? {
            ...draft,
            ...direct,
            tactics: { ...draft.tactics, ...(direct.tactics ?? {}) },
            setPieces: { ...draft.setPieces, ...(direct.setPieces ?? {}) }
          }
        : draft;
      return commit(next);
    },
    move(cardIdOrSlot, destination, slotId) {
      const draft = cloneState(current);
      // A compact move(slotA, slotB) call is treated as a starter swap.
      if (slotById(draft.formationId, cardIdOrSlot) && slotById(draft.formationId, destination) && !slotId) {
        const first = draft.starters[cardIdOrSlot];
        const second = draft.starters[destination];
        if (first && second) {
          draft.starters[cardIdOrSlot] = second;
          draft.starters[destination] = first;
        }
        return commit(draft);
      }
      const normalizedDestination = destination.toLowerCase();
      if (slotById(draft.formationId, slotId ?? destination)) {
        moveToStarter(draft, cardIdOrSlot, slotId ?? destination, cards);
      } else if (normalizedDestination === "starter" || normalizedDestination === "starting" || normalizedDestination === "startingxi") {
        const movedCard = cardMapFor(cards).get(cardIdOrSlot);
        const target = slotId ?? formations[draft.formationId].slots.find((slot) =>
          !draft.starters[slot.id] && movedCard && cardFitsRole(movedCard, slot.role)
        )?.id ?? formations[draft.formationId].slots.find((slot) => movedCard && cardFitsRole(movedCard, slot.role))?.id
          ?? formations[draft.formationId].slots.find((slot) => !draft.starters[slot.id])?.id
          ?? formations[draft.formationId].slots[0]?.id;
        if (target) moveToStarter(draft, cardIdOrSlot, target, cards);
      } else if (normalizedDestination === "bench") {
        moveToCollection(draft, cardIdOrSlot, "bench", cards);
      } else if (normalizedDestination === "reserve" || normalizedDestination === "reserves") {
        moveToCollection(draft, cardIdOrSlot, "reserve", cards);
      }
      return commit(draft);
    },
    swap(first, second) {
      const draft = cloneState(current);
      const firstLocation = locationOf(draft, first);
      const secondLocation = locationOf(draft, second);
      if (slotById(draft.formationId, first) && slotById(draft.formationId, second)) {
        const firstCard = draft.starters[first];
        const secondCard = draft.starters[second];
        if (firstCard && secondCard) {
          draft.starters[first] = secondCard;
          draft.starters[second] = firstCard;
        }
      } else if (firstLocation && secondLocation) {
        const remove = (location: NonNullable<typeof firstLocation>, value: string): void => {
          if (location.kind === "starter") draft.starters[location.slotId] = value;
          else if (location.kind === "bench") draft.bench[location.index] = value;
          else draft.reserves[location.index] = value;
        };
        const valueAt = (location: NonNullable<typeof firstLocation>): string => {
          if (location.kind === "starter") return draft.starters[location.slotId];
          if (location.kind === "bench") return draft.bench[location.index];
          return draft.reserves[location.index];
        };
        const firstValue = valueAt(firstLocation);
        const secondValue = valueAt(secondLocation);
        remove(firstLocation, secondValue);
        remove(secondLocation, firstValue);
      }
      return commit(draft);
    },
    setFormation(formationId) {
      if (!validFormationId(formationId)) return cloneState(current);
      if (formationId === current.formationId) return cloneState(current);
      return commit(remapFormation(current, formationId, cards));
    },
    setTactics(tactics) {
      const draft = cloneState(current);
      const instructionPatch = tactics.instructions ?? {};
      draft.tactics = normalizeTactics({
        ...draft.tactics,
        ...tactics,
        instructions: { ...draft.tactics.instructions, ...instructionPatch }
      });
      return commit(draft);
    },
    setCaptain(cardId) {
      if (cardId !== null && !Object.values(current.starters).includes(cardId)) return cloneState(current);
      return commit({ ...cloneState(current), captainId: cardId });
    },
    setPiece(type, cardId) {
      // Accept both the domain order `(type, cardId)` and the UI adapter's
      // compatibility order `(cardId, "penaltyTakerId")`.
      const aliases: Record<string, SetPieceType> = {
        penaltyTakerId: "penalty",
        penaltyTaker: "penalty",
        freeKickTakerId: "freeKick",
        freeKickTaker: "freeKick",
        cornerTakerId: "corner",
        cornerTaker: "corner"
      };
      const typeAlias = aliases[type];
      const secondAlias = aliases[cardId ?? ""];
      const resolvedType: SetPieceType | undefined = type === "penalty" || type === "freeKick" || type === "corner"
        ? type
        : typeAlias ?? secondAlias;
      const resolvedCardId = secondAlias && !typeAlias ? type : typeAlias ? cardId : cardId;
      if (!resolvedType) return cloneState(current);
      if (resolvedCardId !== null && !Object.values(current.starters).includes(resolvedCardId)) return cloneState(current);
      const draft = cloneState(current);
      draft.setPieces[resolvedType] = resolvedCardId;
      return commit(draft);
    },
    setPenaltyTaker(cardId) {
      return store.setPiece("penalty", cardId);
    },
    setFreeKickTaker(cardId) {
      return store.setPiece("freeKick", cardId);
    },
    setCornerTaker(cardId) {
      return store.setPiece("corner", cardId);
    },
    setPieceTaker(cardId, field) {
      return store.setPiece(field ?? "penalty", cardId);
    },
    reset() {
      return commit(makeDefaultState(cards));
    },
    save() {
      persist();
      return cloneState(current);
    },
    persist() {
      persist();
      return cloneState(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };

  return store;
}
