import type { AIDifficultyLevel } from "./AIDifficulty";

export const AI_ACTIONS = ["pass", "shoot", "dribble", "clear", "press", "mark", "hold"] as const;
export type AIAction = (typeof AI_ACTIONS)[number];
export type TeamPossessionState = "self" | "team" | "opponent" | "loose";

export type AIScoreReason = {
  factor: string;
  contribution: number;
  message: string;
};

export type AIActionScore = {
  action: AIAction;
  baseScore: number;
  score: number;
  available: boolean;
  cooldownRemainingMs: number;
  reasons: AIScoreReason[];
};

export type AIDecisionResult = {
  playerId: string;
  timestampMs: number;
  difficulty: AIDifficultyLevel;
  possession: TeamPossessionState;
  action: AIAction;
  score: number;
  scores: AIActionScore[];
  reason: string;
  mistakeApplied: boolean;
  deferred: boolean;
  reactionDelayMs: number;
  /** Earliest simulation time at which the newly selected action should execute. */
  executeAtMs: number;
  cooldownMs: number;
  nextDecisionAtMs: number;
};

export function formatAIDecisionLabel(decision: AIDecisionResult): string {
  const suffix = decision.mistakeApplied ? " mistake" : decision.deferred ? " waiting" : "";
  return `${decision.playerId}: ${decision.action.toUpperCase()} ${(decision.score * 100).toFixed(0)}% - ${decision.reason}${suffix}`;
}

/** Small renderer-agnostic store that an optional overlay can read. */
export class AIDecisionDebugStore {
  private readonly decisions = new Map<string, AIDecisionResult>();

  constructor(public enabled = false) {}

  record(decision: AIDecisionResult): void {
    if (this.enabled) this.decisions.set(decision.playerId, decision);
  }

  get(playerId: string): AIDecisionResult | undefined {
    return this.decisions.get(playerId);
  }

  list(): AIDecisionResult[] {
    return [...this.decisions.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
  }

  labels(): string[] {
    return this.list().map(formatAIDecisionLabel);
  }

  clear(): void {
    this.decisions.clear();
  }
}
