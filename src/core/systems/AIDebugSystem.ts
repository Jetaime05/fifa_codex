import type { TeamId } from "../../data/types";
import type { SimBall, SimPlayer, SimPlayerIntent } from "./types";
import type { KeeperBrainSnapshot } from "./GoalkeeperSystem";
import { formatAIDecisionLabel, type AIDecisionResult } from "./AIDecisionDebug";

export type AIDebugVector = { x: number; y: number; z: number };

export type AIDecisionDebug = {
  playerId: string;
  team: TeamId;
  role: SimPlayer["role"];
  intent: SimPlayerIntent;
  label: string;
  reason: string;
  target?: AIDebugVector;
  scores?: Readonly<Record<string, number>>;
  cooldown: number;
  utility?: {
    action: AIDecisionResult["action"];
    score: number;
    difficulty: AIDecisionResult["difficulty"];
    deferred: boolean;
    mistakeApplied: boolean;
    executeAtMs: number;
  };
};

export type AIDecisionUpdate = {
  player: SimPlayer;
  label?: string;
  reason?: string;
  target?: { x: number; y: number; z: number };
  scores?: Readonly<Record<string, number>>;
};

export type AIDebugSnapshot = {
  enabled: boolean;
  frame: number;
  elapsed: number;
  possession: TeamId | "loose";
  ball: { position: AIDebugVector; speed: number; ownerId: string | null };
  decisions: AIDecisionDebug[];
  keepers: KeeperBrainSnapshot[];
};

const INTENT_LABELS: Record<SimPlayerIntent, string> = {
  hold: "Hold shape",
  chase: "Press ball",
  support: "Offer support",
  return: "Recover shape",
  keeper: "Protect goal"
};

const vector = ({ x, y, z }: { x: number; y: number; z: number }): AIDebugVector => ({ x, y, z });

export function getAIIntentLabel(intent: SimPlayerIntent) {
  return INTENT_LABELS[intent];
}

function normalizeScores(scores?: Readonly<Record<string, number>>) {
  if (!scores) return undefined;
  return Object.keys(scores).sort().reduce<Record<string, number>>((result, key) => {
    result[key] = scores[key];
    return result;
  }, {});
}

export function createAIDecisionDebug({ player, label, reason, target, scores }: AIDecisionUpdate): AIDecisionDebug {
  const result: AIDecisionDebug = {
    playerId: player.id,
    team: player.team,
    role: player.role,
    intent: player.intent,
    label: label ?? getAIIntentLabel(player.intent),
    reason: reason ?? `Current intent: ${getAIIntentLabel(player.intent)}.`,
    cooldown: player.cooldown
  };
  if (target) result.target = vector(target);
  const normalizedScores = normalizeScores(scores);
  if (normalizedScores) result.scores = normalizedScores;
  return result;
}

export function createUtilityDecisionDebug(
  player: SimPlayer,
  decision: AIDecisionResult,
  target?: { x: number; y: number; z: number },
  movementReason?: string
): AIDecisionDebug {
  const scores = decision.scores.reduce<Record<string, number>>((result, score) => {
    result[score.action] = score.score;
    return result;
  }, {});
  return {
    ...createAIDecisionDebug({
      player,
      label: formatAIDecisionLabel(decision),
      reason: movementReason ? `${decision.reason}; movement: ${movementReason}` : decision.reason,
      target,
      scores
    }),
    utility: {
      action: decision.action,
      score: decision.score,
      difficulty: decision.difficulty,
      deferred: decision.deferred,
      mistakeApplied: decision.mistakeApplied,
      executeAtMs: decision.executeAtMs
    }
  };
}

export function createAIDebugSnapshot({
  enabled = true,
  frame = 0,
  elapsed = 0,
  players,
  ball,
  ballOwner = null,
  decisions = [],
  utilityDecisions = [],
  keepers = []
}: {
  enabled?: boolean;
  frame?: number;
  elapsed?: number;
  players: SimPlayer[];
  ball: SimBall;
  ballOwner?: SimPlayer | null;
  decisions?: AIDecisionDebug[];
  utilityDecisions?: AIDecisionResult[];
  keepers?: KeeperBrainSnapshot[];
}): AIDebugSnapshot {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const utilityDebug = utilityDecisions.flatMap((decision) => {
    const player = playersById.get(decision.playerId);
    return player ? [createUtilityDecisionDebug(player, decision)] : [];
  });
  const overrides = new Map([...decisions, ...utilityDebug].map((decision) => [decision.playerId, decision]));
  const normalizedDecisions = players.map((player) => {
    const override = overrides.get(player.id);
    return override ? {
      ...override,
      target: override.target ? vector(override.target) : undefined,
      scores: normalizeScores(override.scores)
    } : createAIDecisionDebug({ player });
  }).sort((a, b) => a.team.localeCompare(b.team) || a.playerId.localeCompare(b.playerId));

  return {
    enabled,
    frame: Math.max(0, Math.floor(frame)),
    elapsed: Math.max(0, elapsed),
    possession: ballOwner?.team ?? "loose",
    ball: {
      position: vector(ball.position),
      speed: ball.velocity.length(),
      ownerId: ballOwner?.id ?? null
    },
    decisions: normalizedDecisions,
    keepers: [...keepers].sort((a, b) => a.keeperId.localeCompare(b.keeperId)).map((keeper) => ({
      ...keeper,
      position: keeper.position ? { ...keeper.position, target: { ...keeper.position.target } } : undefined,
      reaction: keeper.reaction ? { ...keeper.reaction } : undefined,
      distribution: keeper.distribution ? { ...keeper.distribution } : undefined
    }))
  };
}

/**
 * Small telemetry store for an optional debug overlay. It never participates
 * in decisions, so turning it on cannot alter deterministic match behaviour.
 */
export class AIDebugSystem {
  enabled: boolean;
  private decisions = new Map<string, AIDecisionDebug>();
  private keepers = new Map<string, KeeperBrainSnapshot>();

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  recordDecision(update: AIDecisionUpdate) {
    const decision = createAIDecisionDebug(update);
    this.decisions.set(decision.playerId, decision);
    return decision;
  }

  recordUtilityDecision(
    player: SimPlayer,
    decision: AIDecisionResult,
    target?: { x: number; y: number; z: number },
    movementReason?: string
  ) {
    const debug = createUtilityDecisionDebug(player, decision, target, movementReason);
    this.decisions.set(debug.playerId, debug);
    return debug;
  }

  recordKeeper(snapshot: KeeperBrainSnapshot) {
    this.keepers.set(snapshot.keeperId, snapshot);
    return snapshot;
  }

  clear() {
    this.decisions.clear();
    this.keepers.clear();
  }

  snapshot(input: {
    players: SimPlayer[];
    ball: SimBall;
    ballOwner?: SimPlayer | null;
    frame?: number;
    elapsed?: number;
  }) {
    return createAIDebugSnapshot({
      ...input,
      enabled: this.enabled,
      decisions: [...this.decisions.values()],
      keepers: [...this.keepers.values()]
    });
  }
}
