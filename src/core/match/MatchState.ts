import type { TeamId } from "../../data/types";

export type CameraMode = "broadcast" | "follow";

export type MatchStatus = "kickoff" | "playing" | "paused" | "goal" | "fullTime";

export type MatchEventType =
  | "goal"
  | "pass"
  | "shot"
  | "tackle"
  | "possession"
  | "camera"
  | "restart"
  | "fullTime";

export type MatchEvent = {
  type: MatchEventType;
  time: number;
  description: string;
};

export type MatchState = {
  duration: number;
  elapsed: number;
  score: Record<TeamId, number>;
  status: MatchStatus;
  activePlayerId: string | null;
  ballOwnerId: string | null;
  cameraMode: CameraMode;
  events: MatchEvent[];
};

export function createInitialMatchState(duration: number): MatchState {
  return {
    duration,
    elapsed: 0,
    score: {
      home: 0,
      away: 0
    },
    status: "kickoff",
    activePlayerId: null,
    ballOwnerId: null,
    cameraMode: "broadcast",
    events: []
  };
}

export function resetMatchState(state: MatchState) {
  state.elapsed = 0;
  state.score.home = 0;
  state.score.away = 0;
  state.status = "kickoff";
  state.activePlayerId = null;
  state.ballOwnerId = null;
  state.cameraMode = "broadcast";
  state.events = [];
}

export function setMatchStatus(state: MatchState, status: MatchStatus) {
  state.status = status;
}

export function startMatchIfNeeded(state: MatchState) {
  if (state.status === "kickoff") {
    state.status = "playing";
  }
}

export function advanceMatchClock(state: MatchState, deltaSeconds: number) {
  if (deltaSeconds <= 0 || state.status === "paused" || state.status === "goal" || state.status === "fullTime") {
    return state.elapsed;
  }

  state.elapsed = Math.min(state.duration, state.elapsed + deltaSeconds);
  return state.elapsed;
}

export function isMatchClockExpired(state: MatchState) {
  return state.elapsed >= state.duration;
}

export function setFullTime(state: MatchState) {
  state.elapsed = state.duration;
  state.status = "fullTime";
}

export function setActivePlayerId(state: MatchState, playerId: string | null) {
  state.activePlayerId = playerId;
}

export function setBallOwnerId(state: MatchState, playerId: string | null) {
  state.ballOwnerId = playerId;
}

export function addMatchEvent(state: MatchState, type: MatchEventType, description: string) {
  state.events.unshift({
    type,
    time: state.elapsed,
    description
  });
  state.events = state.events.slice(0, 50);
}

export function addGoal(state: MatchState, team: TeamId) {
  state.score[team] += 1;
  state.status = "goal";
}

export function scoreText(state: MatchState) {
  return `${state.score.home} - ${state.score.away}`;
}

export function compactScoreText(state: MatchState) {
  return `${state.score.home}-${state.score.away}`;
}

export function clockText(state: MatchState) {
  const displayTime = Math.min(state.duration, state.elapsed);
  const mins = Math.floor(displayTime / 60);
  const secs = Math.floor(displayTime % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function switchCameraMode(state: MatchState) {
  state.cameraMode = state.cameraMode === "broadcast" ? "follow" : "broadcast";
  return state.cameraMode;
}

export function isMatchEnded(state: MatchState) {
  return state.status === "fullTime";
}
