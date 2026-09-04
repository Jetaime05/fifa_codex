import type { TeamId } from "../../data/types";

export type MatchStatEvent = "passes" | "completedPasses" | "shots" | "goals" | "tackles" | "fouls" | "yellowCards" | "redCards" | "corners" | "throwIns" | "goalKicks" | "saves" | "clearances";
export type TeamMatchStats = Record<MatchStatEvent, number> & { possessionSeconds: number };
export type MatchStatsSnapshot = Record<TeamId, TeamMatchStats & { possessionPercent: number; passAccuracyPercent: number }>;

function emptyTeamStats(): TeamMatchStats {
  return { passes: 0, completedPasses: 0, shots: 0, goals: 0, tackles: 0, fouls: 0,
    yellowCards: 0, redCards: 0, corners: 0, throwIns: 0, goalKicks: 0, saves: 0, clearances: 0, possessionSeconds: 0 };
}

/** Match totals survive goals and dead balls. Only reset for a new match. */
export class MatchStatsSystem {
  private totals: Record<TeamId, TeamMatchStats> = { home: emptyTeamStats(), away: emptyTeamStats() };

  record(team: TeamId, event: MatchStatEvent, amount = 1) {
    if (Number.isFinite(amount) && amount > 0) this.totals[team][event] += Math.floor(amount);
  }

  /** Caller supplies only live playing time; null means a loose/unowned ball. */
  addPossession(team: TeamId | null, dt: number) {
    if (team !== null && Number.isFinite(dt) && dt > 0) this.totals[team].possessionSeconds += dt;
  }

  reset() {
    this.totals = { home: emptyTeamStats(), away: emptyTeamStats() };
  }

  get snapshot(): MatchStatsSnapshot {
    const totalPossession = this.totals.home.possessionSeconds + this.totals.away.possessionSeconds;
    const makeTeamSnapshot = (team: TeamId) => {
      const stats = this.totals[team];
      return {
        ...stats,
        possessionPercent: totalPossession > 0 ? stats.possessionSeconds / totalPossession * 100 : 50,
        passAccuracyPercent: stats.passes > 0 ? Math.min(100, stats.completedPasses / stats.passes * 100) : 0
      };
    };
    return { home: makeTeamSnapshot("home"), away: makeTeamSnapshot("away") };
  }
}
