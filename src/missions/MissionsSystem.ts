import { DEFAULT_MISSION_DEFINITIONS } from "./definitions";
import {
  MISSION_STATE_VERSION,
  type MatchCompletedEvent,
  type MatchOutcome,
  type MissionClaimOptions,
  type MissionClaimResult,
  type MissionDefinition,
  type MissionEvent,
  type MissionEventResult,
  type MissionListOptions,
  type MissionMetric,
  type MissionPeriodInput,
  type MissionPeriodKeys,
  type MissionProgress,
  type MissionReward,
  type MissionScope,
  type MissionState,
  type MissionSystemOptions
} from "./types";

const MISSION_SCOPES: readonly MissionScope[] = ["daily", "weekly", "match"];
const MISSION_METRICS: readonly MissionMetric[] = [
  "matchesPlayed",
  "wins",
  "draws",
  "losses",
  "goals",
  "shots",
  "completedPasses",
  "tackles"
];
const OUTCOMES: readonly MatchOutcome[] = ["win", "draw", "loss"];
const EMPTY_PERIOD_KEYS: MissionPeriodKeys = { dayKey: "", weekKey: "" };

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const nonNegativeInteger = (value: unknown, fallback = 0): number =>
  finiteNumber(value) ? Math.max(0, Math.floor(value)) : fallback;

const positiveInteger = (value: unknown): number | null => {
  if (!finiteNumber(value)) return null;
  const result = Math.floor(value);
  return result > 0 ? result : null;
};

const cleanKey = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const cleanId = (value: unknown): string => cleanKey(value);

const cloneReward = (reward: MissionReward): MissionReward => ({
  coins: reward.coins,
  xp: reward.xp
});

const cloneDefinition = (definition: MissionDefinition): MissionDefinition => ({
  ...definition,
  reward: cloneReward(definition.reward)
});

const cloneProgress = (progress: MissionProgress): MissionProgress => ({
  ...progress,
  reward: cloneReward(progress.reward)
});

const cloneState = (state: MissionState): MissionState => ({
  version: MISSION_STATE_VERSION,
  dayKey: state.dayKey,
  weekKey: state.weekKey,
  missions: state.missions.map(cloneProgress),
  processedMatchIds: [...state.processedMatchIds]
});

/**
 * Resolve either the canonical dayKey/weekKey names or the dailyKey/weeklyKey
 * aliases. Empty keys are allowed while a caller is bootstrapping; no mission
 * instance is created for an empty period.
 */
export function normalizeMissionPeriodKeys(
  input?: MissionPeriodInput,
  fallback: MissionPeriodKeys = EMPTY_PERIOD_KEYS
): MissionPeriodKeys {
  const source = input ?? {};
  const day = cleanKey(source.dayKey, cleanKey(source.dailyKey, fallback.dayKey));
  const week = cleanKey(source.weekKey, cleanKey(source.weeklyKey, fallback.weekKey));
  return { dayKey: day, weekKey: week };
}

const sanitizeReward = (value: unknown): MissionReward => {
  const source = isRecord(value) ? value : {};
  return {
    coins: nonNegativeInteger(source.coins),
    xp: nonNegativeInteger(source.xp)
  };
};

/** Return a safe, normalized definition or null for malformed input. */
export function normalizeMissionDefinition(value: unknown): MissionDefinition | null {
  if (!isRecord(value)) return null;
  const id = cleanId(value.id);
  const scope = MISSION_SCOPES.includes(value.scope as MissionScope) ? value.scope as MissionScope : null;
  const metric = MISSION_METRICS.includes(value.metric as MissionMetric) ? value.metric as MissionMetric : null;
  const target = positiveInteger(value.target);
  if (!id || !scope || !metric || target === null) return null;

  const modeId = cleanKey(value.modeId);
  const outcome = OUTCOMES.includes(value.outcome as MatchOutcome) ? value.outcome as MatchOutcome : null;
  return {
    id,
    scope,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : id,
    description: typeof value.description === "string" ? value.description.trim() : "",
    metric,
    target,
    reward: sanitizeReward(value.reward),
    ...(modeId ? { modeId } : {}),
    ...(outcome ? { outcome } : {})
  };
}

/**
 * Normalize definitions in their supplied order and drop duplicate ids. The
 * first definition wins, which keeps a save/UI deterministic if content was
 * accidentally concatenated twice.
 */
export function normalizeMissionDefinitions(
  definitions: readonly MissionDefinition[] = DEFAULT_MISSION_DEFINITIONS
): MissionDefinition[] {
  const seen = new Set<string>();
  const normalized: MissionDefinition[] = [];
  for (const definition of definitions) {
    const clean = normalizeMissionDefinition(definition);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    normalized.push(clean);
  }
  return normalized;
}

export function createMissionState(periodKeys?: MissionPeriodInput): MissionState {
  const keys = normalizeMissionPeriodKeys(periodKeys);
  return {
    version: MISSION_STATE_VERSION,
    dayKey: keys.dayKey,
    weekKey: keys.weekKey,
    missions: [],
    processedMatchIds: []
  };
}

/** Alias used by integrations that call all domain constructors “initial”. */
export const createInitialMissionState = createMissionState;

export const missionInstanceId = (
  definition: Pick<MissionDefinition, "id" | "scope">,
  periodKey: string
): string => `${definition.scope}:${definition.id}:${periodKey}`;

export const matchMissionInstanceId = (definition: Pick<MissionDefinition, "id">, matchId: string): string =>
  `match:${definition.id}:${matchId}`;

export const missionClaimId = (instanceId: string): string => `${instanceId}:claim`;

const normalizeProgress = (value: unknown): MissionProgress | null => {
  if (!isRecord(value)) return null;
  const instanceId = cleanId(value.instanceId);
  const missionId = cleanId(value.missionId);
  const scope = MISSION_SCOPES.includes(value.scope as MissionScope) ? value.scope as MissionScope : null;
  const metric = MISSION_METRICS.includes(value.metric as MissionMetric) ? value.metric as MissionMetric : null;
  const target = positiveInteger(value.target);
  const periodKey = cleanKey(value.periodKey);
  if (!instanceId || !missionId || !scope || !metric || target === null || !periodKey) return null;

  const progress = Math.min(target, nonNegativeInteger(value.progress));
  const completed = Boolean(value.completed) || progress >= target;
  const claimed = Boolean(value.claimed);
  const suppliedClaimId = cleanKey(value.claimId);
  const claimId = suppliedClaimId || (claimed ? missionClaimId(instanceId) : null);
  const modeId = cleanKey(value.modeId);
  const outcome = OUTCOMES.includes(value.outcome as MatchOutcome) ? value.outcome as MatchOutcome : null;
  const timestamp = (candidate: unknown): number | null => finiteNumber(candidate) ? candidate : null;
  return {
    instanceId,
    missionId,
    scope,
    periodKey,
    matchId: cleanKey(value.matchId) || null,
    title: typeof value.title === "string" ? value.title : missionId,
    description: typeof value.description === "string" ? value.description : "",
    metric,
    target,
    progress,
    completed,
    claimed,
    claimId,
    reward: sanitizeReward(value.reward),
    modeId: modeId || null,
    outcome,
    lastUpdatedAt: timestamp(value.lastUpdatedAt),
    completedAt: timestamp(value.completedAt),
    claimedAt: timestamp(value.claimedAt)
  };
};

/**
 * Parse and migrate a JSON-safe state. Unknown future versions are rejected so
 * callers cannot silently reinterpret a newer save. Missing version is treated
 * as the original unversioned shape and migrated to version 1.
 */
export function deserializeMissionState(
  value: unknown,
  fallbackPeriodKeys?: MissionPeriodInput
): MissionState | null {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  const version = parsed.version === undefined ? 0 : parsed.version;
  if (!finiteNumber(version) || version > MISSION_STATE_VERSION) return null;

  const fallback = normalizeMissionPeriodKeys(fallbackPeriodKeys);
  const dayKey = cleanKey(parsed.dayKey, cleanKey(parsed.dailyKey, fallback.dayKey));
  const weekKey = cleanKey(parsed.weekKey, cleanKey(parsed.weeklyKey, fallback.weekKey));
  const rawMissions = Array.isArray(parsed.missions)
    ? parsed.missions
    : Array.isArray(parsed.progress)
      ? parsed.progress
      : [];
  const missions: MissionProgress[] = [];
  const seenMissionIds = new Set<string>();
  for (const raw of rawMissions) {
    const clean = normalizeProgress(raw);
    if (!clean || seenMissionIds.has(clean.instanceId)) continue;
    seenMissionIds.add(clean.instanceId);
    missions.push(clean);
  }
  const processedMatchIds: string[] = [];
  const seenMatchIds = new Set<string>();
  const rawMatchIds = Array.isArray(parsed.processedMatchIds) ? parsed.processedMatchIds : [];
  for (const rawId of rawMatchIds) {
    const matchId = cleanId(rawId);
    if (matchId && !seenMatchIds.has(matchId)) {
      seenMatchIds.add(matchId);
      processedMatchIds.push(matchId);
    }
  }
  return {
    version: MISSION_STATE_VERSION,
    dayKey,
    weekKey,
    missions,
    processedMatchIds
  };
}

/** Serialize a normalized detached snapshot, safe for localStorage/JSON. */
export function serializeMissionState(state: MissionState): string {
  const normalized = deserializeMissionState(state) ?? createMissionState();
  return JSON.stringify(normalized);
}

const progressFromDefinition = (
  definition: MissionDefinition,
  periodKey: string,
  matchId: string | null = null
): MissionProgress => ({
  instanceId: definition.scope === "match"
    ? matchMissionInstanceId(definition, matchId ?? periodKey)
    : missionInstanceId(definition, periodKey),
  missionId: definition.id,
  scope: definition.scope,
  periodKey,
  matchId,
  title: definition.title,
  description: definition.description ?? "",
  metric: definition.metric,
  target: definition.target,
  progress: 0,
  completed: false,
  claimed: false,
  claimId: null,
  reward: cloneReward(definition.reward),
  modeId: definition.modeId ?? null,
  outcome: definition.outcome ?? null,
  lastUpdatedAt: null,
  completedAt: null,
  claimedAt: null
});

const addProgressIfMissing = (state: MissionState, progress: MissionProgress): MissionProgress => {
  const existing = state.missions.find((candidate) => candidate.instanceId === progress.instanceId);
  if (existing) return existing;
  state.missions.push(progress);
  return progress;
};

/**
 * Ensure daily and weekly instances exist for the caller's supplied period.
 * Older instances remain in the serializable history so a claimed reward and
 * its transaction id remain auditable after rollover.
 */
export function ensureMissionPeriods(
  state: MissionState,
  definitions: readonly MissionDefinition[] = DEFAULT_MISSION_DEFINITIONS,
  periodKeys?: MissionPeriodInput
): MissionState {
  const next = deserializeMissionState(state) ?? createMissionState();
  const keys = normalizeMissionPeriodKeys(periodKeys, { dayKey: next.dayKey, weekKey: next.weekKey });
  if (keys.dayKey) next.dayKey = keys.dayKey;
  if (keys.weekKey) next.weekKey = keys.weekKey;
  const normalizedDefinitions = normalizeMissionDefinitions(definitions);
  if (next.dayKey) {
    for (const definition of normalizedDefinitions.filter((candidate) => candidate.scope === "daily")) {
      addProgressIfMissing(next, progressFromDefinition(definition, next.dayKey));
    }
  }
  if (next.weekKey) {
    for (const definition of normalizedDefinitions.filter((candidate) => candidate.scope === "weekly")) {
      addProgressIfMissing(next, progressFromDefinition(definition, next.weekKey));
    }
  }
  return cloneState(next);
}

/** Alias emphasizing that calling this function is the rollover operation. */
export const rolloverMissionState = ensureMissionPeriods;

/**
 * Create fresh per-match objective instances when a fixture starts. This is
 * separate from event processing so a UI can show objectives before kickoff;
 * calling it again for the same match is harmless and deterministic.
 */
export function initializeMatchMissions(
  state: MissionState,
  matchId: string,
  definitions: readonly MissionDefinition[] = DEFAULT_MISSION_DEFINITIONS,
  periodKeys?: MissionPeriodInput
): MissionState {
  const cleanMatchId = cleanId(matchId);
  if (!cleanMatchId) return cloneState(deserializeMissionState(state) ?? createMissionState());
  const normalizedDefinitions = normalizeMissionDefinitions(definitions);
  const next = ensureMissionPeriods(state, normalizedDefinitions, periodKeys);
  for (const definition of normalizedDefinitions.filter((candidate) => candidate.scope === "match")) {
    addProgressIfMissing(next, progressFromDefinition(definition, cleanMatchId, cleanMatchId));
  }
  return cloneState(next);
}

export const createMatchMissionState = initializeMatchMissions;

export function getMissionMetricValue(event: MatchCompletedEvent, metric: MissionMetric): number {
  switch (metric) {
    case "matchesPlayed": return 1;
    case "wins": return event.outcome === "win" ? 1 : 0;
    case "draws": return event.outcome === "draw" ? 1 : 0;
    case "losses": return event.outcome === "loss" ? 1 : 0;
    case "goals": return event.goals;
    case "shots": return event.shots;
    case "completedPasses": return event.completedPasses;
    case "tackles": return event.tackles;
  }
}

const normalizeMatchCompletedEvent = (value: unknown): MatchCompletedEvent | null => {
  if (!isRecord(value) || value.type !== "matchCompleted") return null;
  const matchId = cleanId(value.matchId);
  const modeId = cleanKey(value.modeId);
  const occurredAt = value.occurredAt;
  const outcome = value.outcome;
  if (!matchId || !modeId || !finiteNumber(occurredAt) || !OUTCOMES.includes(outcome as MatchOutcome)) return null;
  return {
    type: "matchCompleted",
    matchId,
    occurredAt,
    outcome: outcome as MatchOutcome,
    modeId,
    goals: nonNegativeInteger(value.goals),
    shots: nonNegativeInteger(value.shots),
    completedPasses: nonNegativeInteger(value.completedPasses),
    tackles: nonNegativeInteger(value.tackles)
  };
};

const matchesDefinition = (progress: MissionProgress, event: MatchCompletedEvent): boolean =>
  (!progress.modeId || progress.modeId === event.modeId) &&
  (!progress.outcome || progress.outcome === event.outcome);

/**
 * Apply one completed-match event to a detached state. This function is pure:
 * callers can use the returned state as their save snapshot or pass it to a
 * different adapter without risking accidental mutation of the input.
 */
export function processMissionEvent(
  state: MissionState,
  event: MissionEvent,
  definitions: readonly MissionDefinition[] = DEFAULT_MISSION_DEFINITIONS,
  periodKeys?: MissionPeriodInput
): MissionEventResult {
  const base = deserializeMissionState(state) ?? createMissionState();
  const normalizedEvent = normalizeMatchCompletedEvent(event);
  if (!normalizedEvent) {
    return {
      state: cloneState(base),
      accepted: false,
      duplicate: false,
      processed: false,
      changed: false,
      updatedMissionIds: [],
      newlyCompletedMissionIds: [],
      reason: "invalid-event"
    };
  }
  if (base.processedMatchIds.includes(normalizedEvent.matchId)) {
    return {
      state: cloneState(base),
      accepted: true,
      duplicate: true,
      processed: false,
      changed: false,
      updatedMissionIds: [],
      newlyCompletedMissionIds: [],
      reason: "duplicate"
    };
  }

  const normalizedDefinitions = normalizeMissionDefinitions(definitions);
  const next = initializeMatchMissions(base, normalizedEvent.matchId, normalizedDefinitions, periodKeys);
  const keys = normalizeMissionPeriodKeys(periodKeys, { dayKey: next.dayKey, weekKey: next.weekKey });
  const updatedMissionIds: string[] = [];
  const newlyCompletedMissionIds: string[] = [];

  for (const definition of normalizedDefinitions) {
    let progress: MissionProgress | undefined;
    if (definition.scope === "daily" && next.dayKey) {
      progress = next.missions.find((candidate) => candidate.instanceId === missionInstanceId(definition, next.dayKey));
    } else if (definition.scope === "weekly" && next.weekKey) {
      progress = next.missions.find((candidate) => candidate.instanceId === missionInstanceId(definition, next.weekKey));
    } else if (definition.scope === "match") {
      progress = next.missions.find((candidate) => candidate.instanceId === matchMissionInstanceId(definition, normalizedEvent.matchId));
    }
    if (!progress || !matchesDefinition(progress, normalizedEvent)) continue;

    const delta = getMissionMetricValue(normalizedEvent, progress.metric);
    if (delta <= 0 || progress.progress >= progress.target) continue;
    const previous = progress.progress;
    progress.progress = Math.min(progress.target, previous + Math.floor(delta));
    progress.lastUpdatedAt = normalizedEvent.occurredAt;
    if (!progress.completed && progress.progress >= progress.target) {
      progress.completed = true;
      progress.completedAt = normalizedEvent.occurredAt;
      newlyCompletedMissionIds.push(progress.instanceId);
    }
    if (progress.progress !== previous) updatedMissionIds.push(progress.instanceId);
  }

  next.processedMatchIds.push(normalizedEvent.matchId);
  // Keep the duplicate check O(n) predictable and the serialized history tidy.
  next.processedMatchIds = [...new Set(next.processedMatchIds)];
  return {
    state: cloneState(next),
    accepted: true,
    duplicate: false,
    processed: true,
    changed: true,
    updatedMissionIds,
    newlyCompletedMissionIds
  };
}

/** Semantic alias for callers that name the input “match event”. */
export const applyMissionEvent = processMissionEvent;
export const processMatchCompleted = processMissionEvent;

const emptyReward = (): MissionReward => ({ coins: 0, xp: 0 });

const claimResultFor = (
  state: MissionState,
  status: MissionClaimResult["status"],
  progress: MissionProgress | null,
  reason?: MissionClaimResult["reason"]
): MissionClaimResult => {
  const reward = progress ? cloneReward(progress.reward) : emptyReward();
  const claimId = progress ? progress.claimId ?? missionClaimId(progress.instanceId) : null;
  return {
    state: cloneState(state),
    status,
    claimed: status === "claimed",
    alreadyClaimed: status === "alreadyClaimed",
    claimId,
    transactionId: claimId,
    missionId: progress?.missionId ?? null,
    instanceId: progress?.instanceId ?? null,
    reward,
    coins: reward.coins,
    xp: reward.xp,
    ...(reason ? { reason } : {})
  };
};

const resolveProgress = (state: MissionState, missionKey: string): MissionProgress | null => {
  const exact = state.missions.find((candidate) => candidate.instanceId === missionKey);
  if (exact) return exact;
  // Mission ids are accepted as a convenience. Reverse order picks the most
  // recently-created period while preserving all historical instances.
  for (let index = state.missions.length - 1; index >= 0; index -= 1) {
    if (state.missions[index].missionId === missionKey) return state.missions[index];
  }
  // A scoped id such as `match:shooting` is also accepted when the caller has
  // not yet appended the concrete match id. The most recent matching instance
  // wins, just like the mission-id convenience above.
  const prefix = missionKey.endsWith(":") ? missionKey : `${missionKey}:`;
  for (let index = state.missions.length - 1; index >= 0; index -= 1) {
    if (state.missions[index].instanceId.startsWith(prefix)) return state.missions[index];
  }
  return null;
};

/** Pure explicit claim operation. It never generates a wall-clock timestamp. */
export function claimMission(
  state: MissionState,
  missionKey: string,
  options: MissionClaimOptions = {}
): MissionClaimResult {
  const next = deserializeMissionState(state) ?? createMissionState();
  const progress = resolveProgress(next, missionKey);
  if (!progress) return claimResultFor(next, "notFound", null, "not-found");
  const stableClaimId = progress.claimId ?? missionClaimId(progress.instanceId);
  if (progress.claimed) {
    progress.claimId = stableClaimId;
    return claimResultFor(next, "alreadyClaimed", progress, "already-claimed");
  }
  if (!progress.completed) return claimResultFor(next, "notComplete", progress, "not-complete");
  progress.claimed = true;
  progress.claimId = stableClaimId;
  progress.claimedAt = finiteNumber(options.claimedAt) ? options.claimedAt : null;
  return claimResultFor(next, "claimed", progress);
}

/** Main stateful facade used by menus and the application composition layer. */
export class MissionsSystem {
  private readonly missionDefinitions: MissionDefinition[];
  private currentState: MissionState;

  constructor(
    options: MissionSystemOptions | readonly MissionDefinition[] = {},
    initialState?: MissionState | string | unknown,
    initialPeriodKeys?: MissionPeriodInput
  ) {
    const config: MissionSystemOptions = Array.isArray(options)
      ? { definitions: options, state: initialState, periodKeys: initialPeriodKeys }
      : options as MissionSystemOptions;
    this.missionDefinitions = normalizeMissionDefinitions(config.definitions ?? DEFAULT_MISSION_DEFINITIONS);
    const keys = normalizeMissionPeriodKeys(config.periodKeys ?? initialPeriodKeys);
    const suppliedState = config.state ?? config.initialState ?? initialState;
    const restored = deserializeMissionState(suppliedState, keys) ?? createMissionState(keys);
    this.currentState = ensureMissionPeriods(restored, this.missionDefinitions, keys);
  }

  get definitions(): readonly MissionDefinition[] {
    return this.missionDefinitions.map(cloneDefinition);
  }

  get state(): MissionState {
    return cloneState(this.currentState);
  }

  getState(): MissionState {
    return this.state;
  }

  get periodKeys(): MissionPeriodKeys {
    return { dayKey: this.currentState.dayKey, weekKey: this.currentState.weekKey };
  }

  /** Add the current daily/weekly instances and return a detached snapshot. */
  syncPeriods(periodKeys?: MissionPeriodInput): MissionState {
    this.currentState = ensureMissionPeriods(this.currentState, this.missionDefinitions, periodKeys);
    return this.state;
  }

  rollover(periodKeys?: MissionPeriodInput): MissionState {
    return this.syncPeriods(periodKeys);
  }

  processEvent(event: MissionEvent, periodKeys?: MissionPeriodInput): MissionEventResult {
    const result = processMissionEvent(this.currentState, event, this.missionDefinitions, periodKeys ?? this.periodKeys);
    this.currentState = result.state;
    return { ...result, state: this.state };
  }

  processMatchCompleted(event: MatchCompletedEvent, periodKeys?: MissionPeriodInput): MissionEventResult {
    return this.processEvent(event, periodKeys);
  }

  startMatch(matchId: string, periodKeys?: MissionPeriodInput): MissionState {
    this.currentState = initializeMatchMissions(this.currentState, matchId, this.missionDefinitions, periodKeys);
    return this.state;
  }

  initializeMatch(matchId: string, periodKeys?: MissionPeriodInput): MissionState {
    return this.startMatch(matchId, periodKeys);
  }

  applyEvent(event: MissionEvent, periodKeys?: MissionPeriodInput): MissionEventResult {
    return this.processEvent(event, periodKeys);
  }

  claimMission(missionKey: string, options: MissionClaimOptions = {}): MissionClaimResult {
    const result = claimMission(this.currentState, missionKey, options);
    this.currentState = result.state;
    return { ...result, state: this.state };
  }

  claim(missionKey: string, options: MissionClaimOptions = {}): MissionClaimResult {
    return this.claimMission(missionKey, options);
  }

  getMission(missionKey: string): MissionProgress | undefined {
    return resolveProgress(this.currentState, missionKey)
      ? cloneProgress(resolveProgress(this.currentState, missionKey) as MissionProgress)
      : undefined;
  }

  getMissions(scopeOrOptions?: MissionScope | MissionListOptions): MissionProgress[] {
    const options: MissionListOptions = typeof scopeOrOptions === "string"
      ? { scope: scopeOrOptions }
      : scopeOrOptions ?? {};
    const dayKey = cleanKey(options.dayKey, this.currentState.dayKey);
    const weekKey = cleanKey(options.weekKey, this.currentState.weekKey);
    return this.currentState.missions
      .filter((mission) => !options.scope || mission.scope === options.scope)
      .filter((mission) => !options.matchId || mission.matchId === options.matchId)
      .filter((mission) => {
        if (!options.currentOnly) return true;
        if (mission.scope === "daily") return mission.periodKey === dayKey;
        if (mission.scope === "weekly") return mission.periodKey === weekKey;
        return !options.matchId || mission.matchId === options.matchId;
      })
      .map(cloneProgress);
  }

  listMissions(scopeOrOptions?: MissionScope | MissionListOptions): MissionProgress[] {
    return this.getMissions(scopeOrOptions);
  }

  getCurrentMissions(scope?: MissionScope): MissionProgress[] {
    return this.getMissions({ scope, currentOnly: true });
  }

  getMatchMissions(matchId: string): MissionProgress[] {
    return this.getMissions({ scope: "match", matchId });
  }

  getClaimableMissions(options: MissionListOptions = { currentOnly: true }): MissionProgress[] {
    return this.getMissions(options).filter((mission) => mission.completed && !mission.claimed);
  }

  serialize(): string {
    return serializeMissionState(this.currentState);
  }

  /** Replace state after a local save load; invalid/future data is rejected. */
  restore(value: unknown, periodKeys?: MissionPeriodInput): boolean {
    const keys = normalizeMissionPeriodKeys(periodKeys, this.periodKeys);
    const restored = deserializeMissionState(value, keys);
    if (!restored) return false;
    this.currentState = ensureMissionPeriods(restored, this.missionDefinitions, keys);
    return true;
  }

  reset(periodKeys?: MissionPeriodInput): MissionState {
    const keys = normalizeMissionPeriodKeys(periodKeys, this.periodKeys);
    this.currentState = ensureMissionPeriods(createMissionState(keys), this.missionDefinitions, keys);
    return this.state;
  }
}

/** Naming aliases keep the domain ergonomic in different integration layers. */
export const MissionSystem = MissionsSystem;
export const MissionManager = MissionsSystem;

export function createMissionsSystem(options: MissionSystemOptions = {}): MissionsSystem {
  return new MissionsSystem(options);
}

export const createMissionSystem = createMissionsSystem;
