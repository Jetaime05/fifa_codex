import * as THREE from "three";
import type { DuelConfig } from "./GameplayConfig";
import { DEFAULT_DUEL_CONFIG } from "./GameplayConfig";
import type { SimPlayer } from "./types";

export type DuelAction = "poke" | "shoulder" | "slide";

export type DuelInput = {
  challenger: SimPlayer;
  owner: SimPlayer;
  ballPosition: THREE.Vector3;
  now: number;
  action?: DuelAction;
  /** A deterministic sample supplied by the simulation/replay, not per frame. */
  random?: number;
  config?: Partial<DuelConfig>;
};

export type ShieldingAssessment = {
  shielded: boolean;
  coverage: number;
  approachDot: number;
  lateralDistance: number;
  ballDistanceFromOwner: number;
  reason: "front-access" | "body-between" | "ball-too-far" | "no-separation";
};

export type DuelEligibility = {
  eligible: boolean;
  reason:
    | "eligible"
    | "same-team"
    | "cooldown"
    | "out-of-reach"
    | "ball-protected"
    | "recovery";
  distanceToBall: number;
  challengeReach: number;
  cooldownRemaining: number;
  shielding: ShieldingAssessment;
};

export type DuelResult = {
  status: "won" | "lost" | "missed" | "cooldown" | "protected";
  challengerId: string;
  ownerId: string;
  action: DuelAction;
  timestamp: number;
  eligibility: DuelEligibility;
  challengerScore: number;
  ownerScore: number;
  ballImpulse: THREE.Vector3;
  recoveryUntil: number;
  cooldownUntil: number;
  staggeredPlayerId: string | null;
  foulRisk: number;
};

const EPSILON = 0.0001;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const horizontal = (value: THREE.Vector3) => new THREE.Vector3(value.x, 0, value.z);

const mergedConfig = (overrides?: Partial<DuelConfig>): DuelConfig => ({
  ...DEFAULT_DUEL_CONFIG,
  ...overrides
});

const normalizedOr = (value: THREE.Vector3, fallback: THREE.Vector3) => {
  const result = horizontal(value);
  if (result.lengthSq() <= EPSILON) return horizontal(fallback).normalize();
  return result.normalize();
};

function playerForward(player: SimPlayer) {
  const velocity = horizontal(player.velocity);
  if (velocity.lengthSq() > EPSILON) return velocity.normalize();
  const yaw = Number.isFinite(player.mesh.rotation.y) ? player.mesh.rotation.y : 0;
  return new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).normalize();
}

/**
 * Measures whether an opponent is approaching the ball through the owner's
 * body. The test uses the ball-owner line and a lateral body radius, so a
 * tackle from the back cannot simply win because the players are close.
 */
export function assessShielding(
  owner: SimPlayer,
  challenger: SimPlayer,
  ballPosition: THREE.Vector3,
  config: Partial<DuelConfig> = {}
): ShieldingAssessment {
  const tuning = mergedConfig(config);
  const toBall = horizontal(ballPosition.clone().sub(owner.position));
  const toChallenger = horizontal(challenger.position.clone().sub(owner.position));
  const ballDistance = toBall.length();
  const challengerDistance = toChallenger.length();
  if (ballDistance <= EPSILON || challengerDistance <= EPSILON) {
    return {
      shielded: false, coverage: 0, approachDot: 0,
      lateralDistance: 0, ballDistanceFromOwner: ballDistance,
      reason: "no-separation"
    };
  }
  if (ballDistance > tuning.ballReach + tuning.bodyContactRadius) {
    return {
      shielded: false,
      coverage: 0,
      approachDot: toChallenger.clone().normalize().dot(toBall.clone().normalize()),
      lateralDistance: 0,
      ballDistanceFromOwner: ballDistance,
      reason: "ball-too-far"
    };
  }
  const ballDirection = toBall.clone().normalize();
  const approachDot = toChallenger.clone().normalize().dot(ballDirection);
  const along = toChallenger.dot(ballDirection);
  const lateralDistance = Math.abs(toChallenger.x * ballDirection.z - toChallenger.z * ballDirection.x);
  const bodyBetween = along < 0 && lateralDistance < tuning.bodyContactRadius * 0.9;
  const coverage = clamp(
    (bodyBetween ? (1 - lateralDistance / Math.max(tuning.bodyContactRadius, EPSILON)) : 0) *
      tuning.shieldStrength,
    0,
    1
  );
  return {
    shielded: bodyBetween && coverage >= 0.25,
    coverage,
    approachDot,
    lateralDistance,
    ballDistanceFromOwner: ballDistance,
    reason: bodyBetween ? "body-between" : "front-access"
  };
}

export function assessDuelEligibility(input: DuelInput): DuelEligibility {
  const tuning = mergedConfig(input.config);
  const now = Number.isFinite(input.now) ? input.now : 0;
  const cooldownRemaining = Math.max(0, input.challenger.cooldown);
  const distanceToBall = horizontal(input.challenger.position.clone().sub(input.ballPosition)).length();
  const shielding = assessShielding(input.owner, input.challenger, input.ballPosition, tuning);
  if (input.challenger.team === input.owner.team) {
    return { eligible: false, reason: "same-team", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  if (cooldownRemaining > 0) {
    return { eligible: false, reason: "cooldown", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  const challengerRecoveryUntil = (input.challenger as SimPlayer & { duelRecoveryUntil?: number }).duelRecoveryUntil ?? 0;
  if (challengerRecoveryUntil > now) {
    return { eligible: false, reason: "recovery", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  const recoveryUntil = (input.owner as SimPlayer & { duelRecoveryUntil?: number }).duelRecoveryUntil ?? 0;
  if (recoveryUntil > now) {
    return { eligible: false, reason: "recovery", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  if (distanceToBall > tuning.challengeReach || shielding.ballDistanceFromOwner > tuning.ballReach + tuning.bodyContactRadius) {
    return { eligible: false, reason: "out-of-reach", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  if (shielding.shielded) {
    return { eligible: false, reason: "ball-protected", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
  }
  return { eligible: true, reason: "eligible", distanceToBall, challengeReach: tuning.challengeReach, cooldownRemaining, shielding };
}

/**
 * Resolve exactly one challenge event. Callers should invoke this on a user
 * tackle/AI tackle edge, then wait for the returned cooldown before asking
 * again. No random sample is consumed while merely checking eligibility.
 */
export function resolveDuel(input: DuelInput): DuelResult {
  const tuning = mergedConfig(input.config);
  const now = Number.isFinite(input.now) ? input.now : 0;
  const action = input.action ?? "poke";
  const eligibility = assessDuelEligibility(input);
  const base = {
    challengerId: input.challenger.id,
    ownerId: input.owner.id,
    action,
    timestamp: now,
    eligibility,
    challengerScore: 0,
    ownerScore: 0,
    ballImpulse: new THREE.Vector3(),
    recoveryUntil: now,
    cooldownUntil: now,
    staggeredPlayerId: null,
    foulRisk: 0
  };
  if (!eligibility.eligible) {
    const status = eligibility.reason === "cooldown" || eligibility.reason === "recovery"
      ? "cooldown"
      : eligibility.reason === "ball-protected" ? "protected" : "missed";
    return { ...base, status };
  }

  const challengeDirection = normalizedOr(
    input.ballPosition.clone().sub(input.challenger.position),
    playerForward(input.challenger)
  );
  const challengerFacing = playerForward(input.challenger);
  const facingQuality = clamp((challengerFacing.dot(challengeDirection) + 1) * 0.5, 0, 1);
  const distanceQuality = clamp(1 - eligibility.distanceToBall / Math.max(tuning.challengeReach, EPSILON), 0, 1);
  const random = clamp(Number.isFinite(input.random ?? NaN) ? input.random! : 0.5, 0, 1);
  const challengerScore = input.challenger.stats.defending * 0.45 +
    input.challenger.stats.physical * 0.28 +
    input.challenger.stats.pace * 0.08 + facingQuality * 15 + distanceQuality * 18 + random * 8;
  const shieldingPenalty = eligibility.shielding.coverage * tuning.shieldStrength * 20;
  const actionModifier = action === "shoulder" ? 1.04 : action === "slide" ? 1.12 : 1;
  const adjustedChallengerScore = challengerScore * actionModifier;
  const ownerScore = input.owner.stats.dribbling * 0.46 +
    input.owner.stats.physical * 0.24 +
    input.owner.stats.pace * 0.06 + shieldingPenalty + (1 - distanceQuality) * 8;
  const won = adjustedChallengerScore > ownerScore;
  const cooldownUntil = now + tuning.cooldown * (action === "slide" ? 1.3 : 1);
  const recoveryUntil = won ? now + tuning.recovery : now + tuning.recovery * 0.55;
  const contactNormal = normalizedOr(
    input.ballPosition.clone().sub(input.owner.position),
    challengeDirection
  );
  const ballImpulse = contactNormal.multiplyScalar(
    won ? tuning.tacklePower * (0.72 + distanceQuality * 0.32) : tuning.tacklePower * 0.18
  );
  const foulRisk = action === "slide"
    ? clamp((1 - facingQuality) * 0.55 + (eligibility.shielding.approachDot < -0.3 ? tuning.foulRiskFromBehind : 0), 0, 1)
    : clamp((1 - facingQuality) * 0.18, 0, 1);
  return {
    ...base,
    status: won ? "won" : "lost",
    challengerScore: adjustedChallengerScore,
    ownerScore,
    ballImpulse,
    recoveryUntil,
    cooldownUntil,
    staggeredPlayerId: won ? input.owner.id : input.challenger.id,
    foulRisk
  };
}

/** Stateful cooldown registry for callers whose SimPlayer objects are immutable snapshots. */
export class DuelSystem {
  readonly config: DuelConfig;
  private readonly cooldowns = new Map<string, number>();
  private readonly recoveries = new Map<string, number>();

  constructor(config: Partial<DuelConfig> = {}) {
    this.config = mergedConfig(config);
  }

  eligibility(input: Omit<DuelInput, "config">) {
    const challenger = { ...input.challenger, cooldown: Math.max(input.challenger.cooldown, (this.cooldowns.get(input.challenger.id) ?? 0) - input.now) };
    const owner = { ...input.owner } as SimPlayer & { duelRecoveryUntil?: number };
    (challenger as SimPlayer & { duelRecoveryUntil?: number }).duelRecoveryUntil = this.recoveries.get(challenger.id) ?? 0;
    owner.duelRecoveryUntil = Math.max((owner as { duelRecoveryUntil?: number }).duelRecoveryUntil ?? 0, (this.recoveries.get(owner.id) ?? 0));
    return assessDuelEligibility({ ...input, challenger, owner, config: this.config });
  }

  resolve(input: Omit<DuelInput, "config">) {
    const challenger = { ...input.challenger, cooldown: Math.max(input.challenger.cooldown, (this.cooldowns.get(input.challenger.id) ?? 0) - input.now) };
    const owner = { ...input.owner } as SimPlayer & { duelRecoveryUntil?: number };
    (challenger as SimPlayer & { duelRecoveryUntil?: number }).duelRecoveryUntil = this.recoveries.get(challenger.id) ?? 0;
    owner.duelRecoveryUntil = this.recoveries.get(owner.id) ?? 0;
    const result = resolveDuel({ ...input, challenger, owner, config: this.config });
    if (result.cooldownUntil > input.now) this.cooldowns.set(input.challenger.id, result.cooldownUntil);
    if (result.recoveryUntil > input.now && result.staggeredPlayerId) this.recoveries.set(result.staggeredPlayerId, result.recoveryUntil);
    return result;
  }

  reset() {
    this.cooldowns.clear();
    this.recoveries.clear();
  }
}
