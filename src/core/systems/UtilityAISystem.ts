import type { Role } from "../../data/types";
import {
  getAIDifficulty,
  sampleAIRange,
  type AIDifficultyConfig,
  type AIDifficultyLevel,
  type AIDifficultyOverrides
} from "./AIDifficulty";
import {
  AI_ACTIONS,
  type AIAction,
  type AIActionScore,
  type AIDecisionResult,
  type AIScoreReason,
  type TeamPossessionState
} from "./AIDecisionDebug";

export type UtilityAIStats = {
  passing: number;
  shooting: number;
  dribbling: number;
  defending: number;
};

/** Normalized observations are 0..1 unless a unit is noted explicitly. */
export type UtilityAIContext = {
  playerId: string;
  role: Role;
  possession: TeamPossessionState;
  nowMs?: number;
  distanceToGoal?: number;
  goalAngleQuality?: number;
  pressure?: number;
  passingLaneQuality?: number;
  passTargetOpen?: number;
  passProgress?: number;
  dribbleSpace?: number;
  dangerNearOwnGoal?: number;
  distanceToBall?: number;
  markThreat?: number;
  shapeError?: number;
  stamina?: number;
  scoreUrgency?: number;
  stats?: Partial<UtilityAIStats>;
  /** Remaining cooldown per action, in milliseconds. */
  actionCooldownsMs?: Partial<Record<AIAction, number>>;
  /** Team-level coordination can reserve actions such as press for selected players. */
  unavailableActions?: readonly AIAction[];
};

export type UtilityAIMemory = {
  lastAction: AIAction;
  nextDecisionAtMs: number;
};

export type UtilityAIOptions = {
  difficulty?: AIDifficultyLevel | AIDifficultyConfig;
  difficultyOverrides?: AIDifficultyOverrides;
  /** Return a value in [0, 1]. A constant midpoint is used by default for deterministic simulation. */
  random?: () => number;
  memory?: UtilityAIMemory;
};

type Observations = Required<Omit<UtilityAIContext, "playerId" | "role" | "possession" | "nowMs" | "stats" | "actionCooldownsMs" | "unavailableActions">> & UtilityAIStats;
type DraftScore = { action: AIAction; available: boolean; reasons: AIScoreReason[] };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const contribution = (factor: string, value: number, message: string): AIScoreReason => ({ factor, contribution: value, message });

function resolveDifficulty(options: UtilityAIOptions): AIDifficultyConfig {
  if (typeof options.difficulty === "object") return getAIDifficulty(options.difficulty.level, options.difficulty);
  return getAIDifficulty(options.difficulty ?? "normal", options.difficultyOverrides);
}

function observe(value: number, difficulty: AIDifficultyConfig, random: () => number): number {
  const perceived = 0.5 + (clamp01(value) - 0.5) * difficulty.perceptionAccuracy;
  const noise = (clamp01(random()) - 0.5) * (1 - difficulty.perceptionAccuracy) * 0.35;
  return clamp01(perceived + noise);
}

function observations(context: UtilityAIContext, difficulty: AIDifficultyConfig, random: () => number): Observations {
  const stats = { passing: 70, shooting: 70, dribbling: 70, defending: 70, ...context.stats };
  const distanceToGoal = Math.max(0, context.distanceToGoal ?? 55);
  return {
    distanceToGoal,
    goalAngleQuality: observe(context.goalAngleQuality ?? 0.5, difficulty, random),
    pressure: observe(context.pressure ?? 0.35, difficulty, random),
    passingLaneQuality: observe(context.passingLaneQuality ?? 0.5, difficulty, random),
    passTargetOpen: observe(context.passTargetOpen ?? 0.5, difficulty, random),
    passProgress: observe(context.passProgress ?? 0.5, difficulty, random),
    dribbleSpace: observe(context.dribbleSpace ?? 0.5, difficulty, random),
    dangerNearOwnGoal: observe(context.dangerNearOwnGoal ?? 0, difficulty, random),
    distanceToBall: Math.max(0, context.distanceToBall ?? 20),
    markThreat: observe(context.markThreat ?? 0.4, difficulty, random),
    shapeError: observe(context.shapeError ?? 0.25, difficulty, random),
    stamina: observe(context.stamina ?? 1, difficulty, random),
    scoreUrgency: observe((context.scoreUrgency ?? 0) * 0.5 + 0.5, difficulty, random) * 2 - 1,
    passing: clamp01(stats.passing / 100),
    shooting: clamp01(stats.shooting / 100),
    dribbling: clamp01(stats.dribbling / 100),
    defending: clamp01(stats.defending / 100)
  };
}

function scoreAttack(action: AIAction, context: UtilityAIContext, o: Observations, d: AIDifficultyConfig): DraftScore {
  const hasBall = context.possession === "self";
  const reasons: AIScoreReason[] = [];
  if (!hasBall) return { action, available: false, reasons: [contribution("possession", -1, "player does not have the ball")] };

  if (action === "pass") {
    reasons.push(
      contribution("lane", o.passingLaneQuality * 0.3 * d.passVision, "passing lane quality"),
      contribution("target", o.passTargetOpen * 0.22 * d.passVision, "target is available"),
      contribution("progress", o.passProgress * 0.13, "pass advances the attack"),
      contribution("pressure", o.pressure * 0.14, "passing relieves pressure"),
      contribution("skill", o.passing * 0.11, "passing ability")
    );
  } else if (action === "shoot") {
    const proximity = clamp01(1 - o.distanceToGoal / 44);
    const badShotPenalty = (1 - d.shotPatience) * (1 - proximity) * 0.22;
    reasons.push(
      contribution("distance", proximity * 0.43, "distance to goal"),
      contribution("angle", o.goalAngleQuality * 0.25, "view of goal"),
      contribution("skill", o.shooting * 0.17, "shooting ability"),
      contribution("pressure", -o.pressure * 0.12, "pressure reduces shot quality"),
      contribution("patience", -badShotPenalty, "difficulty shot-selection discipline"),
      contribution("urgency", Math.max(0, o.scoreUrgency) * 0.08, "scoreline urgency")
    );
  } else if (action === "dribble") {
    reasons.push(
      contribution("space", o.dribbleSpace * 0.38, "space to carry the ball"),
      contribution("skill", o.dribbling * 0.2, "dribbling ability"),
      contribution("confidence", d.dribbleConfidence * 0.09, "difficulty risk profile"),
      contribution("pressure", -o.pressure * 0.2, "pressure raises turnover risk"),
      contribution("lane", (1 - o.passingLaneQuality) * 0.1, "few passing options")
    );
  } else {
    const roleBonus = context.role === "GK" || context.role === "DEF" ? 0.12 : 0;
    reasons.push(
      contribution("danger", o.dangerNearOwnGoal * 0.55, "danger near own goal"),
      contribution("pressure", o.pressure * 0.22, "immediate pressure"),
      contribution("role", roleBonus, "defensive role"),
      contribution("composure", -(1 - d.clearanceComposure) * (1 - o.dangerNearOwnGoal) * 0.16, "premature clearance risk"),
      contribution("outlet", -o.passingLaneQuality * 0.12, "safe passing outlet exists")
    );
  }
  return { action, available: true, reasons };
}

function scoreDefence(action: AIAction, context: UtilityAIContext, o: Observations, d: AIDifficultyConfig): DraftScore {
  const defending = context.possession === "opponent" || context.possession === "loose";
  const reasons: AIScoreReason[] = [];
  if (!defending) return { action, available: false, reasons: [contribution("possession", -1, "team is not defending")] };
  const ballProximity = clamp01(1 - o.distanceToBall / 24);
  if (action === "press") {
    reasons.push(
      contribution("ball-distance", ballProximity * 0.42, "close enough to pressure the ball"),
      contribution("danger", o.dangerNearOwnGoal * 0.16, "ball is in a dangerous area"),
      contribution("aggression", d.pressAggression * 0.14, "difficulty press aggression"),
      contribution("stamina", o.stamina * 0.09, "energy to press"),
      contribution("shape", -o.shapeError * 0.15, "press may break team shape")
    );
  } else {
    reasons.push(
      contribution("threat", o.markThreat * 0.42, "assigned opponent is threatening"),
      contribution("discipline", d.markDiscipline * 0.18, "difficulty marking discipline"),
      contribution("cover", (1 - ballProximity) * 0.12, "better placed to cover than press"),
      contribution("shape", o.shapeError * 0.1, "recover defensive shape")
    );
  }
  return { action, available: true, reasons };
}

function makeDrafts(context: UtilityAIContext, o: Observations, d: AIDifficultyConfig): DraftScore[] {
  const drafts = AI_ACTIONS.map((action): DraftScore => {
    if (action === "pass" || action === "shoot" || action === "dribble" || action === "clear") return scoreAttack(action, context, o, d);
    if (action === "press" || action === "mark") return scoreDefence(action, context, o, d);
    const calm = context.possession === "self" ? 0.08 : context.possession === "team" ? 0.28 : 0.2;
    return {
      action,
      available: true,
      reasons: [
        contribution("shape", (1 - o.shapeError) * 0.18, "position already supports team shape"),
        contribution("patience", calm, "holding preserves structure")
      ]
    };
  });
  return drafts;
}

function finalizeScore(
  draft: DraftScore,
  context: UtilityAIContext,
  difficulty: AIDifficultyConfig,
  random: () => number
): AIActionScore {
  const baseScore = clamp01(0.06 + draft.reasons.reduce((sum, reason) => sum + reason.contribution, 0));
  const cooldownRemainingMs = Math.max(0, context.actionCooldownsMs?.[draft.action] ?? 0);
  const available = draft.available && cooldownRemainingMs <= 0 && !context.unavailableActions?.includes(draft.action);
  const noise = (clamp01(random()) - 0.5) * 2 * difficulty.scoreNoise;
  return {
    action: draft.action,
    baseScore,
    score: available ? clamp01(baseScore + noise) : 0,
    available,
    cooldownRemainingMs,
    reasons: draft.reasons
  };
}

function reasonFor(score: AIActionScore): string {
  const strongest = [...score.reasons].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))[0];
  return strongest?.message ?? "no action had a strong advantage";
}

function deferredDecision(context: UtilityAIContext, options: UtilityAIOptions, d: AIDifficultyConfig): AIDecisionResult | null {
  const nowMs = context.nowMs ?? 0;
  if (!options.memory || nowMs >= options.memory.nextDecisionAtMs) return null;
  const remaining = options.memory.nextDecisionAtMs - nowMs;
  return {
    playerId: context.playerId,
    timestampMs: nowMs,
    difficulty: d.level,
    possession: context.possession,
    action: options.memory.lastAction,
    score: 0,
    scores: [],
    reason: `waiting ${Math.ceil(remaining)}ms before reassessing`,
    mistakeApplied: false,
    deferred: true,
    reactionDelayMs: remaining,
    executeAtMs: nowMs,
    cooldownMs: remaining,
    nextDecisionAtMs: options.memory.nextDecisionAtMs
  };
}

/**
 * Scores every football action and returns an inspectable decision. The
 * function is data-only and deterministic when supplied the same context/RNG.
 */
export function decideUtilityAI(context: UtilityAIContext, options: UtilityAIOptions = {}): AIDecisionResult {
  const difficulty = resolveDifficulty(options);
  const waiting = deferredDecision(context, options, difficulty);
  if (waiting) return waiting;
  const random = options.random ?? (() => 0.5);
  const nowMs = context.nowMs ?? 0;
  const o = observations(context, difficulty, random);
  const scores = makeDrafts(context, o, difficulty)
    .map((draft) => finalizeScore(draft, context, difficulty, random))
    .sort((a, b) => b.score - a.score || AI_ACTIONS.indexOf(a.action) - AI_ACTIONS.indexOf(b.action));
  const available = scores.filter((score) => score.available);
  let selected = available[0] ?? scores.find((score) => score.action === "hold")!;
  let mistakeApplied = false;

  if (available.length > 1 && random() < difficulty.mistakeChance) {
    const candidates = available.filter((candidate) => candidate !== selected && candidate.score >= selected.score - difficulty.mistakeSeverity);
    if (candidates.length > 0) {
      const index = Math.min(candidates.length - 1, Math.floor(clamp01(random()) * candidates.length));
      selected = candidates[index];
      mistakeApplied = true;
    }
  }

  const reactionDelayMs = sampleAIRange(difficulty.reactionDelayMs, random);
  const cooldownMs = sampleAIRange(difficulty.decisionCooldownMs, random);
  return {
    playerId: context.playerId,
    timestampMs: nowMs,
    difficulty: difficulty.level,
    possession: context.possession,
    action: selected.action,
    score: selected.score,
    scores,
    reason: reasonFor(selected),
    mistakeApplied,
    deferred: false,
    reactionDelayMs,
    executeAtMs: nowMs + reactionDelayMs,
    cooldownMs,
    nextDecisionAtMs: nowMs + reactionDelayMs + cooldownMs
  };
}

export function memoryFromDecision(decision: AIDecisionResult): UtilityAIMemory {
  return { lastAction: decision.action, nextDecisionAtMs: decision.nextDecisionAtMs };
}

export const decideAIAction = decideUtilityAI;

export class UtilityAISystem {
  constructor(private readonly options: Omit<UtilityAIOptions, "memory"> = {}) {}

  decide(context: UtilityAIContext, memory?: UtilityAIMemory): AIDecisionResult {
    return decideUtilityAI(context, { ...this.options, memory });
  }
}
