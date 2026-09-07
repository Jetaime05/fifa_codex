/*
 * Squad management presentation layer.
 *
 * The state model is deliberately read through a small structural adapter.  The
 * management domain owns persistence and match semantics; this module only
 * renders the current snapshot and forwards user intents to it.  The type-only
 * imports are kept here so the UI stays coupled to the announced Phase 6
 * domain boundary without taking a runtime dependency on a concrete store
 * implementation.
 */
import "./SquadUI.css";
import type * as SquadDomainTypes from "./types";
import type * as SquadSystemDomain from "./SquadSystem";
import {
  calculateCardOverall,
  formations as domainFormations,
  homeSquadCards,
  type FormationId,
  type SetPieceType,
  type SquadStore,
} from "./SquadSystem";

// Keep these imports visible to the compiler as the domain evolves.  The UI
// intentionally consumes a structural snapshot so old saved squads can still
// be rendered while the domain schema is migrated.
type AnnouncedSquadTypes = typeof SquadDomainTypes;
type AnnouncedSquadSystem = typeof SquadSystemDomain;

export type SquadTab = "squad" | "cards" | "tactics";
export type SquadUICloseReason = "close" | "play";

export type SquadUIOptions = {
  root: HTMLElement;
  store: SquadStore | unknown;
  onPlay: () => void;
  onClose?: (reason: SquadUICloseReason) => void;
};

type AnyRecord = Record<string, unknown>;

export type ViewCard = {
  id: string;
  name: string;
  shortName: string;
  position: string;
  positions: string[];
  rating: number;
  rarity: string;
  club: string;
  nation: string;
  level: number;
  stats: Record<string, number>;
};

export type ViewSlot = {
  id: string;
  label: string;
  position: string;
  x: number;
  y: number;
  cardId: string | null;
};

export type ViewFormation = {
  id: string;
  name: string;
  slots: ViewSlot[];
};

export type ViewTactics = {
  defensiveLine: number;
  pressing: number;
  buildUp: number;
  attackWidth: number;
  passingStyle: string;
  instructions: Record<string, string>;
};

export type SquadViewModel = {
  cards: ViewCard[];
  startingXI: ViewSlot[];
  bench: string[];
  reserves: string[];
  formation: ViewFormation;
  formationOptions: ViewFormation[];
  tactics: ViewTactics;
  captainId: string | null;
  penaltyTakerId: string | null;
  freeKickTakerId: string | null;
  cornerTakerId: string | null;
  chemistry: number;
  teamOverall: number;
  saved: boolean;
  saveStatus: string;
};

export type SquadValidation = {
  valid: boolean;
  warnings: string[];
  mismatches: Array<{ slotId: string; cardId: string; expected: string; actual: string }>;
};

export type SelectionState = {
  activeTab: SquadTab;
  selectedCardId: string | null;
  selectedSlotId: string | null;
};

export type SelectionAction =
  | { type: "tab"; tab: SquadTab }
  | { type: "card"; cardId: string }
  | { type: "slot"; slotId: string }
  | { type: "clear" };

const DEFAULT_SLOTS: Array<Pick<ViewSlot, "id" | "label" | "position" | "x" | "y">> = [
  { id: "gk", label: "GK", position: "GK", x: 50, y: 91 },
  { id: "lb", label: "LB", position: "DEF", x: 15, y: 71 },
  { id: "lcb", label: "CB", position: "DEF", x: 38, y: 76 },
  { id: "rcb", label: "CB", position: "DEF", x: 62, y: 76 },
  { id: "rb", label: "RB", position: "DEF", x: 85, y: 71 },
  { id: "lm", label: "LM", position: "MID", x: 17, y: 50 },
  { id: "cm", label: "CM", position: "MID", x: 50, y: 54 },
  { id: "rm", label: "RM", position: "MID", x: 83, y: 50 },
  { id: "lw", label: "LW", position: "FWD", x: 18, y: 23 },
  { id: "st", label: "ST", position: "FWD", x: 50, y: 16 },
  { id: "rw", label: "RW", position: "FWD", x: 82, y: 23 },
];

const DEFAULT_FORMATION: ViewFormation = {
  id: "4-3-3",
  name: "4-3-3 Control",
  slots: DEFAULT_SLOTS.map((slot) => ({ ...slot, cardId: null })),
};

const DEFAULT_TACTICS: ViewTactics = {
  defensiveLine: 52,
  pressing: 48,
  buildUp: 55,
  attackWidth: 52,
  passingStyle: "balanced",
  instructions: {},
};

const POSITION_ALIASES: Record<string, string> = {
  goalkeeper: "GK",
  keeper: "GK",
  gk: "GK",
  defender: "DEF",
  defenders: "DEF",
  cb: "DEF",
  lb: "DEF",
  rb: "DEF",
  lwb: "DEF",
  rwb: "DEF",
  midfielder: "MID",
  centralmidfielder: "MID",
  centralmidfield: "MID",
  centralmid: "MID",
  midfield: "MID",
  mid: "MID",
  cm: "MID",
  cdm: "MID",
  cam: "MID",
  lm: "MID",
  rm: "MID",
  winger: "FWD",
  forward: "FWD",
  forwards: "FWD",
  striker: "FWD",
  fwd: "FWD",
  st: "FWD",
  cf: "FWD",
  lw: "FWD",
  rw: "FWD",
};

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstValue(record: AnyRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function arrayValue(record: AnyRecord, keys: string[]): unknown[] {
  const value = firstValue(record, keys);
  return Array.isArray(value) ? value : [];
}

function objectValue(record: AnyRecord, keys: string[]): AnyRecord {
  const value = firstValue(record, keys);
  return isRecord(value) ? value : {};
}

function normalizePosition(value: unknown, fallback = "MID"): string {
  const raw = asString(value, fallback).toLowerCase().replace(/[._\s-]+/g, "");
  return POSITION_ALIASES[raw] ?? (raw ? raw.toUpperCase() : fallback);
}

function normalizeStats(raw: unknown, rating: number): Record<string, number> {
  const source = isRecord(raw) ? raw : {};
  const fields: Array<[string, string[]]> = [
    ["pace", ["pace", "speed"]],
    ["shooting", ["shooting", "shot", "finishing"]],
    ["passing", ["passing", "pass"]],
    ["dribbling", ["dribbling", "dribble", "technique"]],
    ["defending", ["defending", "defense", "defence", "tackling"]],
    ["physical", ["physical", "strength", "stamina"]],
  ];
  const stats: Record<string, number> = {};
  for (const [key, aliases] of fields) stats[key] = clamp(asNumber(firstValue(source, aliases), rating), 1, 99);
  return stats;
}

function cardIdFrom(value: unknown, fallback = ""): string {
  if (typeof value === "string" || typeof value === "number") return asString(value, fallback);
  if (!isRecord(value)) return fallback;
  return asString(firstValue(value, ["id", "cardId", "playerId", "uid", "key"]), fallback);
}

function normalizeCard(raw: unknown, index: number): ViewCard {
  const source = isRecord(raw) ? raw : {};
  const stats = normalizeStats(firstValue(source, ["stats", "attributes"]), 70);
  const statsAverage = Object.values(stats).reduce((sum, value) => sum + value, 0) / Math.max(1, Object.keys(stats).length);
  let calculatedRating = statsAverage;
  if (firstValue(source, ["primaryRole"]) && firstValue(source, ["attributes"])) {
    try {
      calculatedRating = calculateCardOverall(source as never, asString(firstValue(source, ["primaryRole"]), "MID") as never);
    } catch {
      calculatedRating = statsAverage;
    }
  }
  const rating = clamp(Math.round(asNumber(firstValue(source, ["rating", "overall", "ovr", "overallRating"]), calculatedRating)), 1, 99);
  const name = asString(firstValue(source, ["name", "displayName", "fullName", "playerName"]), `Player ${index + 1}`);
  const id = cardIdFrom(raw, `card-${index + 1}`);
  const primaryPosition = normalizePosition(firstValue(source, ["position", "role", "primaryRole", "preferredPosition"]));
  const positionsRaw = firstValue(source, ["positions", "eligiblePositions", "roles"]);
  const positions = Array.isArray(positionsRaw)
    ? [...new Set(positionsRaw.map((position) => normalizePosition(position)).filter(Boolean))]
    : [primaryPosition];
  return {
    id,
    name,
    shortName: asString(firstValue(source, ["shortName", "short", "abbr"]), name.slice(0, 12)),
    position: primaryPosition,
    positions: positions.length ? positions : [primaryPosition],
    rating,
    rarity: asString(firstValue(source, ["rarity", "tier", "cardType", "quality"]), "Gold"),
    club: asString(firstValue(source, ["club", "team", "teamName"]), "Pitch11 FC"),
    nation: asString(firstValue(source, ["nation", "country", "nationality"]), "—"),
    level: Math.max(1, Math.round(asNumber(firstValue(source, ["level", "upgradeLevel"]), 1))),
    stats,
  };
}

function findNestedState(raw: unknown): AnyRecord {
  if (!isRecord(raw)) return {};
  const nested = firstValue(raw, ["squad", "snapshot", "data"]);
  return isRecord(nested) ? nested : raw;
}

function readStoreState(store: unknown): unknown {
  if (!isRecord(store)) return store;
  for (const key of ["getState", "getSnapshot", "snapshot", "readState"]) {
    const method = store[key];
    if (typeof method === "function") {
      try {
        const result = (method as () => unknown).call(store);
        if (result !== undefined) return result;
      } catch {
        // A store may require a selector; fall through to its exposed state.
      }
    }
  }
  return firstValue(store, ["state", "current", "snapshot"]) ?? store;
}

function rawCards(state: AnyRecord): unknown[] {
  const nested = objectValue(state, ["inventory", "collection", "cardsState"]);
  const cards = arrayValue(state, ["cards", "playerCards", "roster", "players"]);
  return cards.length ? cards : (arrayValue(nested, ["cards", "players", "items"]).length ? arrayValue(nested, ["cards", "players", "items"]) : [...homeSquadCards]);
}

function cardIdsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cardIdFrom(item)).filter(Boolean);
}

function rawAssignments(state: AnyRecord): AnyRecord {
  const assignments = firstValue(state, ["assignments", "starters", "lineup", "startingXI", "startingXi", "starting11", "xi"]);
  if (isRecord(assignments)) return assignments;
  if (Array.isArray(assignments)) {
    const mapped: AnyRecord = {};
    assignments.forEach((entry, index) => {
      const id = cardIdFrom(entry);
      if (id) mapped[DEFAULT_SLOTS[index]?.id ?? `slot-${index + 1}`] = id;
    });
    return mapped;
  }
  return {};
}

function normalizeSlot(raw: unknown, index: number, assigned: AnyRecord): ViewSlot {
  const source = isRecord(raw) ? raw : {};
  const base = DEFAULT_SLOTS[index] ?? {
    id: `slot-${index + 1}`,
    label: "POS",
    position: "MID",
    x: 50,
    y: Math.max(8, 92 - index * 7),
  };
  const id = asString(firstValue(source, ["id", "slotId", "key"]), base.id);
  const assignment = firstValue(source, ["cardId", "playerId", "assignedCardId", "player", "card"]);
  const cardId = cardIdFrom(assignment, cardIdFrom(assigned[id], "")) || null;
  const rawX = firstValue(source, ["x", "left"]);
  const rawZ = firstValue(source, ["z"]);
  const domainCoordinates = rawZ !== undefined && rawX !== undefined && (Math.abs(asNumber(rawX)) <= 60 || asNumber(rawX) < 0);
  const x = domainCoordinates ? 50 + asNumber(rawX, 0) * 1.15 : asNumber(rawX, base.x);
  const y = domainCoordinates ? 50 - asNumber(rawZ, 0) * 0.76 : asNumber(firstValue(source, ["y", "top"]), base.y);
  return {
    id,
    label: asString(firstValue(source, ["label", "name", "short"]), id.toUpperCase() || base.label),
    position: normalizePosition(firstValue(source, ["position", "role"]), base.position),
    x: clamp(x, 4, 96),
    y: clamp(y, 5, 95),
    cardId,
  };
}

function normalizeFormation(raw: unknown, assigned: AnyRecord, fallback = DEFAULT_FORMATION): ViewFormation {
  const source = isRecord(raw) ? raw : {};
  const slotsSource = arrayValue(source, ["slots", "positions", "formationSlots"]);
  const slots = (slotsSource.length ? slotsSource : fallback.slots).map((slot, index) =>
    normalizeSlot(slot, index, assigned),
  );
  return {
    id: asString(firstValue(source, ["id", "key", "code"]), fallback.id),
    name: asString(firstValue(source, ["name", "label", "title"]), fallback.name),
    slots,
  };
}

function normalizeFormationOptions(state: AnyRecord, current: ViewFormation): ViewFormation[] {
  const rawOptions = arrayValue(state, ["formations", "formationOptions", "availableFormations"]);
  const options = (rawOptions.length ? rawOptions : Object.values(domainFormations)).map((item) => normalizeFormation(item, {}, current));
  if (!options.some((option) => option.id === current.id)) options.unshift(current);
  return options.length ? options : [current];
}

function normalizeTactics(state: AnyRecord): ViewTactics {
  const source = objectValue(state, ["tactics", "tacticalPreset", "instructions"]);
  const instructionsSource = firstValue(source, ["instructions"]);
  const instructions: Record<string, string> = {};
  if (isRecord(instructionsSource)) {
    for (const [cardId, value] of Object.entries(instructionsSource)) {
      if (isRecord(value)) instructions[cardId] = asString(firstValue(value, ["role", "instruction"]), "balanced");
      else instructions[cardId] = asString(value, "balanced");
    }
  }
  return {
    defensiveLine: clamp(Math.round(asNumber(firstValue(source, ["defensiveLine", "defenceLine", "line"]), DEFAULT_TACTICS.defensiveLine)), 0, 100),
    pressing: clamp(Math.round(asNumber(firstValue(source, ["pressing", "pressingIntensity"]), DEFAULT_TACTICS.pressing)), 0, 100),
    buildUp: clamp(Math.round(asNumber(firstValue(source, ["buildUp", "buildUpSpeed", "tempo"]), DEFAULT_TACTICS.buildUp)), 0, 100),
    attackWidth: clamp(Math.round(asNumber(firstValue(source, ["attackWidth", "width"]), DEFAULT_TACTICS.attackWidth)), 0, 100),
    passingStyle: asString(firstValue(source, ["passingStyle", "style"]), DEFAULT_TACTICS.passingStyle),
    instructions,
  };
}

function extractIds(state: AnyRecord, keys: string[]): string[] {
  const value = firstValue(state, keys);
  if (Array.isArray(value)) return cardIdsFrom(value);
  if (isRecord(value)) return cardIdsFrom(firstValue(value, ["cards", "players", "items"]));
  return [];
}

export function normalizeSquadViewModel(raw: unknown): SquadViewModel {
  const state = findNestedState(raw);
  const cards = rawCards(state).map((card, index) => normalizeCard(card, index));
  const assigned = rawAssignments(state);
  const formationCandidate = firstValue(state, ["formation", "selectedFormation", "currentFormation", "formationId"]);
  const formationRaw = typeof formationCandidate === "string" && formationCandidate in domainFormations
    ? domainFormations[formationCandidate as FormationId]
    : formationCandidate;
  const formation = normalizeFormation(formationRaw, assigned);
  const formationOptions = normalizeFormationOptions(state, formation);
  const startingXI = formation.slots.map((slot) => ({ ...slot, cardId: slot.cardId ?? (cardIdFrom(assigned[slot.id], "") || null) }));
  const cardIdSet = new Set(cards.map((card) => card.id));
  const xiIds = new Set(startingXI.map((slot) => slot.cardId).filter((id): id is string => Boolean(id)));
  const bench = extractIds(state, ["bench", "substitutes", "subs"]).filter((id) => cardIdSet.has(id) && !xiIds.has(id));
  const reserves = extractIds(state, ["reserves", "reserveCards"]).filter((id) => cardIdSet.has(id) && !xiIds.has(id) && !bench.includes(id));
  const cardRatings = startingXI
    .map((slot) => cards.find((card) => card.id === slot.cardId)?.rating)
    .filter((rating): rating is number => typeof rating === "number");
  const rawOverall = firstValue(state, ["teamOverall", "teamOVR", "overall", "ovr"]);
  const teamOverall = clamp(Math.round(asNumber(rawOverall, cardRatings.length ? cardRatings.reduce((sum, value) => sum + value, 0) / cardRatings.length : 0)), 0, 99);
  const rawChemistry = firstValue(state, ["chemistry", "teamChemistry", "chem"]);
  const chemistry = clamp(Math.round(asNumber(rawChemistry, calculateChemistry(startingXI, cards))), 0, 100);
  const setPieces = objectValue(state, ["setPieces", "setPieceTakers", "roles"]);
  const readRoleId = (keys: string[]): string | null => cardIdFrom(firstValue(state, keys), cardIdFrom(firstValue(setPieces, keys), "")) || null;
  const savedValue = firstValue(state, ["saved", "isSaved", "persisted"]);
  return {
    cards,
    startingXI,
    bench,
    reserves,
    formation,
    formationOptions,
    tactics: normalizeTactics(state),
    captainId: readRoleId(["captainId", "captain"]),
    penaltyTakerId: readRoleId(["penaltyTakerId", "penaltyTaker", "penalties", "penalty"]),
    freeKickTakerId: readRoleId(["freeKickTakerId", "freeKickTaker", "freeKicks", "freeKick"]),
    cornerTakerId: readRoleId(["cornerTakerId", "cornerTaker", "corners", "corner"]),
    chemistry,
    teamOverall,
    saved: Boolean(savedValue),
    saveStatus: asString(firstValue(state, ["saveStatus", "status"]), savedValue ? "Saved" : "Unsaved changes"),
  };
}

function calculateChemistry(slots: ViewSlot[], cards: ViewCard[]): number {
  const filled = slots.filter((slot) => slot.cardId);
  if (!filled.length) return 0;
  const fitting = filled.filter((slot) => {
    const card = cards.find((item) => item.id === slot.cardId);
    return card ? positionFits(card.positions, slot.position) : false;
  });
  return Math.round((fitting.length / Math.max(slots.length, 11)) * 100);
}

export function positionFits(cardPosition: string | string[], slotPosition: string): boolean {
  const cardPositions = Array.isArray(cardPosition) ? cardPosition.map((value) => normalizePosition(value)) : [normalizePosition(cardPosition)];
  const slot = normalizePosition(slotPosition);
  if (!slot || slot === "POS") return true;
  return cardPositions.some((card) => card === slot || (slot === "DEF" && card === "DEF") || (slot === "MID" && card === "MID") || (slot === "FWD" && card === "FWD"));
}

export function validateSquadView(model: SquadViewModel): SquadValidation {
  const warnings: string[] = [];
  const mismatches: SquadValidation["mismatches"] = [];
  const cards = new Map(model.cards.map((card) => [card.id, card]));
  const filled = model.startingXI.filter((slot) => slot.cardId);
  if (filled.length !== 11) warnings.push(`Starting XI needs ${11 - filled.length} more player${11 - filled.length === 1 ? "" : "s"}.`);
  const duplicateIds = filled.map((slot) => slot.cardId as string).filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) warnings.push("A player card cannot occupy two starting XI slots.");
  for (const slot of model.startingXI) {
    if (!slot.cardId) {
      warnings.push(`${slot.label} is empty.`);
      continue;
    }
    const card = cards.get(slot.cardId);
    if (!card) {
      warnings.push(`${slot.label} references an unavailable card.`);
      continue;
    }
    if (!positionFits(card.positions, slot.position)) {
      mismatches.push({ slotId: slot.id, cardId: card.id, expected: slot.position, actual: card.position });
      warnings.push(`${card.shortName} is ${card.position}; ${slot.label} prefers ${slot.position}.`);
    }
  }
  return { valid: warnings.length === 0, warnings: [...new Set(warnings)], mismatches };
}

export function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case "tab":
      return { ...state, activeTab: action.tab };
    case "card":
      return {
        ...state,
        selectedCardId: state.selectedCardId === action.cardId ? null : action.cardId,
        selectedSlotId: null,
      };
    case "slot":
      return {
        ...state,
        selectedSlotId: state.selectedSlotId === action.slotId ? null : action.slotId,
        selectedCardId: null,
      };
    case "clear":
      return { ...state, selectedCardId: null, selectedSlotId: null };
  }
}

export function upgradePreview(rating: number, amount = 3): { value: number; label: string } {
  const value = clamp(Math.round(rating), 0, 99);
  const upgraded = Math.min(99, value + amount);
  return { value: upgraded, label: upgraded === value ? `${value} OVR (capped at 99)` : `${value} → ${upgraded} OVR preview` };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function createElement<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, label?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (label !== undefined) element.textContent = label;
  return element;
}

function setAttributes(element: HTMLElement, attributes: Record<string, string | boolean | undefined>): void {
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, value);
  }
}

function button(className: string, label: string): HTMLButtonElement {
  const element = createElement("button", className, label);
  element.type = "button";
  return element;
}

function valueLabel(value: number): string {
  if (value < 34) return "Low";
  if (value < 67) return "Balanced";
  return "High";
}

function methodFrom(store: unknown, names: string[]): ((...args: unknown[]) => unknown) | null {
  if (!isRecord(store)) return null;
  for (const name of names) {
    const candidate = store[name];
    if (typeof candidate === "function") return candidate.bind(store) as (...args: unknown[]) => unknown;
  }
  return null;
}

function asUnsubscribe(value: unknown): (() => void) | null {
  return typeof value === "function" ? (value as () => void) : null;
}

export class SquadUI {
  private readonly root: HTMLElement;
  private readonly store: unknown;
  private readonly onPlay: () => void;
  private readonly onClose?: (reason: SquadUICloseReason) => void;
  private overlay: HTMLElement | null = null;
  private shell: HTMLElement | null = null;
  private nav: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private liveRegion: HTMLElement | null = null;
  private previousActiveElement: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private isOpen = false;
  private isDestroyed = false;
  private closeNotified = false;
  private selection: SelectionState = { activeTab: "squad", selectedCardId: null, selectedSlotId: null };
  private assignmentOverrides = new Map<string, string | null>();
  private model: SquadViewModel = normalizeSquadViewModel({});
  private validation: SquadValidation = validateSquadView(this.model);
  private statusMessage = "Squad ready";

  constructor(options: SquadUIOptions) {
    this.root = options.root;
    this.store = options.store;
    this.onPlay = options.onPlay;
    this.onClose = options.onClose;
    this.root.setAttribute("data-squad-ui-host", "true");
    this.buildShell();
    this.attachStoreSubscription();
    this.render();
  }

  open(): void {
    if (this.isDestroyed || !this.overlay) return;
    this.previousActiveElement = this.root.ownerDocument.activeElement instanceof HTMLElement ? this.root.ownerDocument.activeElement : null;
    this.closeNotified = false;
    this.isOpen = true;
    this.overlay.classList.add("is-open");
    this.overlay.setAttribute("aria-hidden", "false");
    this.overlay.removeAttribute("inert");
    this.render();
    const close = this.overlay.querySelector<HTMLElement>("[data-squad-close]");
    close?.focus({ preventScroll: true });
  }

  close(notify = false, reason: SquadUICloseReason = "close"): void {
    if (this.isDestroyed || !this.overlay || !this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove("is-open");
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.setAttribute("inert", "");
    if (notify && reason === "close" && !this.closeNotified) {
      this.closeNotified = true;
      this.onClose?.(reason);
    }
    this.previousActiveElement?.focus?.({ preventScroll: true });
    this.previousActiveElement = null;
  }

  render(): void {
    if (this.isDestroyed || !this.overlay || !this.nav || !this.content) return;
    const normalized = normalizeSquadViewModel(readStoreState(this.store));
    const persisted = isRecord(this.store) && ("serialized" in this.store || "revision" in this.store);
    this.model = this.applyOverrides(persisted ? { ...normalized, saved: true, saveStatus: "Saved locally" } : normalized);
    this.validation = validateSquadView(this.model);
    this.renderHeader();
    this.renderTabs();
    this.content.replaceChildren(this.renderActivePanel());
    this.renderLiveStatus();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.overlay?.remove();
    this.overlay = null;
    this.shell = null;
    this.nav = null;
    this.content = null;
    this.liveRegion = null;
    this.root.removeAttribute("data-squad-ui-host");
  }

  debugSnapshot(): {
    isOpen: boolean;
    activeTab: SquadTab;
    selectedCardId: string | null;
    selectedSlotId: string | null;
    formationId: string;
    chemistry: number;
    teamOverall: number;
    valid: boolean;
    warnings: string[];
    startingXI: Array<{ slotId: string; cardId: string | null }>;
  } {
    return {
      isOpen: this.isOpen,
      activeTab: this.selection.activeTab,
      selectedCardId: this.selection.selectedCardId,
      selectedSlotId: this.selection.selectedSlotId,
      formationId: this.model.formation.id,
      chemistry: this.model.chemistry,
      teamOverall: this.model.teamOverall,
      valid: this.validation.valid,
      warnings: [...this.validation.warnings],
      startingXI: this.model.startingXI.map((slot) => ({ slotId: slot.id, cardId: slot.cardId })),
    };
  }

  private buildShell(): void {
    const overlay = createElement("div", "squad-ui-overlay");
    overlay.dataset.squadUi = "true";
    overlay.setAttribute("data-squad-ui", "true");
    overlay.setAttribute("aria-hidden", "true");
    overlay.setAttribute("inert", "");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Squad management");

    const shell = createElement("div", "squad-ui-shell");
    const header = createElement("header", "squad-ui-header");
    const masthead = createElement("div", "squad-ui-masthead");
    const mark = createElement("div", "squad-ui-mark", "P11");
    const titleGroup = createElement("div", "squad-ui-title-group");
    titleGroup.append(createElement("p", "squad-ui-eyebrow", "CLUB OPERATIONS"), createElement("h1", "squad-ui-title", "Squad studio"));
    masthead.append(mark, titleGroup);
    const actions = createElement("div", "squad-ui-header-actions");
    const close = button("squad-ui-button squad-ui-button-quiet", "Close");
    close.dataset.squadClose = "true";
    close.setAttribute("aria-label", "Close squad management");
    actions.append(close);
    header.append(masthead, actions);

    const metrics = createElement("div", "squad-ui-metrics");
    metrics.dataset.squadMetrics = "true";
    const tabs = createElement("nav", "squad-ui-tabs");
    tabs.setAttribute("aria-label", "Squad sections");
    this.nav = tabs;
    const main = createElement("main", "squad-ui-main");
    this.content = main;
    const live = createElement("div", "squad-ui-live", "Squad ready");
    live.dataset.squadStatus = "true";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    this.liveRegion = live;
    const footer = createElement("footer", "squad-ui-footer");
    const footerStatus = createElement("span", "squad-ui-footer-status", "Changes save locally");
    footerStatus.dataset.squadSaveStatus = "true";
    const reset = button("squad-ui-button squad-ui-button-quiet", "Reset squad");
    reset.dataset.squadReset = "true";
    const play = button("squad-ui-button squad-ui-button-primary", "Play Match");
    play.dataset.squadPlay = "true";
    play.setAttribute("aria-label", "Play match with this squad");
    footer.append(footerStatus, createElement("div", "squad-ui-footer-actions"), reset, play);
    // Keep reset and play in the actions group without putting text nodes in the
    // shell.  This also makes the footer order predictable on narrow screens.
    const footerActions = footer.querySelector<HTMLElement>(".squad-ui-footer-actions");
    footerActions?.append(reset, play);

    shell.append(header, metrics, tabs, main, live, footer);
    overlay.append(shell);
    this.root.append(overlay);
    this.overlay = overlay;
    this.shell = shell;

    overlay.addEventListener("click", this.handleClick);
    overlay.addEventListener("change", this.handleChange);
    overlay.addEventListener("input", this.handleInput);
    overlay.addEventListener("keydown", this.handleKeyDown);
    overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
  }

  private attachStoreSubscription(): void {
    const subscribe = methodFrom(this.store, ["subscribe", "onChange", "listen"]);
    if (!subscribe) return;
    try {
      const unsubscribe = subscribe(() => {
        if (!this.isDestroyed) this.render();
      });
      this.unsubscribe = asUnsubscribe(unsubscribe);
    } catch {
      this.unsubscribe = null;
    }
  }

  private renderHeader(): void {
    const metrics = this.overlay?.querySelector<HTMLElement>("[data-squad-metrics]");
    if (!metrics) return;
    metrics.replaceChildren(
      this.metric("TEAM OVR", this.model.teamOverall ? String(this.model.teamOverall) : "—"),
      this.metric("CHEMISTRY", `${this.model.chemistry}%`),
      this.metric("FORMATION", this.model.formation.id),
      this.metric("STATUS", this.model.saved ? "Saved" : "Draft"),
    );
  }

  private metric(label: string, value: string): HTMLElement {
    const item = createElement("div", "squad-ui-metric");
    item.append(createElement("span", "squad-ui-metric-label", label), createElement("strong", "squad-ui-metric-value", value));
    return item;
  }

  private renderTabs(): void {
    if (!this.nav) return;
    this.nav.replaceChildren();
    const tabs: Array<[SquadTab, string, string]> = [
      ["squad", "Squad", "Build your starting XI"],
      ["cards", "Cards", "Review your collection"],
      ["tactics", "Tactics", "Shape the match plan"],
    ];
    for (const [id, label, description] of tabs) {
      const tab = button("squad-ui-tab", label);
      tab.dataset.squadTab = id;
      tab.id = `squad-tab-${id}`;
      tab.setAttribute("aria-controls", `squad-panel-${id}`);
      tab.setAttribute("aria-selected", String(this.selection.activeTab === id));
      tab.setAttribute("role", "tab");
      tab.setAttribute("tabindex", this.selection.activeTab === id ? "0" : "-1");
      tab.title = description;
      if (this.selection.activeTab === id) tab.classList.add("is-active");
      this.nav.append(tab);
    }
  }

  private renderActivePanel(): HTMLElement {
    const panel = createElement("section", "squad-ui-panel");
    panel.id = `squad-panel-${this.selection.activeTab}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `squad-tab-${this.selection.activeTab}`);
    if (this.selection.activeTab === "cards") return this.renderCardsPanel(panel);
    if (this.selection.activeTab === "tactics") return this.renderTacticsPanel(panel);
    return this.renderSquadPanel(panel);
  }

  private renderSquadPanel(panel: HTMLElement): HTMLElement {
    const layout = createElement("div", "squad-ui-layout");
    const left = createElement("div", "squad-ui-column squad-ui-column-main");
    const squadHeader = createElement("div", "squad-ui-section-heading");
    const heading = createElement("div");
    heading.append(createElement("p", "squad-ui-kicker", "STARTING XI"), createElement("h2", "squad-ui-section-title", "The matchday squad"));
    const formationLabel = createElement("label", "squad-ui-field squad-ui-field-compact");
    formationLabel.append(createElement("span", "squad-ui-field-label", "Formation"));
    const formationSelect = createElement("select", "squad-ui-select") as HTMLSelectElement;
    formationSelect.dataset.squadFormation = "true";
    formationSelect.setAttribute("aria-label", "Choose formation");
    for (const option of this.model.formationOptions) {
      const item = createElement("option") as HTMLOptionElement;
      item.value = option.id;
      item.textContent = option.name;
      item.selected = option.id === this.model.formation.id;
      formationSelect.append(item);
    }
    formationLabel.append(formationSelect);
    squadHeader.append(heading, formationLabel);
    const pitch = this.renderPitch();
    const warnings = this.renderWarnings();
    left.append(squadHeader, pitch, warnings);

    const right = createElement("aside", "squad-ui-column squad-ui-column-side");
    right.append(this.renderRosterList("Bench", this.model.bench), this.renderRosterList("Reserves", this.model.reserves), this.renderSelectedCard());
    layout.append(left, right);
    panel.append(layout);
    return panel;
  }

  private renderPitch(): HTMLElement {
    const wrap = createElement("section", "squad-ui-pitch-wrap");
    const pitch = createElement("div", "squad-ui-pitch");
    pitch.setAttribute("role", "group");
    pitch.setAttribute("aria-label", `Starting XI in ${this.model.formation.name}`);
    for (const slot of this.model.startingXI) {
      const card = slot.cardId ? this.model.cards.find((item) => item.id === slot.cardId) : undefined;
      const slotButton = button("squad-ui-slot", card?.shortName ?? slot.label);
      slotButton.dataset.slotId = slot.id;
      slotButton.style.left = `${slot.x}%`;
      slotButton.style.top = `${slot.y}%`;
      slotButton.setAttribute("aria-label", card ? `${slot.label}: ${card.name}, ${card.rating} overall` : `${slot.label}: empty slot`);
      slotButton.setAttribute("aria-pressed", String(this.selection.selectedSlotId === slot.id));
      if (this.selection.selectedSlotId === slot.id) slotButton.classList.add("is-selected");
      if (card) {
        slotButton.dataset.cardId = card.id;
        slotButton.append(createElement("strong", "squad-ui-slot-rating", String(card.rating)), createElement("span", "squad-ui-slot-position", slot.label), createElement("span", "squad-ui-slot-name", card.shortName));
        if (!positionFits(card.positions, slot.position)) slotButton.classList.add("is-warning");
      } else {
        slotButton.append(createElement("strong", "squad-ui-slot-rating", "—"), createElement("span", "squad-ui-slot-position", slot.label), createElement("span", "squad-ui-slot-name", "Assign"));
      }
      pitch.append(slotButton);
    }
    wrap.append(pitch, createElement("p", "squad-ui-pitch-hint", this.selection.selectedCardId ? "Choose a slot to assign or swap this card." : "Select a player card, then select a slot."));
    return wrap;
  }

  private renderWarnings(): HTMLElement {
    const wrap = createElement("section", "squad-ui-warning-panel");
    wrap.dataset.squadWarnings = "true";
    wrap.tabIndex = -1;
    wrap.setAttribute("aria-live", this.validation.valid ? "polite" : "assertive");
    wrap.setAttribute("role", this.validation.valid ? "status" : "alert");
    const title = createElement("div", "squad-ui-warning-heading");
    title.append(createElement("span", "squad-ui-warning-icon", this.validation.valid ? "✓" : "!"), createElement("strong", "squad-ui-warning-title", this.validation.valid ? "Match-ready squad" : "Squad needs attention"));
    wrap.append(title);
    if (this.validation.valid) {
      wrap.append(createElement("p", "squad-ui-warning-copy", "Every starting XI position is filled and in role."));
      return wrap;
    }
    const list = createElement("ul", "squad-ui-warning-list");
    for (const warning of this.validation.warnings.slice(0, 5)) list.append(createElement("li", "squad-ui-warning-item", warning));
    wrap.append(list);
    return wrap;
  }

  private renderRosterList(label: string, ids: string[]): HTMLElement {
    const section = createElement("section", "squad-ui-roster");
    const title = createElement("div", "squad-ui-roster-heading");
    title.append(createElement("h3", "squad-ui-subtitle", label), createElement("span", "squad-ui-count", String(ids.length)));
    section.append(title);
    const list = createElement("div", "squad-ui-card-list");
    if (!ids.length) list.append(createElement("p", "squad-ui-empty", `No ${label.toLowerCase()} assigned.`));
    ids.forEach((id) => {
      const card = this.model.cards.find((item) => item.id === id);
      if (card) list.append(this.renderCardButton(card, "compact"));
    });
    section.append(list);
    return section;
  }

  private renderSelectedCard(): HTMLElement {
    const selectedId = this.selection.selectedCardId ?? (this.selection.selectedSlotId ? this.model.startingXI.find((slot) => slot.id === this.selection.selectedSlotId)?.cardId ?? null : null);
    const card = selectedId ? this.model.cards.find((item) => item.id === selectedId) : undefined;
    const section = createElement("section", "squad-ui-detail");
    section.append(createElement("p", "squad-ui-kicker", "PLAYER DETAIL"));
    if (!card) {
      section.append(createElement("h3", "squad-ui-detail-title", "Select a card"), createElement("p", "squad-ui-detail-copy", "Choose a card or pitch slot to inspect attributes and upgrade potential."));
      return section;
    }
    section.append(this.renderCardHero(card), this.renderAttributes(card), this.renderUpgrade(card));
    return section;
  }

  private renderCardHero(card: ViewCard): HTMLElement {
    const hero = createElement("div", "squad-ui-detail-hero");
    const rating = createElement("strong", "squad-ui-detail-rating", String(card.rating));
    const info = createElement("div", "squad-ui-detail-player");
    info.append(createElement("h3", "squad-ui-detail-title", card.name), createElement("p", "squad-ui-detail-meta", `${card.position} · ${card.rarity} · ${card.club}`));
    hero.append(rating, info);
    return hero;
  }

  private renderAttributes(card: ViewCard): HTMLElement {
    const section = createElement("div", "squad-ui-attributes");
    for (const [key, value] of Object.entries(card.stats)) {
      const row = createElement("div", "squad-ui-attribute");
      const label = createElement("span", "squad-ui-attribute-name", key.toUpperCase());
      const track = createElement("span", "squad-ui-attribute-track");
      const fill = createElement("span", "squad-ui-attribute-fill");
      fill.style.width = `${clamp(value, 0, 99)}%`;
      track.append(fill);
      row.append(label, track, createElement("strong", "squad-ui-attribute-value", String(value)));
      section.append(row);
    }
    return section;
  }

  private renderUpgrade(card: ViewCard): HTMLElement {
    const preview = upgradePreview(card.rating);
    const section = createElement("div", "squad-ui-upgrade");
    section.append(createElement("span", "squad-ui-upgrade-label", "UPGRADE PREVIEW"), createElement("strong", "squad-ui-upgrade-value", `+3 · ${preview.label}`), createElement("span", "squad-ui-upgrade-note", "Preview only · upgrade flow arrives in the card service."));
    return section;
  }

  private renderCardButton(card: ViewCard, variant: "compact" | "large" = "large"): HTMLButtonElement {
    const item = button(`squad-ui-card squad-ui-card-${variant}`, "");
    item.dataset.cardId = card.id;
    item.setAttribute("aria-label", `Select ${card.name}, ${card.rating} overall, ${card.position}`);
    item.setAttribute("aria-pressed", String(this.selection.selectedCardId === card.id));
    if (this.selection.selectedCardId === card.id) item.classList.add("is-selected");
    const badge = createElement("span", "squad-ui-card-badge", String(card.rating));
    const body = createElement("span", "squad-ui-card-body");
    body.append(createElement("strong", "squad-ui-card-name", card.name), createElement("span", "squad-ui-card-meta", `${card.position} · ${card.rarity}`));
    item.append(badge, body, createElement("span", "squad-ui-card-chevron", "›"));
    return item;
  }

  private renderCardsPanel(panel: HTMLElement): HTMLElement {
    const intro = createElement("div", "squad-ui-panel-intro");
    intro.append(createElement("div", "squad-ui-panel-title", "Player cards"), createElement("p", "squad-ui-panel-copy", `${this.model.cards.length} cards in your collection · select a card to review its profile.`));
    const grid = createElement("div", "squad-ui-card-grid");
    for (const card of this.model.cards) grid.append(this.renderCardButton(card));
    const detail = this.renderSelectedCard();
    detail.classList.add("squad-ui-card-detail-panel");
    const layout = createElement("div", "squad-ui-cards-layout");
    layout.append(grid, detail);
    panel.append(intro, layout);
    return panel;
  }

  private renderTacticsPanel(panel: HTMLElement): HTMLElement {
    const intro = createElement("div", "squad-ui-panel-intro");
    intro.append(createElement("div", "squad-ui-panel-title", "Tactical identity"), createElement("p", "squad-ui-panel-copy", "Set the personality of your team before the whistle."));
    const layout = createElement("div", "squad-ui-tactics-layout");
    const sliders = createElement("section", "squad-ui-tactics-card");
    sliders.append(createElement("p", "squad-ui-kicker", "TEAM BEHAVIOUR"));
    const fields: Array<[keyof ViewTactics, string, string]> = [
      ["defensiveLine", "Defensive line", "How high the back four holds."],
      ["pressing", "Pressing intensity", "How quickly the team hunts the ball."],
      ["buildUp", "Build-up speed", "Tempo from recovery into attack."],
      ["attackWidth", "Attack width", "Distance between wide outlets."],
    ];
    for (const [key, label, hint] of fields) sliders.append(this.renderSlider(key, label, hint, this.model.tactics[key] as number));
    const passing = createElement("label", "squad-ui-field");
    passing.append(createElement("span", "squad-ui-field-label", "Passing style"), createElement("small", "squad-ui-field-hint", "The default risk profile for possession."));
    const select = createElement("select", "squad-ui-select") as HTMLSelectElement;
    select.dataset.tacticField = "passingStyle";
    for (const [value, label] of [["balanced", "Balanced"], ["short", "Short & safe"], ["direct", "Direct"]] as const) {
      const option = createElement("option") as HTMLOptionElement;
      option.value = value;
      option.textContent = label;
      option.selected = this.model.tactics.passingStyle === value;
      select.append(option);
    }
    passing.append(select);
    sliders.append(passing);

    const roles = createElement("section", "squad-ui-tactics-card");
    roles.append(createElement("p", "squad-ui-kicker", "MATCH ROLES"), createElement("p", "squad-ui-field-hint squad-ui-role-intro", "Set-piece roles are available to your starting XI."));
    roles.append(this.renderRoleSelect("Captain", "captainId", this.model.captainId), this.renderRoleSelect("Penalty taker", "penaltyTakerId", this.model.penaltyTakerId), this.renderRoleSelect("Free-kick taker", "freeKickTakerId", this.model.freeKickTakerId), this.renderRoleSelect("Corner taker", "cornerTakerId", this.model.cornerTakerId));
    roles.append(this.renderInstructionSelects());
    const summary = createElement("div", "squad-ui-tactics-summary");
    summary.append(this.metric("CHEMISTRY", `${this.model.chemistry}%`), this.metric("TEAM OVR", String(this.model.teamOverall || "—")));
    roles.append(summary);
    layout.append(sliders, roles);
    panel.append(intro, layout);
    return panel;
  }

  private renderSlider(key: keyof ViewTactics, label: string, hint: string, value: number): HTMLElement {
    const field = createElement("label", "squad-ui-field squad-ui-range-field");
    const head = createElement("span", "squad-ui-range-head");
    head.append(createElement("span", "squad-ui-field-label", label), createElement("strong", "squad-ui-range-value", `${value} · ${valueLabel(value)}`));
    field.append(head, createElement("small", "squad-ui-field-hint", hint));
    const input = createElement("input", "squad-ui-range") as HTMLInputElement;
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(value);
    input.dataset.tacticField = key;
    input.setAttribute("aria-label", label);
    field.append(input);
    return field;
  }

  private renderRoleSelect(label: string, fieldName: string, selectedId: string | null): HTMLElement {
    const field = createElement("label", "squad-ui-field");
    field.append(createElement("span", "squad-ui-field-label", label));
    const select = createElement("select", "squad-ui-select") as HTMLSelectElement;
    select.dataset.roleField = fieldName;
    const empty = createElement("option") as HTMLOptionElement;
    empty.value = "";
    empty.textContent = "Unassigned";
    empty.selected = !selectedId;
    select.append(empty);
    for (const slot of this.model.startingXI) {
      if (!slot.cardId) continue;
      const card = this.model.cards.find((item) => item.id === slot.cardId);
      if (!card) continue;
      const option = createElement("option") as HTMLOptionElement;
      option.value = card.id;
      option.textContent = `${card.shortName} · ${slot.label}`;
      option.selected = selectedId === card.id;
      select.append(option);
    }
    field.append(select);
    return field;
  }

  private renderInstructionSelects(): HTMLElement {
    const section = createElement("section", "squad-ui-instructions");
    section.append(createElement("p", "squad-ui-kicker", "PLAYER INSTRUCTIONS"), createElement("p", "squad-ui-field-hint squad-ui-role-intro", "Give each outfield player a simple matchday brief."));
    const list = createElement("div", "squad-ui-instruction-list");
    const options = [["balanced", "Balanced"], ["stayBack", "Stay back"], ["getForward", "Get forward"], ["freeRoam", "Free roam"]] as const;
    for (const slot of this.model.startingXI) {
      if (!slot.cardId || slot.position === "GK") continue;
      const card = this.model.cards.find((item) => item.id === slot.cardId);
      if (!card) continue;
      const field = createElement("label", "squad-ui-field squad-ui-instruction-field");
      field.append(createElement("span", "squad-ui-field-label", `${card.shortName} · ${slot.label}`));
      const select = createElement("select", "squad-ui-select") as HTMLSelectElement;
      select.dataset.instructionCardId = card.id;
      select.setAttribute("aria-label", `${card.name} instruction`);
      const selected = this.model.tactics.instructions[card.id] ?? "balanced";
      for (const [value, label] of options) {
        const option = createElement("option") as HTMLOptionElement;
        option.value = value;
        option.textContent = label;
        option.selected = value === selected;
        select.append(option);
      }
      field.append(select);
      list.append(field);
    }
    section.append(list);
    return section;
  }

  private renderLiveStatus(): void {
    if (this.liveRegion) this.liveRegion.textContent = this.statusMessage;
    const footerStatus = this.overlay?.querySelector<HTMLElement>("[data-squad-save-status]");
    if (footerStatus) footerStatus.textContent = this.model.saveStatus || this.statusMessage;
  }

  private applyOverrides(model: SquadViewModel): SquadViewModel {
    if (!this.assignmentOverrides.size) return model;
    const startingXI = model.startingXI.map((slot) => this.assignmentOverrides.has(slot.id) ? { ...slot, cardId: this.assignmentOverrides.get(slot.id) ?? null } : slot);
    return { ...model, startingXI };
  }

  private setStatus(message: string): void {
    this.statusMessage = message;
    this.renderLiveStatus();
  }

  private invoke(names: string[], ...args: unknown[]): boolean {
    const method = methodFrom(this.store, names);
    if (!method) return false;
    try {
      method(...args);
      return true;
    } catch {
      return false;
    }
  }

  private selectCard(cardId: string): void {
    this.selection = reduceSelection(this.selection, { type: "card", cardId });
    this.setStatus(`Selected ${this.model.cards.find((card) => card.id === cardId)?.name ?? "player card"}. Choose a slot.`);
    this.render();
  }

  private selectSlot(slotId: string): void {
    const slot = this.model.startingXI.find((item) => item.id === slotId);
    if (!slot) return;
    if (this.selection.selectedCardId) {
      this.assignCard(this.selection.selectedCardId, slotId);
      return;
    }
    if (slot.cardId) {
      this.selection = reduceSelection(this.selection, { type: "card", cardId: slot.cardId });
      this.selection = { ...this.selection, selectedSlotId: slotId };
      this.setStatus(`Selected ${slot.label}. Choose another slot to swap.`);
    } else {
      this.selection = reduceSelection(this.selection, { type: "slot", slotId });
      this.setStatus(`${slot.label} is empty. Select a card to assign.`);
    }
    this.render();
  }

  private assignCard(cardId: string, slotId: string): void {
    const sourceSlot = this.model.startingXI.find((slot) => slot.cardId === cardId);
    const targetSlot = this.model.startingXI.find((slot) => slot.id === slotId);
    if (!targetSlot) return;
    if (sourceSlot && sourceSlot.id !== slotId) {
      const invoked = targetSlot.cardId
        ? this.invoke(["swapAssignments", "swapSlots", "swapCards", "swap"], sourceSlot.id, slotId)
        : this.invoke(["move"], cardId, "starter", slotId);
      this.assignmentOverrides.set(sourceSlot.id, targetSlot.cardId);
      this.assignmentOverrides.set(slotId, cardId);
      this.setStatus(invoked ? "Players swapped." : "Swap staged. Save to apply the new XI.");
    } else {
      const invoked = this.invoke(["assignCardToSlot", "assignPlayerToSlot", "setAssignment", "assign"], cardId, slotId)
        || this.invoke(["move"], cardId, "starter", slotId);
      this.assignmentOverrides.set(slotId, cardId);
      this.setStatus(invoked ? "Player assigned." : "Assignment staged. Save to apply the new XI.");
    }
    this.selection = { ...this.selection, selectedCardId: null, selectedSlotId: null };
    this.invoke(["markDirty", "setDirty"]);
    this.render();
  }

  private updateFormation(formationId: string): void {
    if (!formationId || formationId === this.model.formation.id) return;
    const invoked = this.invoke(["setFormation", "selectFormation", "changeFormation"], formationId);
    this.assignmentOverrides.clear();
    this.setStatus(invoked ? `Formation changed to ${formationId}.` : `Formation staged: ${formationId}.`);
    this.render();
  }

  private updateTactic(field: string, value: string): void {
    const numericFields: Array<keyof ViewTactics> = ["defensiveLine", "pressing", "buildUp", "attackWidth"];
    const numericValue = clamp(Math.round(asNumber(value, 0)), 0, 100);
    const patch: AnyRecord = field === "pressing"
      ? { pressingIntensity: numericValue }
      : field === "buildUp"
        ? { buildUpSpeed: numericValue }
        : field === "defensiveLine"
          ? { defensiveLine: numericValue }
          : field === "attackWidth"
            ? { attackWidth: numericValue }
            : numericFields.includes(field as keyof ViewTactics)
              ? { [field]: numericValue }
              : { passingStyle: value };
    const invoked = this.invoke(["updateTactics", "setTactics", "setTacticalPreset"], patch);
    this.setStatus(invoked ? "Tactics updated." : "Tactics staged. Save to apply them.");
    this.render();
  }

  private updateInstruction(cardId: string, role: string): void {
    const allowed = new Set(["balanced", "stayBack", "getForward", "freeRoam"]);
    const normalizedRole = allowed.has(role) ? role : "balanced";
    const invoked = this.invoke(["updateTactics", "setTactics", "setTacticalPreset"], {
      instructions: { [cardId]: { role: normalizedRole } },
    });
    this.setStatus(invoked ? "Player instruction updated." : "Player instruction staged. Save to apply it.");
    this.render();
  }

  private updateRole(field: string, cardId: string): void {
    const methods: Record<string, string[]> = {
      captainId: ["setCaptain", "setCaptainId", "setRole"],
      penaltyTakerId: ["setPenaltyTaker", "setPenaltyTakerId", "setPieceTaker"],
      freeKickTakerId: ["setFreeKickTaker", "setFreeKickTakerId", "setPieceTaker"],
      cornerTakerId: ["setCornerTaker", "setCornerTakerId", "setPieceTaker"],
    };
    let invoked = false;
    if (field === "captainId") {
      invoked = this.invoke(["setCaptain"], cardId || null);
    } else {
      const pieceType: SetPieceType | null = field === "penaltyTakerId"
        ? "penalty"
        : field === "freeKickTakerId"
          ? "freeKick"
          : field === "cornerTakerId"
            ? "corner"
            : null;
      invoked = pieceType ? this.invoke(["setPiece"], pieceType, cardId || null) : this.invoke(methods[field] ?? [], cardId || null, field);
    }
    this.setStatus(invoked ? `${field.replace(/Id$/, "")} updated.` : "Role staged. Save to apply it.");
    this.render();
  }

  private save(): void {
    const invoked = this.invoke(["save", "persist", "saveSquad", "commit"]);
    // The announced SquadStore persists on each mutation.  A save method is
    // still accepted for adapters that batch writes, but it is not required.
    const persisted = invoked || (isRecord(this.store) && "serialized" in this.store);
    this.setStatus(persisted ? "Squad saved locally." : "Squad ready to play.");
    this.render();
  }

  private reset(): void {
    this.assignmentOverrides.clear();
    const invoked = this.invoke(["reset", "resetSquad", "restoreDefaults"]);
    this.selection = { activeTab: "squad", selectedCardId: null, selectedSlotId: null };
    this.setStatus(invoked ? "Squad reset." : "Local squad draft reset.");
    this.render();
  }

  private play(): void {
    this.model = this.applyOverrides(normalizeSquadViewModel(readStoreState(this.store)));
    this.validation = validateSquadView(this.model);
    if (!this.validation.valid) {
      this.selection = { ...this.selection, activeTab: "squad" };
      this.statusMessage = this.validation.warnings[0] ?? "Complete the squad before playing.";
      this.render();
      const warnings = this.overlay?.querySelector<HTMLElement>("[data-squad-warnings]");
      warnings?.focus?.({ preventScroll: false });
      return;
    }
    this.save();
    this.setStatus("Matchday squad confirmed.");
    this.onPlay();
    this.close(false, "play");
  }

  private handleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof Element)) return;
    const close = target.closest<HTMLElement>("[data-squad-close]");
    if (close) {
      this.close(true, "close");
      return;
    }
    const tab = target.closest<HTMLButtonElement>("[data-squad-tab]");
    if (tab) {
      const id = tab.dataset.squadTab as SquadTab | undefined;
      if (id) {
        this.selection = reduceSelection(this.selection, { type: "tab", tab: id });
        this.render();
      }
      return;
    }
    if (target.closest("[data-squad-play]")) {
      this.play();
      return;
    }
    if (target.closest("[data-squad-reset]")) {
      this.reset();
      return;
    }
    const card = target.closest<HTMLElement>("[data-card-id]");
    const slot = target.closest<HTMLElement>("[data-slot-id]");
    if (card?.dataset.cardId && !slot) {
      this.selectCard(card.dataset.cardId);
      return;
    }
    if (slot?.dataset.slotId) this.selectSlot(slot.dataset.slotId);
  };

  private handleChange = (event: Event): void => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.dataset.squadFormation) this.updateFormation(target.value);
    else if (target.dataset.instructionCardId) this.updateInstruction(target.dataset.instructionCardId, target.value);
    else if (target.dataset.tacticField) this.updateTactic(target.dataset.tacticField, target.value);
    else if (target.dataset.roleField) this.updateRole(target.dataset.roleField, target.value);
  };

  private handleInput = (event: Event): void => {
    event.stopPropagation();
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.dataset.tacticField) return;
    const field = target.closest(".squad-ui-field")?.querySelector<HTMLElement>(".squad-ui-range-value");
    const value = asNumber(target.value, 0);
    if (field) field.textContent = `${value} · ${valueLabel(value)}`;
    this.updateTactic(target.dataset.tacticField, target.value);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (!this.overlay || !this.isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close(true, "close");
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(this.overlay.querySelectorAll<HTMLElement>("button, select, input, [tabindex]:not([tabindex='-1'])")).filter((item) => !item.hasAttribute("disabled") && item.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && this.root.ownerDocument.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.root.ownerDocument.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
}
