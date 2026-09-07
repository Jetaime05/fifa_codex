import * as THREE from "three";
import type { TeamId } from "../../data/types";

/** The three passing profiles exposed by the Phase 6D editor. */
export type RuntimePassingStyle = "short" | "balanced" | "direct";

/** Runtime-safe player instructions. Keys are runtime player/card ids. */
export type RuntimePlayerInstruction = "balanced" | "stayBack" | "getForward" | "freeRoam";

/** Short aliases for match-side callers that do not need the runtime prefix. */
export type RuntimeTactics = RuntimeTeamTactics;
export type PlayerInstruction = RuntimePlayerInstruction;

/**
 * The deliberately small contract shared by management and match runtime.
 *
 * Management may author instructions with a card id. Before a match, the
 * management layer maps those keys to the runtime player's id (currently the
 * `home-${number}` / `away-${number}` id) when the two ids differ. The runtime
 * also accepts `short` and shirt-number keys as compatibility fallbacks.
 */
export type RuntimeTeamTactics = {
  defensiveLine: number;
  pressingIntensity: number;
  buildUpSpeed: number;
  passingStyle: RuntimePassingStyle;
  attackWidth: number;
  instructions: Record<string, RuntimePlayerInstruction>;
};

export type RuntimeTeamTacticsByTeam = Partial<Record<TeamId, RuntimeTeamTactics>>;

export const DEFAULT_RUNTIME_TEAM_TACTICS: Readonly<RuntimeTeamTactics> = {
  defensiveLine: 50,
  pressingIntensity: 50,
  buildUpSpeed: 50,
  passingStyle: "balanced",
  attackWidth: 50,
  instructions: {}
};

// These aliases make the contract easy to discover for callers that use the
// shorter names while keeping one canonical object and sanitizer.
export const DEFAULT_TACTICS = DEFAULT_RUNTIME_TEAM_TACTICS;
export const DEFAULT_RUNTIME_TACTICS = DEFAULT_RUNTIME_TEAM_TACTICS;

const INSTRUCTIONS = new Set<RuntimePlayerInstruction>(["balanced", "stayBack", "getForward", "freeRoam"]);
const PASSING_STYLES = new Set<RuntimePassingStyle>(["short", "balanced", "direct"]);

const clampPercent = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 100);
};

const validPassingStyle = (value: unknown, fallback: RuntimePassingStyle): RuntimePassingStyle =>
  typeof value === "string" && PASSING_STYLES.has(value as RuntimePassingStyle)
    ? value as RuntimePassingStyle
    : fallback;

/**
 * Clones and clamps untrusted editor data into a deterministic runtime value.
 * Invalid numeric values use the normal midpoint rather than leaking NaN or
 * Infinity into movement calculations. The input object is never mutated.
 */
export function sanitizeTactics(input?: Partial<RuntimeTeamTactics> | null | Record<string, unknown>): RuntimeTeamTactics {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rawInstructions = source.instructions;
  const instructions: Record<string, RuntimePlayerInstruction> = {};
  if (rawInstructions && typeof rawInstructions === "object" && !Array.isArray(rawInstructions)) {
    for (const key of Object.keys(rawInstructions).sort()) {
      const rawValue = (rawInstructions as Record<string, unknown>)[key];
      // Management's persisted TeamTactics uses `{ role }`, while the match
      // runtime uses the compact string form. Accept both at this boundary.
      const value = rawValue && typeof rawValue === "object"
        ? (rawValue as Record<string, unknown>).role
        : rawValue;
      instructions[key] = INSTRUCTIONS.has(value as RuntimePlayerInstruction)
        ? value as RuntimePlayerInstruction
        : "balanced";
    }
  }
  return {
    defensiveLine: clampPercent(source.defensiveLine, DEFAULT_RUNTIME_TEAM_TACTICS.defensiveLine),
    pressingIntensity: clampPercent(source.pressingIntensity, DEFAULT_RUNTIME_TEAM_TACTICS.pressingIntensity),
    buildUpSpeed: clampPercent(source.buildUpSpeed, DEFAULT_RUNTIME_TEAM_TACTICS.buildUpSpeed),
    passingStyle: validPassingStyle(source.passingStyle, DEFAULT_RUNTIME_TEAM_TACTICS.passingStyle),
    attackWidth: clampPercent(source.attackWidth, DEFAULT_RUNTIME_TEAM_TACTICS.attackWidth),
    instructions
  };
}

export const sanitizeRuntimeTactics = sanitizeTactics;

export type TacticalModifiers = {
  defensiveLine: number;
  pressingIntensity: number;
  buildUpSpeed: number;
  passingStyle: RuntimePassingStyle;
  attackWidth: number;
  /** Forward displacement in world units; positive means toward the attack. */
  lineDepthShift: number;
  /** Multiplier applied to the configured attacking/defensive width. */
  widthMultiplier: number;
  /** Multipliers used by spatial pressure selection. */
  pressureDistanceMultiplier: number;
  presserFraction: number;
  /** Multipliers used by support-run/pass-target generation. */
  supportForwardMultiplier: number;
  supportLateralMultiplier: number;
  passDistanceMultiplier: number;
  passProgressBias: number;
};

/**
 * Converts editor values to bounded, named runtime modifiers. Keeping these
 * formulas in one pure function makes the match behavior inspectable and
 * prevents tactics from accidentally changing player max speed.
 */
export function getTacticalModifiers(input?: Partial<RuntimeTeamTactics> | null | Record<string, unknown>): TacticalModifiers {
  const tactics = sanitizeTactics(input);
  const line = tactics.defensiveLine / 100;
  const pressing = tactics.pressingIntensity / 100;
  const buildUp = tactics.buildUpSpeed / 100;
  const width = tactics.attackWidth / 100;
  const styleForward = tactics.passingStyle === "short" ? 0.82 : tactics.passingStyle === "direct" ? 1.18 : 1;
  const styleLateral = tactics.passingStyle === "short" ? 1.15 : tactics.passingStyle === "direct" ? 0.86 : 1;
  const passDistance = tactics.passingStyle === "short" ? 0.78 : tactics.passingStyle === "direct" ? 1.32 : 1;
  const passProgressBias = tactics.passingStyle === "short" ? -0.18 : tactics.passingStyle === "direct" ? 0.24 : 0;
  return {
    defensiveLine: tactics.defensiveLine,
    pressingIntensity: tactics.pressingIntensity,
    buildUpSpeed: tactics.buildUpSpeed,
    passingStyle: tactics.passingStyle,
    attackWidth: tactics.attackWidth,
    lineDepthShift: (line - 0.5) * 14,
    widthMultiplier: 0.72 + width * 0.56,
    // Midpoint is intentionally neutral so a default/balanced tactics object
    // keeps the Phase 3 24-unit pressure radius. Extremes still visibly
    // change pressure coverage without changing player max speed.
    pressureDistanceMultiplier: 0.55 + pressing * 0.9,
    presserFraction: pressing,
    supportForwardMultiplier: (0.65 + buildUp * 0.7) * styleForward,
    supportLateralMultiplier: (0.9 + buildUp * 0.2) * styleLateral,
    passDistanceMultiplier: passDistance * (0.86 + buildUp * 0.28),
    passProgressBias
  };
}

/** Returns the bounded number of active press slots for a tactic profile. */
export function getTacticalPresserLimit(
  input?: Partial<RuntimeTeamTactics> | null | Record<string, unknown>,
  configuredMaxPressers = 2
): number {
  const intensity = sanitizeTactics(input).pressingIntensity;
  const configured = Math.min(2, Math.max(0, Math.floor(configuredMaxPressers)));
  if (intensity <= 0 || configured === 0) return 0;
  // 50 is the neutral editor midpoint and retains the legacy two-slot block;
  // only genuinely low intensity removes one of those slots.
  const requested = intensity < 50 ? 1 : 2;
  return Math.min(configured, requested);
}

/** Resolves either a single-team tactics object or a home/away map. */
export function resolveTeamTactics(
  input: RuntimeTeamTactics | RuntimeTeamTacticsByTeam | Partial<Record<TeamId, RuntimeTeamTactics>> | null | undefined,
  team: TeamId
): RuntimeTeamTactics | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = input as Record<string, unknown>;
  if ("defensiveLine" in candidate || "pressingIntensity" in candidate || "buildUpSpeed" in candidate || "passingStyle" in candidate || "attackWidth" in candidate || "instructions" in candidate) {
    return sanitizeTactics(candidate);
  }
  const teamValue = candidate[team];
  return teamValue && typeof teamValue === "object" ? sanitizeTactics(teamValue as Record<string, unknown>) : undefined;
}

export function getPlayerInstruction(
  tactics: RuntimeTeamTactics | Partial<RuntimeTeamTactics> | null | undefined,
  player: { id: string; short?: string; number?: number; role?: string }
): RuntimePlayerInstruction {
  if (!tactics) return "balanced";
  const resolved = sanitizeTactics(tactics);
  const instruction = resolved.instructions[player.id]
    ?? (player.short ? resolved.instructions[player.short] : undefined)
    ?? (player.number === undefined ? undefined : resolved.instructions[String(player.number)])
    ?? (player.role ? resolved.instructions[player.role] : undefined);
  return instruction ?? "balanced";
}

export type TacticalTargetOverrideArgs = {
  target: THREE.Vector3;
  playerId: string;
  short?: string;
  number?: number;
  role?: string;
  /** Formation/home x, used to choose a stable free-roam side. */
  homeX?: number;
  attackingDirection: number;
  tactics?: RuntimeTeamTactics | Partial<RuntimeTeamTactics> | null;
};

const stableSide = (id: string): number => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return hash % 2 === 0 ? 1 : -1;
};

/** Applies a player instruction to a target without mutating the input vector. */
export function getTacticalTargetOverride(args: TacticalTargetOverrideArgs): THREE.Vector3;
export function getTacticalTargetOverride(
  target: THREE.Vector3,
  player: { id: string; short?: string; number?: number; role?: string; home?: THREE.Vector3 },
  attackingDirection: number,
  tactics?: RuntimeTeamTactics | Partial<RuntimeTeamTactics> | null
): THREE.Vector3;
export function getTacticalTargetOverride(
  argsOrTarget: TacticalTargetOverrideArgs | THREE.Vector3,
  player?: { id: string; short?: string; number?: number; role?: string; home?: THREE.Vector3 },
  attackingDirection?: number,
  tactics?: RuntimeTeamTactics | Partial<RuntimeTeamTactics> | null
): THREE.Vector3 {
  const args: TacticalTargetOverrideArgs = argsOrTarget instanceof THREE.Vector3
    ? {
      target: argsOrTarget,
      playerId: player?.id ?? "",
      short: player?.short,
      number: player?.number,
      role: player?.role,
      homeX: player?.home?.x,
      attackingDirection: attackingDirection ?? 1,
      tactics
    }
    : argsOrTarget;
  const result = args.target.clone();
  if (!args.tactics || args.role === "GK") return result;
  const instruction = getPlayerInstruction(args.tactics, {
    id: args.playerId,
    short: args.short,
    number: args.number,
    role: args.role
  });
  const direction = args.attackingDirection < 0 ? -1 : 1;
  if (instruction === "stayBack") result.z -= direction * 6;
  if (instruction === "getForward") result.z += direction * 6;
  if (instruction === "freeRoam") {
    const homeSide = args.homeX === undefined ? stableSide(args.playerId) : Math.sign(args.homeX);
    const side = homeSide === 0 ? stableSide(args.playerId) : homeSide;
    result.x += side * 4;
    result.z += direction * 1.5;
  }
  return result;
}

// Friendly alias for call sites that prefer an imperative verb.
export const applyTacticalTargetOverride = getTacticalTargetOverride;
export const getTacticalTarget = getTacticalTargetOverride;
