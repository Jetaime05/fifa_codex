import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimPlayer } from "./types";

/** Prototype rules, intentionally not a complete implementation of the Laws of the Game. */
export type AdvancedRuleOptions = {
  offside: boolean;
  advantage: boolean;
  injuryTime: boolean;
  substitutions: boolean;
};
export const DEFAULT_ADVANCED_RULE_OPTIONS: Readonly<AdvancedRuleOptions> = Object.freeze({
  offside: false, advantage: false, injuryTime: false, substitutions: false
});
export type RefereeRestart = {
  kind: "freeKick" | "penalty";
  team: TeamId;
  position: THREE.Vector3;
  reason: string;
};
export type RefereeCard = "yellow" | "secondYellow" | "red" | null;
export type DisciplineRecord = { yellows: number; reds: number; fouls: number };
export type TackleAssessmentInput = {
  offender: Pick<SimPlayer, "id" | "team" | "position">;
  victim: Pick<SimPlayer, "id" | "team" | "position">;
  position?: THREE.Vector3;
  wonBall?: boolean;
  fromBehind?: boolean;
  relativeSpeed?: number;
  /** Optional normalized dangerous-contact severity supplied by collision physics. */
  severity?: number;
  possessionTeam?: TeamId | null;
};
export type TackleAssessment = {
  foul: boolean;
  card: RefereeCard;
  restart: RefereeRestart | null;
  advantage: boolean;
  reason: string;
};
type OffsideSnapshot = { team: TeamId; candidates: Map<string, THREE.Vector3> };
type PendingAdvantage = { restart: RefereeRestart; remaining: number };
type RefereePlayer = Pick<SimPlayer, "id" | "team" | "position">;
const opponent = (team: TeamId): TeamId => team === "home" ? "away" : "home";
const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);

export class RefereeSystem {
  readonly discipline = new Map<string, DisciplineRecord>();
  readonly dismissedIds = new Set<string>();
  readonly options: AdvancedRuleOptions;
  private readonly bounds: FieldBounds;
  private readonly random: () => number;
  private attackDirections: Record<TeamId, 1 | -1>;
  private offsideSnapshot: OffsideSnapshot | null = null;
  private pendingAdvantage: PendingAdvantage | null = null;
  private stoppageSeconds = 0;

  constructor(config: {
    bounds: FieldBounds;
    options?: Partial<AdvancedRuleOptions>;
    random?: () => number;
    attackDirections?: Record<TeamId, 1 | -1>;
  }) {
    this.bounds = config.bounds;
    this.options = { ...DEFAULT_ADVANCED_RULE_OPTIONS, ...config.options };
    this.random = config.random ?? (() => 0.5);
    this.attackDirections = config.attackDirections ?? { home: 1, away: -1 };
  }

  setOptions(options: Partial<AdvancedRuleOptions>) {
    Object.assign(this.options, options);
    if (!this.options.offside) this.offsideSnapshot = null;
    if (!this.options.advantage) this.pendingAdvantage = null;
    if (!this.options.injuryTime) this.stoppageSeconds = 0;
  }

  setAttackDirections(directions: Record<TeamId, 1 | -1>) {
    this.attackDirections = { ...directions };
    this.offsideSnapshot = null;
  }

  reset() {
    this.discipline.clear();
    this.dismissedIds.clear();
    this.offsideSnapshot = null;
    this.pendingAdvantage = null;
    this.stoppageSeconds = 0;
  }

  assessTackle(input: TackleAssessmentInput): TackleAssessment {
    const clean: TackleAssessment = { foul: false, card: null, restart: null, advantage: false, reason: "Legal challenge" };
    if (input.offender.team === input.victim.team || this.dismissedIds.has(input.offender.id)) return clean;
    const speed = clamp01((input.relativeSpeed ?? 0) / 18);
    const severity = clamp01(input.severity ?? (0.15 + speed * 0.42 + (input.fromBehind ? 0.38 : 0) - (input.wonBall ? 0.3 : 0)));
    const foulChance = input.wonBall && !input.fromBehind && severity < 0.6 ? 0 : clamp01(0.14 + severity * 0.85);
    if (severity < 0.9 && (foulChance === 0 || this.random() >= foulChance)) return clean;

    const record = this.discipline.get(input.offender.id) ?? { yellows: 0, reds: 0, fouls: 0 };
    record.fouls += 1;
    let card: RefereeCard = null;
    if (severity >= 0.9) {
      card = "red";
      record.reds += 1;
    } else if (severity >= 0.6) {
      record.yellows += 1;
      card = record.yellows >= 2 ? "secondYellow" : "yellow";
      if (card === "secondYellow") record.reds += 1;
    }
    if (record.reds > 0) this.dismissedIds.add(input.offender.id);
    this.discipline.set(input.offender.id, record);
    const restart = this.foulRestart(input.offender.team, input.position ?? input.victim.position);
    const advantage = this.options.advantage && restart.kind !== "penalty" && input.possessionTeam === input.victim.team;
    if (advantage) {
      // Preserve the earliest unfulfilled advantage if another challenge occurs.
      this.pendingAdvantage ??= { restart, remaining: 3 };
    } else {
      this.pendingAdvantage = null;
      this.offsideSnapshot = null;
    }
    return { foul: true, card, restart: advantage ? null : restart, advantage, reason: `${input.fromBehind ? "Late challenge from behind" : "Illegal contact"}${card ? `; ${card}` : ""}${advantage ? "; advantage" : ""}` };
  }

  private foulRestart(defendingTeam: TeamId, location: THREE.Vector3): RefereeRestart {
    const defendingGoalDirection = -this.attackDirections[defendingTeam];
    const depth = this.bounds.halfLength * (16.5 / 52.5);
    const halfAreaWidth = this.bounds.halfWidth * (20.16 / 34);
    const goalward = location.z * defendingGoalDirection;
    const penalty = Math.abs(location.x) <= halfAreaWidth && goalward >= this.bounds.halfLength - depth && goalward <= this.bounds.halfLength;
    return {
      kind: penalty ? "penalty" : "freeKick",
      team: opponent(defendingTeam),
      reason: penalty ? "Penalty: illegal contact inside penalty area" : "Free kick: illegal contact",
      position: penalty
        ? new THREE.Vector3(0, 0, defendingGoalDirection * this.bounds.halfLength * (1 - 11 / 52.5))
        : new THREE.Vector3(THREE.MathUtils.clamp(location.x, -this.bounds.halfWidth, this.bounds.halfWidth), 0, THREE.MathUtils.clamp(location.z, -this.bounds.halfLength, this.bounds.halfLength))
    };
  }

  /** Call only when a teammate releases a pass, before any player movement that step. */
  snapshotPass(input: { passer: RefereePlayer; players: readonly RefereePlayer[]; ballPosition: THREE.Vector3; restartKind?: string }) {
    this.offsideSnapshot = null;
    if (!this.options.offside || ["throwIn", "corner", "goalKick"].includes(input.restartKind ?? "")) return;
    const direction = this.attackDirections[input.passer.team];
    const defenders = input.players.filter(player => player.team !== input.passer.team && !this.dismissedIds.has(player.id))
      .map(player => player.position.z * direction).sort((a, b) => b - a);
    // Fewer than two opponents leave only the ball and halfway line as limits.
    const secondLast = defenders[1] ?? -this.bounds.halfLength;
    const line = Math.max(secondLast, input.ballPosition.z * direction, 0);
    const candidates = new Map<string, THREE.Vector3>();
    for (const player of input.players) {
      if (player.team === input.passer.team && player.id !== input.passer.id && !this.dismissedIds.has(player.id) && player.position.z * direction > line + 1e-6) {
        candidates.set(player.id, player.position.clone());
      }
    }
    this.offsideSnapshot = { team: input.passer.team, candidates };
  }

  /** Passive offside is not called: a captured candidate must subsequently touch the ball. */
  onTouch(player: RefereePlayer): RefereeRestart | null {
    if (!this.options.offside || !this.offsideSnapshot) return null;
    const snapshot = this.offsideSnapshot;
    if (player.team !== snapshot.team) { this.offsideSnapshot = null; return null; }
    const position = snapshot.candidates.get(player.id);
    this.offsideSnapshot = null;
    if (!position) return null;
    this.pendingAdvantage = null;
    return { kind: "freeKick", team: opponent(player.team), position: new THREE.Vector3(position.x, 0, position.z), reason: "Offside: receiver beyond ball and second-last defender at pass release" };
  }

  /** Loose ball keeps advantage pending; opponent possession recalls the original foul. */
  update(dt: number, possessionTeam: TeamId | null): RefereeRestart | null {
    const pending = this.pendingAdvantage;
    if (!pending) return null;
    if (possessionTeam !== null && possessionTeam !== pending.restart.team) {
      this.pendingAdvantage = null;
      this.offsideSnapshot = null;
      return pending.restart;
    }
    pending.remaining -= Math.max(0, dt);
    if (pending.remaining <= 0) {
      this.pendingAdvantage = null;
      if (possessionTeam !== pending.restart.team) return pending.restart;
    }
    return null;
  }

  clearPending() { this.pendingAdvantage = null; this.offsideSnapshot = null; }
  onGoal() { this.clearPending(); }
  onDeadBall() { this.clearPending(); }
  get hasPendingAdvantage() { return this.pendingAdvantage !== null; }
  recordStoppage(seconds: number) {
    if (this.options.injuryTime && Number.isFinite(seconds)) this.stoppageSeconds += Math.max(0, seconds);
  }
  consumeStoppageSeconds() {
    const seconds = this.stoppageSeconds;
    this.stoppageSeconds = 0;
    return seconds;
  }
  canSubstitute(phase: string) {
    return this.options.substitutions && (phase === "deadBall" || phase === "halfTime" || phase === "halftime");
  }
  debugSnapshot() {
    return {
      options: { ...this.options },
      discipline: Object.fromEntries([...this.discipline.entries()].map(([id, record]) => [id, { ...record }])),
      dismissedIds: [...this.dismissedIds],
      pendingAdvantage: this.pendingAdvantage ? {
        team: this.pendingAdvantage.restart.team,
        remaining: this.pendingAdvantage.remaining,
        reason: this.pendingAdvantage.restart.reason
      } : null,
      offsideCandidateIds: [...(this.offsideSnapshot?.candidates.keys() ?? [])],
      stoppageSeconds: this.stoppageSeconds
    };
  }
}
