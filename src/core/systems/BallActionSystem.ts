import {
  DEFAULT_BALL_ACTION_TIMING_CONFIG,
  type BallActionTimingConfig
} from "./GameplayConfig";

export type BallActionKind =
  | "pass"
  | "shot"
  | "cross"
  | "clearance"
  | "touch"
  | "header"
  | "volley";

export type BallActionPhase = "prepare" | "contact" | "recovery" | "cancel";

export type BallActionTiming = {
  /** Offset from queueing at which preparation starts (normally zero). */
  prepare: number;
  /** Offset from queueing at which the physical ball contact occurs. */
  contact: number;
  /** Offset from queueing at which the recovery pose ends. */
  recovery: number;
};

export type BallActionPayload = Readonly<Record<string, string | number | boolean>>;

export type QueueBallActionInput = {
  ownerId: string;
  kind: BallActionKind;
  now: number;
  timing?: Partial<BallActionTiming>;
  payload?: BallActionPayload;
};

export type BallAction = {
  id: number;
  ownerId: string;
  kind: BallActionKind;
  queuedAt: number;
  timing: BallActionTiming;
  payload?: BallActionPayload;
};

export type BallActionEvent = {
  action: BallAction;
  phase: BallActionPhase;
  timestamp: number;
  reason?: "ownership-lost" | "replaced" | "cancelled";
};

export type BallActionSystemOptions = {
  timing?: Partial<BallActionTimingConfig>;
  maxQueuedPerOwner?: number;
};

const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

const normalizeTiming = (
  timing: Partial<BallActionTiming> | undefined,
  fallback: BallActionTiming
): BallActionTiming => {
  const prepare = Math.max(0, finite(timing?.prepare ?? fallback.prepare, fallback.prepare));
  const contact = Math.max(prepare, finite(timing?.contact ?? fallback.contact, fallback.contact));
  const recovery = Math.max(contact, finite(timing?.recovery ?? fallback.recovery, fallback.recovery));
  return { prepare, contact, recovery };
};

const toOffsets = (prepareDuration: number, contactDuration: number, recoveryDuration: number): BallActionTiming => {
  const prepare = 0;
  const contact = prepare + Math.max(0, finite(contactDuration, 0));
  const recovery = contact + Math.max(0, finite(recoveryDuration, 0));
  return { prepare, contact, recovery };
};

const actionTiming = (
  kind: BallActionKind,
  config: BallActionTimingConfig
): BallActionTiming => {
  if (kind === "pass" || kind === "cross" || kind === "clearance") {
    return toOffsets(config.passPrepare, config.passContact, config.passRecovery);
  }
  if (kind === "shot" || kind === "volley") {
    return toOffsets(config.shotPrepare, config.shotContact, config.shotRecovery);
  }
  if (kind === "header") {
    return toOffsets(config.aerialPrepare, config.aerialContact, config.aerialRecovery);
  }
  return toOffsets(0, 0, config.touchRecovery);
};

/**
 * Returns the default relative phase times for a ball action. Plans expose
 * this value so an orchestrator can queue the action and apply its physical
 * impulse exactly at `contact`.
 */
export function getBallActionTiming(
  kind: BallActionKind,
  overrides: Partial<BallActionTimingConfig> = {}
): BallActionTiming {
  return actionTiming(kind, { ...DEFAULT_BALL_ACTION_TIMING_CONFIG, ...overrides });
}

/**
 * Queues simulation-owned action phases. The class never mutates a player or
 * ball; consumers apply the planned impulse when a contact event is emitted.
 * This makes animation/audio subscribers deterministic and lets an ownership
 * change cancel an action before it can kick a ball for the wrong player.
 */
export class BallActionSystem {
  private readonly config: BallActionTimingConfig;
  private readonly maxQueuedPerOwner: number;
  private readonly actions = new Map<number, { action: BallAction; emitted: Set<Exclude<BallActionPhase, "cancel">> }>();
  private readonly pendingEvents: BallActionEvent[] = [];
  private nextId = 1;

  constructor(options: BallActionSystemOptions = {}) {
    this.config = { ...DEFAULT_BALL_ACTION_TIMING_CONFIG, ...options.timing };
    this.maxQueuedPerOwner = Math.max(1, Math.floor(options.maxQueuedPerOwner ?? 1));
  }

  queue(input: QueueBallActionInput): BallAction {
    const now = finite(input.now, 0);
    const existing = [...this.actions.values()].filter((entry) => entry.action.ownerId === input.ownerId);
    if (existing.length >= this.maxQueuedPerOwner) {
      existing.sort((a, b) => a.action.id - b.action.id);
      const cancelled = this.cancel(existing[0].action.id, "replaced", now);
      if (cancelled) this.pendingEvents.push(cancelled);
    }
    const fallback = actionTiming(input.kind, this.config);
    const action: BallAction = {
      id: this.nextId++, ownerId: input.ownerId, kind: input.kind,
      queuedAt: now, timing: normalizeTiming(input.timing, fallback), payload: input.payload
    };
    this.actions.set(action.id, { action, emitted: new Set() });
    return action;
  }

  /** Cancel one queued action before its contact, usually after a lost duel. */
  cancel(id: number, reason: BallActionEvent["reason"] = "cancelled", timestamp?: number): BallActionEvent | null {
    const entry = this.actions.get(id);
    if (!entry) return null;
    this.actions.delete(id);
    return { action: entry.action, phase: "cancel", timestamp: timestamp ?? entry.action.queuedAt, reason };
  }

  /** Cancels every pending action owned by a player and returns cancellation events. */
  cancelOwner(ownerId: string, reason: BallActionEvent["reason"] = "ownership-lost") {
    const events: BallActionEvent[] = [];
    for (const [id, entry] of this.actions) {
      if (entry.action.ownerId !== ownerId) continue;
      const event = this.cancel(id, reason);
      if (event) events.push(event);
    }
    return events;
  }

  /**
   * Advances the queue to a simulation timestamp. Each phase is emitted once,
   * in action-id/phase order, even if a frame crosses multiple timestamps.
   */
  advance(now: number): BallActionEvent[] {
    const timestamp = finite(now, 0);
    const events: BallActionEvent[] = this.pendingEvents.splice(0);
    for (const entry of this.actions.values()) {
      const { action, emitted } = entry;
      const phases: Array<[Exclude<BallActionPhase, "cancel">, number]> = [
        ["prepare", action.queuedAt + action.timing.prepare],
        ["contact", action.queuedAt + action.timing.contact],
        ["recovery", action.queuedAt + action.timing.recovery]
      ];
      for (const [phase, phaseTime] of phases) {
        if (emitted.has(phase) || timestamp < phaseTime) continue;
        emitted.add(phase);
        events.push({ action, phase, timestamp: phaseTime });
      }
    }
    const phaseOrder: Record<BallActionPhase, number> = { cancel: 0, prepare: 1, contact: 2, recovery: 3 };
    events.sort((a, b) => a.timestamp - b.timestamp || a.action.id - b.action.id || phaseOrder[a.phase] - phaseOrder[b.phase]);
    for (const event of events) {
      if (event.phase === "recovery") this.actions.delete(event.action.id);
    }
    return events;
  }

  get activeCount() { return this.actions.size; }

  getActive(ownerId?: string) {
    return [...this.actions.values()]
      .map((entry) => entry.action)
      .filter((action) => ownerId === undefined || action.ownerId === ownerId)
      .sort((a, b) => a.id - b.id);
  }

  reset() {
    this.actions.clear();
    this.pendingEvents.length = 0;
    this.nextId = 1;
  }
}
