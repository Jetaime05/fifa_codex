import {
  advanceMatchClock,
  resetMatchState,
  setFullTime,
  type MatchState,
  type MatchStatus
} from "../match/MatchState";

export type KickoffReason = "start" | "goal" | "halftime";
export type MatchFlowEvent =
  | { type: "kickoffSetup"; reason: "goal" | "halftime" }
  | { type: "kickoffReady"; reason: KickoffReason }
  | { type: "restartReady" }
  | { type: "halftime" }
  | { type: "fullTime" };

export type MatchFlowConfig = {
  kickoffSeconds: number;
  goalSeconds: number;
  halftimeSeconds: number;
  restartSeconds: number;
  halftimeEnabled: boolean;
  stoppageTimeEnabled: boolean;
  maxStoppageSeconds: number;
};

const DEFAULT_CONFIG: MatchFlowConfig = {
  kickoffSeconds: 3,
  goalSeconds: 0.9,
  halftimeSeconds: 4,
  restartSeconds: 2,
  halftimeEnabled: true,
  stoppageTimeEnabled: false,
  maxStoppageSeconds: 30
};

/** Owns the match clock and transitions; scene/rules own placement and ball release. */
export class MatchFlowSystem {
  private readonly config: MatchFlowConfig;
  private remaining: number;
  private resumeStatus: Exclude<MatchStatus, "paused"> | null = null;
  private kickoffReason: KickoffReason = "start";
  private currentPeriod: 1 | 2 = 1;
  private firstHalfAddedTime = 0;

  constructor(private readonly state: MatchState, config: Partial<MatchFlowConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    for (const key of ["kickoffSeconds", "goalSeconds", "halftimeSeconds", "restartSeconds", "maxStoppageSeconds"] as const) {
      const value = this.config[key];
      this.config[key] = Number.isFinite(value) ? Math.max(0, value) : DEFAULT_CONFIG[key];
    }
    this.remaining = state.status === "kickoff" ? this.config.kickoffSeconds : 0;
  }

  update(dt: number): MatchFlowEvent[] {
    if (!Number.isFinite(dt) || dt < 0 || this.state.status === "paused" || this.state.status === "fullTime") return [];
    if (this.state.status === "playing") {
      const halfEnd = this.state.duration / 2 + this.firstHalfAddedTime;
      const nextBoundary = this.config.halftimeEnabled && this.currentPeriod === 1
        ? halfEnd
        : this.state.duration + this.state.stoppageTime;
      advanceMatchClock(this.state, Math.min(dt, Math.max(0, nextBoundary - this.state.elapsed)));
      if (this.state.elapsed < nextBoundary) return [];
      if (this.config.halftimeEnabled && this.currentPeriod === 1) {
        this.currentPeriod = 2;
        this.state.status = "halftime";
        this.remaining = this.config.halftimeSeconds;
        return [{ type: "halftime" }];
      }
      setFullTime(this.state);
      this.remaining = 0;
      return [{ type: "fullTime" }];
    }

    // Deliberately do not carry leftover dt across transitions: a long frame must
    // never consume a countdown and simulate unseen play or skip a restart.
    this.remaining = Math.max(0, this.remaining - dt);
    if (this.remaining > 0) return [];
    if (this.state.status === "goal" || this.state.status === "halftime") {
      this.kickoffReason = this.state.status === "goal" ? "goal" : "halftime";
      this.state.status = "kickoff";
      this.remaining = this.config.kickoffSeconds;
      return [{ type: "kickoffSetup", reason: this.kickoffReason }];
    }
    if (this.state.status === "kickoff") {
      this.state.status = "playing";
      return [{ type: "kickoffReady", reason: this.kickoffReason }];
    }
    if (this.state.status === "restart") {
      this.state.status = "playing";
      return [{ type: "restartReady" }];
    }
    return [];
  }

  /** Call after scoreGoal; never modifies the score itself. */
  beginGoal() {
    if (this.state.status !== "playing" && this.state.status !== "goal") return false;
    this.state.status = "goal";
    this.remaining = this.config.goalSeconds;
    return true;
  }

  beginRestart(seconds = this.config.restartSeconds) {
    if (this.state.status !== "playing") return false;
    this.state.status = "restart";
    this.remaining = Number.isFinite(seconds) ? Math.max(0, seconds) : this.config.restartSeconds;
    return true;
  }

  pause() {
    if (this.state.status === "paused" || this.state.status === "fullTime") return false;
    this.resumeStatus = this.state.status;
    this.state.status = "paused";
    return true;
  }

  resume() {
    if (this.state.status !== "paused" || this.resumeStatus === null) return false;
    this.state.status = this.resumeStatus;
    this.resumeStatus = null;
    return true;
  }

  reset() {
    resetMatchState(this.state);
    this.remaining = this.config.kickoffSeconds;
    this.resumeStatus = null;
    this.currentPeriod = 1;
    this.firstHalfAddedTime = 0;
    this.kickoffReason = "start";
  }

  addStoppageTime(seconds: number) {
    if (!this.config.stoppageTimeEnabled || this.state.status === "fullTime" || !Number.isFinite(seconds) || seconds <= 0) return;
    const awardedSeconds = Math.min(seconds, Math.max(0, this.config.maxStoppageSeconds - this.state.stoppageTime));
    this.state.stoppageTime += awardedSeconds;
    if (this.currentPeriod === 1 && this.config.halftimeEnabled) this.firstHalfAddedTime += awardedSeconds;
  }

  setStoppageTimeEnabled(enabled: boolean) {
    // Already awarded time remains owed. Switching the option off only stops
    // future awards, so a mid-match toggle cannot move the clock backwards.
    this.config.stoppageTimeEnabled = enabled;
  }

  get debugSnapshot() {
    return {
      status: this.state.status,
      period: this.currentPeriod,
      countdownSeconds: this.remaining,
      resumeStatus: this.resumeStatus,
      kickoffReason: this.kickoffReason,
      elapsed: this.state.elapsed,
      duration: this.state.duration,
      stoppageTime: this.state.stoppageTime,
      stoppageTimeEnabled: this.config.stoppageTimeEnabled,
      endAt: this.state.duration + this.state.stoppageTime,
      halftimeAt: this.state.duration / 2 + this.firstHalfAddedTime
    };
  }
}
