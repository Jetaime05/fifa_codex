/**
 * A small, deterministic, offline season mode.
 *
 * The mode deliberately owns no rendering or match simulation concerns.  A
 * caller starts a season, plays the fixture returned by getCurrentFixture(),
 * then records the home/away score with recordSeasonResult().  Every state
 * transition returns a new, serializable snapshot so a progression service can
 * settle match rewards without coupling itself to this module.
 */

export const SEASON_STATE_VERSION = 1;
export const DEFAULT_SEASON_MODE_ID = "season";
export const DEFAULT_SEASON_TEAM_ID = "pitch11-fc";
export const DEFAULT_SEASON_TEAM_NAME = "Pitch11 FC";
export const DEFAULT_SEASON_FIXTURE_COUNT = 6;
export const DEFAULT_SEASON_STORAGE_KEY = "elite-kickoff:season:v1";

export type SeasonStatus = "idle" | "active" | "completed";
export type SeasonOutcome = "win" | "draw" | "loss";
export type SeasonScoreInput = number | string;

export type SeasonOpponent = {
  id: string;
  name: string;
  strength: number;
};

export type SeasonModeOptions = {
  teamId?: string;
  teamName?: string;
  fixtureCount?: number;
  opponents?: readonly SeasonOpponent[];
  /** Included in fixture ids so a new season can never collide with settled matches from an older season. */
  seasonNumber?: number;
};

export type SeasonFixture = {
  matchId: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  opponentId: string;
  playerIsHome: boolean;
  played: boolean;
};

export type SeasonMatchResult = {
  matchId: string;
  homeScore: number;
  awayScore: number;
  outcome: SeasonOutcome;
  points: number;
};

export type SeasonStanding = {
  rank: number;
  teamId: string;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type SeasonReward = {
  rewardId: string;
  coins: number;
  xp: number;
  reason: "season-complete";
};

export type SeasonCompletion = {
  placement: number;
  champion: boolean;
  reward: SeasonReward;
  rewardEligible: boolean;
  rewardClaimed: boolean;
};

export type SeasonState = {
  version: typeof SEASON_STATE_VERSION;
  modeId: string;
  seasonId: string;
  seasonNumber: number;
  teamId: string;
  teamName: string;
  opponents: SeasonOpponent[];
  status: SeasonStatus;
  fixtures: SeasonFixture[];
  results: Record<string, SeasonMatchResult>;
  standings: SeasonStanding[];
  completion: SeasonCompletion | null;
  completionRewardClaimed: boolean;
};

export type SeasonResultRejectReason =
  | "invalid-mode"
  | "season-not-started"
  | "season-complete"
  | "already-recorded"
  | "unknown-match"
  | "fixture-not-current"
  | "invalid-score";

export type SeasonResultReceipt = {
  accepted: boolean;
  duplicate: boolean;
  completed: boolean;
  matchId: string;
  result: SeasonMatchResult | null;
  reward: SeasonReward | null;
  reason?: SeasonResultRejectReason;
  state: SeasonState;
};

export type SeasonRewardClaimReceipt = {
  claimed: boolean;
  duplicate: boolean;
  reward: SeasonReward | null;
  state: SeasonState;
};

export type SeasonStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type CreateSeasonStoreOptions = {
  modeId?: string;
  options?: SeasonModeOptions;
  initialState?: unknown;
  storage?: SeasonStorageLike;
  storageKey?: string;
};

export type SeasonModeStore = {
  readonly snapshot: SeasonState;
  readonly state: SeasonState;
  readonly revision: number;
  readonly serialized: string;
  getState(): SeasonState;
  getSnapshot(): SeasonState;
  startSeason(modeId: string, options?: SeasonModeOptions): SeasonState;
  startNewSeason(modeId: string, options?: SeasonModeOptions): SeasonState;
  getCurrentFixture(): SeasonFixture | null;
  recordResult(matchId: string, homeScore: SeasonScoreInput, awayScore: SeasonScoreInput): SeasonResultReceipt;
  recordSeasonResult(matchId: string, homeScore: SeasonScoreInput, awayScore: SeasonScoreInput): SeasonResultReceipt;
  claimCompletionReward(): SeasonRewardClaimReceipt;
  getCompletionReward(): SeasonReward | null;
  serialize(): string;
  hydrate(serialized: string): SeasonState;
  subscribe(listener: (state: SeasonState) => void): () => void;
};

const DEFAULT_OPPONENTS: readonly SeasonOpponent[] = [
  { id: "northbridge", name: "Northbridge United", strength: 71 },
  { id: "harbor-athletic", name: "Harbor Athletic", strength: 67 },
  { id: "redwood-rovers", name: "Redwood Rovers", strength: 74 },
  { id: "metro-stars", name: "Metro Stars", strength: 79 },
  { id: "lakeside-11", name: "Lakeside 11", strength: 64 },
  { id: "ironvale", name: "Ironvale FC", strength: 76 },
  { id: "crown-city", name: "Crown City", strength: 82 },
  { id: "eastfield", name: "Eastfield Town", strength: 69 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string, maxLength = 80): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function modeIdValue(value: unknown, fallback = DEFAULT_SEASON_MODE_ID): string {
  return stringValue(value, fallback, 64);
}

function integerValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function scoreValue(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return integerValue(numeric, 0, 0, 20);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffle<T>(values: readonly T[], seedValue: number): T[] {
  const output = [...values];
  let seed = seedValue >>> 0;
  for (let index = output.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const target = seed % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function sanitizeOpponent(value: unknown, index: number, teamId: string): SeasonOpponent | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id ?? value.opponentId, `opponent-${index + 1}`, 64);
  if (id === teamId) return null;
  return {
    id,
    name: stringValue(value.name ?? value.teamName, `Opponent ${index + 1}`, 80),
    strength: integerValue(value.strength ?? value.rating ?? value.overall, 70, 40, 99),
  };
}

function sanitizeOpponents(values: unknown, teamId: string): SeasonOpponent[] {
  const source = Array.isArray(values) ? values : DEFAULT_OPPONENTS;
  const seen = new Set<string>();
  const result: SeasonOpponent[] = [];
  source.forEach((value, index) => {
    const opponent = sanitizeOpponent(value, index, teamId);
    if (opponent && !seen.has(opponent.id)) {
      seen.add(opponent.id);
      result.push(opponent);
    }
  });
  if (result.length) return result;
  return DEFAULT_OPPONENTS.map((opponent) => ({ ...opponent }));
}

function seasonIdFor(modeId: string, seasonNumber: number): string {
  return `${encodeURIComponent(modeId)}:season-${seasonNumber}`;
}

function rewardFor(seasonId: string, placement: number): SeasonReward {
  const champion = placement === 1;
  const podium = placement <= 3;
  return {
    rewardId: `${seasonId}:completion-reward`,
    coins: champion ? 750 : podium ? 500 : 300,
    xp: champion ? 350 : podium ? 250 : 180,
    reason: "season-complete",
  };
}

function outcomeForPlayer(fixture: SeasonFixture, homeScore: number, awayScore: number): SeasonOutcome {
  const playerScore = fixture.playerIsHome ? homeScore : awayScore;
  const opponentScore = fixture.playerIsHome ? awayScore : homeScore;
  if (playerScore > opponentScore) return "win";
  if (playerScore < opponentScore) return "loss";
  return "draw";
}

function pointsFor(outcome: SeasonOutcome): number {
  return outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
}

function resultFrom(fixture: SeasonFixture, homeScore: number, awayScore: number): SeasonMatchResult {
  const outcome = outcomeForPlayer(fixture, homeScore, awayScore);
  return {
    matchId: fixture.matchId,
    homeScore,
    awayScore,
    outcome,
    points: pointsFor(outcome),
  };
}

/**
 * Build a deterministic short schedule.  The same mode id and options always
 * produce the same order, home/away assignment, opponent names and match ids.
 */
export function createSeasonSchedule(modeId: string, options: SeasonModeOptions = {}): SeasonFixture[] {
  const normalizedModeId = modeIdValue(modeId);
  const seasonNumber = integerValue(options.seasonNumber, 1, 1, 9999);
  const teamId = stringValue(options.teamId, DEFAULT_SEASON_TEAM_ID, 64);
  const teamName = stringValue(options.teamName, DEFAULT_SEASON_TEAM_NAME, 80);
  const opponents = sanitizeOpponents(options.opponents, teamId);
  const fixtureCount = integerValue(options.fixtureCount, DEFAULT_SEASON_FIXTURE_COUNT, 1, 10);
  const orderedOpponents = shuffle(opponents, hashString(normalizedModeId));
  const homeSeed = hashString(`${normalizedModeId}:home-away`);
  return Array.from({ length: fixtureCount }, (_, index) => {
    const opponent = orderedOpponents[index % orderedOpponents.length];
    const playerIsHome = ((homeSeed + index) % 2) === 0;
    const matchId = `season:${encodeURIComponent(normalizedModeId)}:${seasonNumber}:fixture:${index + 1}`;
    return {
      matchId,
      round: index + 1,
      homeTeamId: playerIsHome ? teamId : opponent.id,
      awayTeamId: playerIsHome ? opponent.id : teamId,
      homeTeamName: playerIsHome ? teamName : opponent.name,
      awayTeamName: playerIsHome ? opponent.name : teamName,
      opponentId: opponent.id,
      playerIsHome,
      played: false,
    };
  });
}

function emptyStandings(): SeasonStanding[] {
  return [];
}

function stateForSchedule(
  modeId: string,
  options: SeasonModeOptions,
  seasonNumber: number,
  status: SeasonStatus = "active",
): SeasonState {
  const normalizedModeId = modeIdValue(modeId);
  const teamId = stringValue(options.teamId, DEFAULT_SEASON_TEAM_ID, 64);
  const teamName = stringValue(options.teamName, DEFAULT_SEASON_TEAM_NAME, 80);
  const opponents = sanitizeOpponents(options.opponents, teamId);
  const fixtures = status === "idle" ? [] : createSeasonSchedule(normalizedModeId, { ...options, teamId, teamName, opponents, seasonNumber });
  return {
    version: SEASON_STATE_VERSION,
    modeId: normalizedModeId,
    seasonId: seasonIdFor(normalizedModeId, seasonNumber),
    seasonNumber,
    teamId,
    teamName,
    opponents,
    status,
    fixtures,
    results: {},
    standings: emptyStandings(),
    completion: null,
    completionRewardClaimed: false,
  };
}

export function createIdleSeasonState(
  modeId = DEFAULT_SEASON_MODE_ID,
  options: SeasonModeOptions = {},
): SeasonState {
  return stateForSchedule(modeId, options, 0, "idle");
}

/** Start the first season for a mode. */
export function startSeason(modeId: string, options: SeasonModeOptions = {}): SeasonState {
  return deriveSeasonState(stateForSchedule(modeId, options, 1, "active"));
}

/** Start a fresh season, incrementing the season number for the same mode. */
export function startNewSeason(modeId: string, options?: SeasonModeOptions): SeasonState;
export function startNewSeason(
  previous: SeasonState | null | undefined,
  modeId: string,
  options?: SeasonModeOptions,
): SeasonState;
export function startNewSeason(
  previousOrModeId: SeasonState | string | null | undefined,
  modeIdOrOptions?: string | SeasonModeOptions,
  suppliedOptions: SeasonModeOptions = {},
): SeasonState {
  const previous = typeof previousOrModeId === "string" || previousOrModeId === null || previousOrModeId === undefined
    ? undefined
    : previousOrModeId;
  const modeId = typeof previousOrModeId === "string"
    ? previousOrModeId
    : typeof modeIdOrOptions === "string" ? modeIdOrOptions : DEFAULT_SEASON_MODE_ID;
  const options = typeof previousOrModeId === "string"
    ? (isRecord(modeIdOrOptions) ? modeIdOrOptions as SeasonModeOptions : {})
    : suppliedOptions;
  const normalizedModeId = modeIdValue(modeId);
  const sameMode = previous && modeIdValue(previous.modeId) === normalizedModeId;
  const seasonNumber = sameMode ? integerValue(previous?.seasonNumber, 0, 0, 9999) + 1 : 1;
  const previousOptions: SeasonModeOptions = sameMode && previous
    ? {
        teamId: previous.teamId,
        teamName: previous.teamName,
        fixtureCount: previous.fixtures.length || undefined,
        opponents: previous.opponents,
      }
    : {};
  return deriveSeasonState(
    stateForSchedule(normalizedModeId, { ...previousOptions, ...options }, seasonNumber, "active"),
  );
}

function standingTemplate(teamId: string, teamName: string): SeasonStanding {
  return {
    rank: 0,
    teamId,
    teamName,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function calculateStandings(state: SeasonState): SeasonStanding[] {
  const rows = new Map<string, SeasonStanding>();
  rows.set(state.teamId, standingTemplate(state.teamId, state.teamName));
  state.opponents.forEach((opponent) => {
    if (!rows.has(opponent.id)) rows.set(opponent.id, standingTemplate(opponent.id, opponent.name));
  });
  for (const fixture of state.fixtures) {
    const result = hasResult(state.results, fixture.matchId) ? state.results[fixture.matchId] : undefined;
    if (!result) continue;
    const home = rows.get(fixture.homeTeamId) ?? standingTemplate(fixture.homeTeamId, fixture.homeTeamName);
    const away = rows.get(fixture.awayTeamId) ?? standingTemplate(fixture.awayTeamId, fixture.awayTeamName);
    home.played += 1;
    away.played += 1;
    home.goalsFor += result.homeScore;
    home.goalsAgainst += result.awayScore;
    away.goalsFor += result.awayScore;
    away.goalsAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (result.homeScore < result.awayScore) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
    home.goalDifference = home.goalsFor - home.goalsAgainst;
    away.goalDifference = away.goalsFor - away.goalsAgainst;
    rows.set(home.teamId, home);
    rows.set(away.teamId, away);
  }
  return [...rows.values()]
    .sort((left, right) =>
      right.points - left.points
      || right.goalDifference - left.goalDifference
      || right.goalsFor - left.goalsFor
      || right.wins - left.wins
      || left.teamId.localeCompare(right.teamId),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function completionFor(state: SeasonState, standings: readonly SeasonStanding[]): SeasonCompletion | null {
  if (!state.fixtures.length || state.fixtures.some((fixture) => !hasResult(state.results, fixture.matchId))) return null;
  const player = standings.find((row) => row.teamId === state.teamId);
  if (!player) return null;
  const reward = rewardFor(state.seasonId, player.rank);
  const claimed = state.completionRewardClaimed;
  return {
    placement: player.rank,
    champion: player.rank === 1,
    reward,
    rewardEligible: !claimed,
    rewardClaimed: claimed,
  };
}

function cloneResults(results: Record<string, SeasonMatchResult>): Record<string, SeasonMatchResult> {
  return Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { ...result }]));
}

function hasResult(results: Record<string, SeasonMatchResult>, matchId: string): boolean {
  return Object.prototype.hasOwnProperty.call(results, matchId) && Boolean(results[matchId]);
}

function deriveSeasonState(state: SeasonState): SeasonState {
  const results = cloneResults(state.results);
  const fixtures = state.fixtures.map((fixture) => ({ ...fixture, played: hasResult(results, fixture.matchId) }));
  const withFixtures: SeasonState = {
    ...state,
    version: SEASON_STATE_VERSION,
    modeId: modeIdValue(state.modeId),
    seasonId: stringValue(state.seasonId, seasonIdFor(modeIdValue(state.modeId), state.seasonNumber), 120),
    seasonNumber: integerValue(state.seasonNumber, 1, 0, 9999),
    teamId: stringValue(state.teamId, DEFAULT_SEASON_TEAM_ID, 64),
    teamName: stringValue(state.teamName, DEFAULT_SEASON_TEAM_NAME, 80),
    opponents: sanitizeOpponents(state.opponents, stringValue(state.teamId, DEFAULT_SEASON_TEAM_ID, 64)),
    status: state.status === "idle" ? "idle" : "active",
    fixtures,
    results,
    standings: [],
    completion: null,
    completionRewardClaimed: Boolean(state.completionRewardClaimed),
  };
  const standings = withFixtures.status === "idle" ? [] : calculateStandings(withFixtures);
  const completion = completionFor(withFixtures, standings);
  return {
    ...withFixtures,
    status: withFixtures.status === "idle" ? "idle" : completion ? "completed" : "active",
    standings,
    completion,
  };
}

function cloneSeasonState(state: SeasonState): SeasonState {
  return {
    ...state,
    opponents: state.opponents.map((opponent) => ({ ...opponent })),
    fixtures: state.fixtures.map((fixture) => ({ ...fixture })),
    results: cloneResults(state.results),
    standings: state.standings.map((standing) => ({ ...standing })),
    completion: state.completion
      ? { ...state.completion, reward: { ...state.completion.reward } }
      : null,
  };
}

export function getCurrentFixture(state: SeasonState, modeId?: string): SeasonFixture | null {
  if (modeId !== undefined && modeIdValue(modeId) !== modeIdValue(state.modeId)) return null;
  if (state.status !== "active") return null;
  return state.fixtures.find((fixture) => !fixture.played && !hasResult(state.results, fixture.matchId)) ?? null;
}

export function getSeasonRewardEligibility(state: SeasonState, modeId?: string): SeasonReward | null {
  if (modeId !== undefined && modeIdValue(modeId) !== modeIdValue(state.modeId)) return null;
  if (!state.completion || !state.completion.rewardEligible) return null;
  return { ...state.completion.reward };
}

function rejectedResult(
  state: SeasonState,
  matchId: string,
  reason: SeasonResultRejectReason,
  duplicate = false,
): SeasonResultReceipt {
  return {
    accepted: false,
    duplicate,
    completed: state.status === "completed",
    matchId,
    result: hasResult(state.results, matchId) ? { ...state.results[matchId] } : null,
    reward: null,
    reason,
    state,
  };
}

/**
 * Record one current fixture exactly once.  Replaying an already-settled
 * match returns duplicate=true and never changes standings or rewards.
 */
export function recordSeasonResult(
  state: SeasonState,
  modeId: string,
  matchId: string,
  homeScore: SeasonScoreInput,
  awayScore: SeasonScoreInput,
): SeasonResultReceipt;
export function recordSeasonResult(
  state: SeasonState,
  matchId: string,
  homeScore: SeasonScoreInput,
  awayScore: SeasonScoreInput,
): SeasonResultReceipt;
export function recordSeasonResult(
  state: SeasonState,
  modeOrMatchId: string,
  matchOrHomeScore: string | SeasonScoreInput,
  homeOrAwayScore: SeasonScoreInput,
  maybeAwayScore?: SeasonScoreInput,
): SeasonResultReceipt {
  const explicitMode = maybeAwayScore !== undefined;
  const modeId = explicitMode ? modeOrMatchId : state.modeId;
  const matchId = explicitMode ? matchOrHomeScore as string : modeOrMatchId;
  const homeScore = explicitMode ? homeOrAwayScore : matchOrHomeScore;
  const awayScore = explicitMode ? maybeAwayScore : homeOrAwayScore;
  const requestedMode = typeof modeId === "string" && modeId.trim() ? modeIdValue(modeId) : "";
  const normalizedMatchId = stringValue(matchId, "", 160);
  if (!requestedMode || requestedMode !== modeIdValue(state.modeId)) return rejectedResult(state, normalizedMatchId, "invalid-mode");
  const existing = hasResult(state.results, normalizedMatchId) ? state.results[normalizedMatchId] : undefined;
  if (existing) {
    return rejectedResult(state, normalizedMatchId, "already-recorded", true);
  }
  if (state.status === "idle") return rejectedResult(state, normalizedMatchId, "season-not-started");
  if (state.status === "completed") return rejectedResult(state, normalizedMatchId, "season-complete");
  const fixture = state.fixtures.find((candidate) => candidate.matchId === normalizedMatchId);
  if (!fixture) return rejectedResult(state, normalizedMatchId, "unknown-match");
  const current = getCurrentFixture(state);
  if (!current || current.matchId !== normalizedMatchId) return rejectedResult(state, normalizedMatchId, "fixture-not-current");
  const normalizedHomeScore = scoreValue(homeScore);
  const normalizedAwayScore = scoreValue(awayScore);
  if (normalizedHomeScore === null || normalizedAwayScore === null) return rejectedResult(state, normalizedMatchId, "invalid-score");
  const result = resultFrom(fixture, normalizedHomeScore, normalizedAwayScore);
  const next = deriveSeasonState({
    ...state,
    results: { ...state.results, [normalizedMatchId]: result },
    completionRewardClaimed: false,
  });
  return {
    accepted: true,
    duplicate: false,
    completed: next.status === "completed",
    matchId: normalizedMatchId,
    result: { ...result },
    reward: next.status === "completed" ? getSeasonRewardEligibility(next) : null,
    state: next,
  };
}

export function claimSeasonCompletionReward(state: SeasonState, modeId?: string): SeasonRewardClaimReceipt {
  if (modeId !== undefined && modeIdValue(modeId) !== modeIdValue(state.modeId)) {
    return { claimed: false, duplicate: false, reward: null, state };
  }
  const eligible = getSeasonRewardEligibility(state);
  if (!eligible) {
    return {
      claimed: false,
      duplicate: Boolean(state.completion?.rewardClaimed),
      reward: state.completion ? { ...state.completion.reward } : null,
      state,
    };
  }
  const next = deriveSeasonState({ ...state, completionRewardClaimed: true });
  return { claimed: true, duplicate: false, reward: eligible, state: next };
}

function rawResultEntries(raw: Record<string, unknown>): unknown[] {
  const value = raw.results ?? raw.matchResults ?? raw.fixturesResults;
  if (Array.isArray(value)) return value;
  if (isRecord(value)) return Object.entries(value).map(([matchId, result]) => ({ matchId, ...(isRecord(result) ? result : {}) }));
  return [];
}

function sanitizeMigratedResults(raw: Record<string, unknown>, fixtures: readonly SeasonFixture[]): Record<string, SeasonMatchResult> {
  const fixtureMap = new Map(fixtures.map((fixture) => [fixture.matchId, fixture]));
  const results: Record<string, SeasonMatchResult> = {};
  for (const entry of rawResultEntries(raw)) {
    if (!isRecord(entry)) continue;
    const matchId = stringValue(entry.matchId ?? entry.id ?? entry.fixtureId, "", 160);
    const fixture = fixtureMap.get(matchId);
    if (!fixture || results[matchId]) continue;
    const homeScore = scoreValue(entry.homeScore ?? entry.home ?? entry.scoreHome);
    const awayScore = scoreValue(entry.awayScore ?? entry.away ?? entry.scoreAway);
    if (homeScore === null || awayScore === null) continue;
    results[matchId] = resultFrom(fixture, homeScore, awayScore);
  }
  return results;
}

/**
 * Sanitize and migrate persisted state.  Unknown fields are ignored, future
 * versions are read conservatively, and all derived table/completion values
 * are rebuilt from the deterministic fixture list and accepted scores.
 */
export function migrateSeasonState(
  rawValue: unknown,
  fallbackModeId = DEFAULT_SEASON_MODE_ID,
  options: SeasonModeOptions = {},
): SeasonState {
  if (!isRecord(rawValue)) return createIdleSeasonState(fallbackModeId, options);
  const rawVersion = rawValue.version;
  if (typeof rawVersion === "number" && Number.isFinite(rawVersion) && rawVersion > SEASON_STATE_VERSION) {
    return createIdleSeasonState(fallbackModeId, options);
  }
  const modeId = modeIdValue(rawValue.modeId, modeIdValue(fallbackModeId));
  const teamId = stringValue(rawValue.teamId, options.teamId ?? DEFAULT_SEASON_TEAM_ID, 64);
  const teamName = stringValue(rawValue.teamName, options.teamName ?? DEFAULT_SEASON_TEAM_NAME, 80);
  const rawOpponents = rawValue.opponents ?? rawValue.teams;
  const opponents = sanitizeOpponents(rawOpponents ?? options.opponents, teamId);
  const rawFixtures = Array.isArray(rawValue.fixtures) ? rawValue.fixtures : [];
  const fixtureCount = integerValue(rawValue.fixtureCount, rawFixtures.length || options.fixtureCount || DEFAULT_SEASON_FIXTURE_COUNT, 1, 10);
  const seasonNumber = integerValue(rawValue.seasonNumber, 1, 0, 9999);
  const status: SeasonStatus = rawValue.status === "idle" || rawValue.started === false ? "idle" : "active";
  const base = stateForSchedule(modeId, {
    teamId,
    teamName,
    fixtureCount,
    opponents,
  }, seasonNumber, status);
  if (status === "idle") return base;
  const results = sanitizeMigratedResults(rawValue, base.fixtures);
  return deriveSeasonState({
    ...base,
    results,
    completionRewardClaimed: isRecord(rawValue.completion) && Boolean(rawValue.completion.rewardClaimed)
      || Boolean(rawValue.completionRewardClaimed),
  });
}

export const sanitizeSeasonState = migrateSeasonState;

export function serializeSeasonState(state: SeasonState): string {
  return JSON.stringify(deriveSeasonState(state));
}

export function deserializeSeasonState(
  serialized: string,
  fallbackModeId = DEFAULT_SEASON_MODE_ID,
  options: SeasonModeOptions = {},
): SeasonState {
  try {
    return migrateSeasonState(JSON.parse(serialized), fallbackModeId, options);
  } catch {
    return createIdleSeasonState(fallbackModeId, options);
  }
}

export function createSeasonModeStore(options: CreateSeasonStoreOptions = {}): SeasonModeStore {
  const storageKey = stringValue(options.storageKey, DEFAULT_SEASON_STORAGE_KEY, 160);
  const configuredModeId = modeIdValue(options.modeId);
  let snapshot: SeasonState;
  if (typeof options.initialState === "string") {
    snapshot = deserializeSeasonState(options.initialState, configuredModeId, options.options);
  } else if (options.initialState !== undefined) {
    snapshot = migrateSeasonState(options.initialState, configuredModeId, options.options);
  } else {
    let stored: string | null = null;
    try {
      stored = options.storage?.getItem(storageKey) ?? null;
    } catch {
      stored = null;
    }
    snapshot = stored ? deserializeSeasonState(stored, configuredModeId, options.options) : createIdleSeasonState(configuredModeId, options.options);
  }
  let revision = 0;
  const listeners = new Set<(state: SeasonState) => void>();

  const persist = (): void => {
    if (!options.storage) return;
    try {
      options.storage.setItem(storageKey, serializeSeasonState(snapshot));
    } catch {
      // Storage is an optional enhancement; a quota/private-mode failure must
      // not make the offline mode unusable.
    }
  };

  const update = (next: SeasonState, notify = true): SeasonState => {
    snapshot = deriveSeasonState(next);
    revision += 1;
    persist();
    if (notify) listeners.forEach((listener) => listener(cloneSeasonState(snapshot)));
    return snapshot;
  };

  const store: SeasonModeStore = {
    get snapshot() {
      return cloneSeasonState(snapshot);
    },
    get state() {
      return cloneSeasonState(snapshot);
    },
    get revision() {
      return revision;
    },
    get serialized() {
      return serializeSeasonState(snapshot);
    },
    getState: () => cloneSeasonState(snapshot),
    getSnapshot: () => cloneSeasonState(snapshot),
    startSeason: (modeId, seasonOptions = {}) => update(startSeason(modeId, seasonOptions)),
    startNewSeason: (modeId, seasonOptions = {}) => update(startNewSeason(snapshot, modeId, seasonOptions)),
    getCurrentFixture: () => getCurrentFixture(snapshot),
    recordResult: (matchId, homeScore, awayScore) => {
      const receipt = recordSeasonResult(snapshot, snapshot.modeId, matchId, homeScore, awayScore);
      if (receipt.accepted) update(receipt.state);
      return { ...receipt, state: cloneSeasonState(snapshot) };
    },
    recordSeasonResult: (matchId, homeScore, awayScore) => {
      const receipt = recordSeasonResult(snapshot, snapshot.modeId, matchId, homeScore, awayScore);
      if (receipt.accepted) update(receipt.state);
      return { ...receipt, state: cloneSeasonState(snapshot) };
    },
    claimCompletionReward: () => {
      const receipt = claimSeasonCompletionReward(snapshot, snapshot.modeId);
      if (receipt.claimed) update(receipt.state);
      return { ...receipt, state: cloneSeasonState(snapshot) };
    },
    getCompletionReward: () => getSeasonRewardEligibility(snapshot, snapshot.modeId),
    serialize: () => serializeSeasonState(snapshot),
    hydrate: (serialized) => update(deserializeSeasonState(serialized, snapshot.modeId, {
      teamId: snapshot.teamId,
      teamName: snapshot.teamName,
      opponents: snapshot.opponents,
      fixtureCount: snapshot.fixtures.length || undefined,
    })),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

export const createSeasonStore = createSeasonModeStore;
export const createSeasonState = startSeason;
export const beginSeason = startSeason;
export const getSeasonFixture = getCurrentFixture;

/** Convenience overload for callers whose store already identifies the mode. */
export function recordCurrentSeasonResult(
  state: SeasonState,
  matchId: string,
  homeScore: SeasonScoreInput,
  awayScore: SeasonScoreInput,
): SeasonResultReceipt {
  return recordSeasonResult(state, state.modeId, matchId, homeScore, awayScore);
}

/** Compatibility helper accepting either an explicit or state-owned mode id. */
export function recordSeasonMatch(
  state: SeasonState,
  matchId: string,
  homeScore: SeasonScoreInput,
  awayScore: SeasonScoreInput,
): SeasonResultReceipt;
export function recordSeasonMatch(
  state: SeasonState,
  modeId: string,
  matchId: string,
  homeScore: SeasonScoreInput,
  awayScore: SeasonScoreInput,
): SeasonResultReceipt;
export function recordSeasonMatch(
  state: SeasonState,
  modeOrMatchId: string,
  matchOrHomeScore: SeasonScoreInput,
  homeOrAwayScore: SeasonScoreInput,
  maybeAwayScore?: SeasonScoreInput,
): SeasonResultReceipt {
  if (maybeAwayScore === undefined) {
    return recordSeasonResult(state, modeOrMatchId, matchOrHomeScore, homeOrAwayScore);
  }
  return recordSeasonResult(state, modeOrMatchId, matchOrHomeScore as string, homeOrAwayScore, maybeAwayScore);
}
