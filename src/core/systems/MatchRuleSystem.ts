import type { TeamId } from "../../data/types";
import { addGoal, addMatchEvent, advanceMatchClock, isMatchClockExpired, setFullTime } from "../match/MatchState";
import type { MatchState } from "../match/MatchState";

export class MatchRuleSystem {
  private goalLocked = false;
  constructor(private readonly state: MatchState) {}
  updateClock(dt: number) { advanceMatchClock(this.state, dt); if (isMatchClockExpired(this.state)) setFullTime(this.state); }
  scoreGoal(team: TeamId, description: string | (() => string) = "Goal") {
    if (this.goalLocked || this.state.status === "fullTime") return false;
    this.goalLocked = true;
    addGoal(this.state, team);
    addMatchEvent(this.state, "goal", typeof description === "function" ? description() : description);
    return true;
  }
  resetGoalLock() { this.goalLocked = false; }
  get isGoalLocked() { return this.goalLocked; }
}

export function isGoalCrossed(positionZ: number, positionX: number, positionY: number, halfLength: number, goalWidth: number, depth = 0.8) {
  return Math.abs(positionX) < goalWidth / 2 && positionY < 4.8 && Math.abs(positionZ) > halfLength + depth;
}
