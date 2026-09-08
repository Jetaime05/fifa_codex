import * as THREE from "three";
import type { SimBall, SimPlayer } from "./types";

/**
 * The dribbling system owns the small, readable ball-to-foot relationship
 * while a player has possession. It intentionally does not decide ownership:
 * `PossessionSystem`/the match orchestrator still owns that state transition.
 */
export type DribblingConfig = {
  /** Distance from the player at maximum dribbling rating. */
  minAttachmentDistance: number;
  /** Distance from the player at minimum dribbling rating. */
  maxAttachmentDistance: number;
  attachmentHeight: number;
  controlLerpRate: number;
  /** Speed above which sprint touches become risky. */
  highSpeedThreshold: number;
  /**
   * Maximum sprint loose-touch probability per simulated second at the
   * high-speed limit. It is converted to a per-step chance using `dt`.
   */
  sprintTouchRisk: number;
  /** Extra forward distance for a loose touch. */
  looseTouchDistance: number;
  /** Horizontal speed applied when the ball is nudged loose. */
  looseTouchSpeed: number;
  /** Selects the legacy visual attachment or discrete physical touches. */
  mode: "legacy-attachment" | "impulse";
  /** Normal touch interval at walking speed. */
  touchInterval: number;
  /** Minimum interval while sprinting. */
  sprintTouchInterval: number;
  /** Fraction of the target correction converted into a touch impulse. */
  touchCorrection: number;
  /** Forward speed added by each controlled touch. */
  touchForwardImpulse: number;
  /** Maximum horizontal touch impulse for a single contact. */
  maxTouchImpulse: number;
  /** Additional horizontal distance a player can reach for a touch. */
  touchReachMargin: number;
  /** Per-touch loose-ball chance at the configured high-speed limit. */
  touchLossPerContact: number;
};

export const DEFAULT_DRIBBLING_CONFIG: DribblingConfig = {
  minAttachmentDistance: 0.82,
  maxAttachmentDistance: 1.4,
  attachmentHeight: 0.55,
  controlLerpRate: 18,
  highSpeedThreshold: 8.8,
  sprintTouchRisk: 0.64,
  looseTouchDistance: 1.15,
  looseTouchSpeed: 3.6,
  mode: "legacy-attachment",
  touchInterval: 0.23,
  sprintTouchInterval: 0.16,
  touchCorrection: 0.68,
  touchForwardImpulse: 1.05,
  maxTouchImpulse: 12,
  touchReachMargin: 0.92,
  touchLossPerContact: 0.28
};

export type PlayerForwardResolver = (player: SimPlayer) => THREE.Vector3;

export type DribblingInput = {
  player: SimPlayer;
  ball: SimBall;
  dt: number;
  /** Either name is accepted so keyboard/touch adapters can be explicit. */
  sprint?: boolean;
  isSprinting?: boolean;
  playerForward?: PlayerForwardResolver;
  /** Injected in tests/replays; defaults to Math.random in the live game. */
  random?: () => number;
  /** Overrides config mode for an orchestrator migration step. */
  mode?: DribblingConfig["mode"];
  /** Simulation clock in seconds; physical touch cadence uses this value. */
  now?: number;
  /** Mutable cadence state owned by DribblingSystem or a replay harness. */
  touchState?: DribbleTouchState;
  config?: Partial<DribblingConfig>;
};

export type DribbleTouchState = {
  nextTouchAt: number;
  touchCount: number;
};

export type DribblingResult = {
  attached: boolean;
  looseTouch: boolean;
  shouldReleaseBall: boolean;
  controlDistance: number;
  touchQuality: number;
  attachmentPoint: THREE.Vector3;
  /** Backward-compatible base risk; now explicitly a probability/second. */
  looseTouchRisk: number;
  /** Explicit per-second telemetry for tuning/debug/replay consumers. */
  looseTouchRiskPerSecond: number;
  /** Probability used for this individual simulation step. */
  looseTouchChance: number;
  /** Which attachment model produced this result. */
  mode: DribblingConfig["mode"];
  /** True only when this step applied a foot-to-ball impulse. */
  touchApplied: boolean;
  /** Physical impulse added to the ball on this touch, if any. */
  touchImpulse: THREE.Vector3;
  /** Cadence metadata for deterministic animation/contact synchronization. */
  nextTouchAt: number;
  touchCount: number;
  /** In impulse mode the ball remains free between contacts. */
  ballContinuesBetweenTouches: boolean;
};

/**
 * Shielding is deliberately a placeholder in Phase 2. The contract exposes
 * the information a future tackle/duel system needs, while guaranteeing that
 * this function does not move a player, alter ball ownership, or prevent a
 * tackle by itself.
 */
export type ShieldingPlaceholder = {
  status: "placeholder";
  active: boolean;
  ownerId: string;
  opponentId: string | null;
  strength: number;
  contactDirection: THREE.Vector3;
  protectsBall: false;
};

export type ShieldingInput = {
  player: SimPlayer;
  opponent?: SimPlayer | null;
  requested?: boolean;
};

const EPSILON = 0.0001;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const normalizeStat = (value: number) => clamp(value / 100, 0, 1);

const mergeConfig = (config?: Partial<DribblingConfig>): DribblingConfig => ({
  ...DEFAULT_DRIBBLING_CONFIG,
  ...config
});

const defaultPlayerForward: PlayerForwardResolver = (player) => {
  const velocity = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
  if (velocity.lengthSq() > 0.0225) {
    return velocity.normalize();
  }
  return new THREE.Vector3(0, 0, player.team === "home" ? 1 : -1);
};

const safeForward = (player: SimPlayer, resolver?: PlayerForwardResolver) => {
  const value = (resolver ?? defaultPlayerForward)(player).clone();
  value.y = 0;
  if (value.lengthSq() <= EPSILON) {
    return defaultPlayerForward(player);
  }
  return value.normalize();
};

const rightFromForward = (forward: THREE.Vector3) =>
  new THREE.Vector3(forward.z, 0, -forward.x).normalize();

/** Returns the stat-scaled distance at which the player should carry the ball. */
export function getDribbleControlDistance(
  player: SimPlayer,
  sprint = false,
  configOverrides?: Partial<DribblingConfig>
) {
  const config = mergeConfig(configOverrides);
  const dribbling = normalizeStat(player.stats.dribbling);
  const base = THREE.MathUtils.lerp(
    config.maxAttachmentDistance,
    config.minAttachmentDistance,
    dribbling
  );
  // Sprinting deliberately opens the touch up. Better dribblers absorb more
  // of that increase, which makes sprinting useful but less safe than jogging.
  return base + (sprint ? (1 - dribbling) * 0.28 : 0);
}

export function getDribbleAttachmentPoint(
  player: SimPlayer,
  sprint = false,
  playerForward?: PlayerForwardResolver,
  configOverrides?: Partial<DribblingConfig>
) {
  const config = mergeConfig(configOverrides);
  const forward = safeForward(player, playerForward);
  const point = player.position.clone().addScaledVector(
    forward,
    getDribbleControlDistance(player, sprint, config)
  );
  point.y = config.attachmentHeight;
  return point;
}

/**
 * Updates the ball while `player` owns it. In `legacy-attachment` mode this
 * preserves the Phase 2 visual attachment for old callers. In `impulse` mode
 * the system only applies a discrete touch impulse when the cadence is due;
 * BallSystem remains responsible for moving the ball between contacts.
 */
export function updateDribbling({
  player,
  ball,
  dt,
  sprint,
  isSprinting,
  playerForward,
  random = Math.random,
  mode,
  now = 0,
  touchState,
  config: configOverrides
}: DribblingInput): DribblingResult {
  const config = mergeConfig(configOverrides);
  const resolvedMode = mode ?? config.mode;
  const safeDt = Math.max(0, Math.min(dt, 0.25));
  const sprinting = Boolean(sprint ?? isSprinting);
  const dribbling = normalizeStat(player.stats.dribbling);
  const speed = new THREE.Vector3(player.velocity.x, 0, player.velocity.z).length();
  const controlDistance = getDribbleControlDistance(player, sprinting, config);
  const forward = safeForward(player, playerForward);
  const attachmentPoint = player.position.clone().addScaledVector(forward, controlDistance);
  attachmentPoint.y = config.attachmentHeight;

  if (!player.hasBall) {
    return {
      attached: false,
      looseTouch: false,
      shouldReleaseBall: false,
      controlDistance,
      touchQuality: 0,
      attachmentPoint,
      looseTouchRisk: 0,
      looseTouchRiskPerSecond: 0,
      looseTouchChance: 0,
      mode: resolvedMode,
      touchApplied: false,
      touchImpulse: new THREE.Vector3(),
      nextTouchAt: touchState?.nextTouchAt ?? now,
      touchCount: touchState?.touchCount ?? 0,
      ballContinuesBetweenTouches: resolvedMode === "impulse"
    };
  }

  const speedRisk = clamp(
    (speed - config.highSpeedThreshold) / Math.max(config.highSpeedThreshold, EPSILON),
    0,
    1
  );
  const looseTouchRisk = sprinting
    ? clamp(speedRisk * config.sprintTouchRisk * (1 - dribbling * 0.72), 0, 0.98)
    : 0;
  const interval = sprinting ? config.sprintTouchInterval : config.touchInterval;
  const state = touchState ?? { nextTouchAt: now, touchCount: 0 };
  if (!Number.isFinite(state.nextTouchAt)) state.nextTouchAt = now;
  const touchDue = resolvedMode === "impulse" && now + safeDt * 0.5 >= state.nextTouchAt;
  const horizontalBallOffset = ball.position.clone().sub(player.position);
  horizontalBallOffset.y = 0;
  const maxReach = controlDistance + config.touchReachMargin;
  const ballInReach = horizontalBallOffset.length() <= maxReach;
  // Legacy mode retains a frame-rate-independent hazard for old orchestrators.
  const legacyLooseTouchChance = safeDt > 0
    ? 1 - Math.pow(1 - looseTouchRisk, safeDt)
    : 0;
  const contactLossChance = clamp(
    looseTouchRisk * config.touchLossPerContact * (sprinting ? 1 : 0.18),
    0,
    0.98
  );
  const looseTouchChance = resolvedMode === "impulse"
    ? (touchDue ? contactLossChance : 0)
    : legacyLooseTouchChance;
  const roll = looseTouchChance > 0 ? clamp(random(), 0, 1) : 1;
  const looseTouch = roll < looseTouchChance || (resolvedMode === "impulse" && !ballInReach);
  const touchQuality = clamp(
    1 - looseTouchRisk * 0.8 - (1 - dribbling) * 0.16,
    0,
    1
  );

  let touchApplied = false;
  const touchImpulse = new THREE.Vector3();
  if (resolvedMode === "impulse") {
    if (touchDue && ballInReach && !looseTouch) {
      touchApplied = true;
      state.touchCount += 1;
      const target = attachmentPoint.clone();
      const delta = target.sub(ball.position);
      delta.y = 0;
      // Use the fixed touch interval rather than the physics step. This keeps
      // a contact's impulse stable at 30/60/120 Hz and avoids frame-rate
      // dependent bursts when a coarse step happens to hit the cadence.
      const correction = interval > EPSILON
        ? delta.multiplyScalar(config.touchCorrection / interval)
        : new THREE.Vector3();
      const desiredForward = forward.clone().multiplyScalar(
        config.touchForwardImpulse + speed * (sprinting ? 1.02 : 0.94)
      );
      const desiredVelocity = correction.add(desiredForward);
      // Resolve toward a bounded desired velocity instead of stacking a new
      // impulse on an already moving ball every contact.
      touchImpulse.copy(desiredVelocity).sub(ball.velocity);
      touchImpulse.y = 0;
      if (touchImpulse.length() > config.maxTouchImpulse) touchImpulse.setLength(config.maxTouchImpulse);
      ball.velocity.add(touchImpulse);
      // A controlled touch rolls the ball with the foot, while a high-speed
      // loss keeps the impulse visible and lets possession resolve later.
      if (ball.spin) {
        const lateral = new THREE.Vector3(forward.z, 0, -forward.x);
        ball.spin.y = touchImpulse.dot(lateral) * 0.1;
      }
      state.nextTouchAt = now + Math.max(0.08, interval);
    }
  }

  if (resolvedMode === "legacy-attachment" && looseTouch) {
    const side = rightFromForward(forward);
    // Reuse the detection sample for the lateral nudge. This keeps one random
    // sample per simulation step, which is useful for deterministic replays.
    const sideSign = roll < 0.5 ? -1 : 1;
    const loosePoint = attachmentPoint
      .clone()
      .addScaledVector(forward, config.looseTouchDistance * (0.7 + looseTouchRisk * 0.45))
      .addScaledVector(side, sideSign * config.looseTouchDistance * 0.22);
    // The ball remains visually close enough to read, but clearly leaves the
    // normal foot point. The next orchestrator step should release ownership.
    ball.position.lerp(loosePoint, clamp(safeDt * config.controlLerpRate * 0.55, 0, 1));
    ball.velocity.copy(forward).multiplyScalar(
      Math.max(config.looseTouchSpeed, speed * (0.22 + looseTouchRisk * 0.18))
    );
  } else if (resolvedMode === "legacy-attachment") {
    ball.position.lerp(
      attachmentPoint,
      clamp(safeDt * config.controlLerpRate, 0, 1)
    );
    ball.velocity.set(0, 0, 0);
  }
  if (resolvedMode === "legacy-attachment") ball.mesh.position.copy(ball.position);

  return {
    attached: true,
    looseTouch,
    shouldReleaseBall: looseTouch,
    controlDistance,
    touchQuality,
    attachmentPoint,
    looseTouchRisk,
    looseTouchRiskPerSecond: looseTouchRisk,
    looseTouchChance,
    mode: resolvedMode,
    touchApplied,
    touchImpulse,
    nextTouchAt: state.nextTouchAt,
    touchCount: state.touchCount,
    ballContinuesBetweenTouches: resolvedMode === "impulse"
  };
}

/**
 * Phase 2 shielding placeholder. `protectsBall: false` is intentional and
 * makes it impossible for consumers to mistake this for tackle resolution.
 */
export function getShieldingPlaceholder({
  player,
  opponent = null,
  requested = false
}: ShieldingInput): ShieldingPlaceholder {
  const contactDirection = opponent
    ? player.position.clone().sub(opponent.position)
    : defaultPlayerForward(player);
  contactDirection.y = 0;
  if (contactDirection.lengthSq() <= EPSILON) {
    contactDirection.copy(defaultPlayerForward(player));
  } else {
    contactDirection.normalize();
  }
  return {
    status: "placeholder",
    active: Boolean(requested && player.hasBall && opponent),
    ownerId: player.id,
    opponentId: opponent?.id ?? null,
    strength: normalizeStat(player.stats.physical),
    contactDirection,
    protectsBall: false
  };
}

export class DribblingSystem {
  readonly config: DribblingConfig;
  private readonly touchStates = new Map<string, DribbleTouchState>();

  constructor(config: Partial<DribblingConfig> = {}) {
    this.config = mergeConfig(config);
  }

  update(input: Omit<DribblingInput, "config">): DribblingResult {
    const state = input.touchState ?? this.touchStates.get(input.player.id) ?? { nextTouchAt: input.now ?? 0, touchCount: 0 };
    const result = updateDribbling({ ...input, touchState: state, config: this.config });
    this.touchStates.set(input.player.id, state);
    return result;
  }

  reset(playerId?: string) {
    if (playerId) this.touchStates.delete(playerId);
    else this.touchStates.clear();
  }

  attachmentPoint(
    player: SimPlayer,
    sprint = false,
    playerForward?: PlayerForwardResolver
  ) {
    return getDribbleAttachmentPoint(
      player,
      sprint,
      playerForward,
      this.config
    );
  }
}
