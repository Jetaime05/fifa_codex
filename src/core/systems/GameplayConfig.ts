/**
 * Small, data-only tuning surface for the Phase 2 ball actions.
 *
 * Keeping the numbers here (rather than in the input/orchestrator layer) lets
 * a replay, bot, and the eventual mobile controls all produce the same ball
 * behaviour.  Values are expressed in the simulation's metres/second units.
 */

export type PassingConfig = {
  /** 0 means manual aim, 1 means the assist may fully steer to a teammate. */
  assist: number;
  baseSpeed: number;
  distanceSpeed: number;
  passingStatSpeed: number;
  minSpeed: number;
  maxSpeed: number;
  /** A ground pass is allowed a very small hop so it remains readable. */
  groundLift: number;
  maxGroundLift: number;
  /** Target lead is multiplied by the estimated ball travel time. */
  targetLead: number;
  /** Base width of the corridor in which a defender may intercept. */
  interceptionCorridor: number;
  /** How long a defender needs to react after the ball enters the corridor. */
  interceptionReactionTime: number;
  /** Pressure/error tuning used by assisted target placement. */
  pressureError: number;
  maxAimError: number;
  /** Horizontal drag rate used to solve a ground pass's release speed. */
  groundDragPerSecond: number;
  /** Extra lead applied to a through pass before receiver velocity lead. */
  throughLead: number;
  throughLift: number;
  lobApexHeight: number;
  crossApexHeight: number;
  aerialMinSpeed: number;
  aerialMaxSpeed: number;
};

export type ShootingConfig = {
  powerBase: number;
  powerShotBonus: number;
  finessePowerBase: number;
  statPower: number;
  distancePower: number;
  minPower: number;
  maxPower: number;
  finesseMaxPower: number;
  /** Accuracy is a 0..1 probability-like quality score, not a guarantee. */
  accuracyBase: number;
  statAccuracy: number;
  pressureAccuracyPenalty: number;
  distanceAccuracyPenalty: number;
  powerShotAccuracyPenalty: number;
  finesseAccuracyPenalty: number;
  maxAimError: number;
  finesseCurl: number;
  powerBackspin: number;
  shotLift: number;
  /** Lift used by a chip, expressed as an initial vertical velocity. */
  chipLift: number;
  /** Extra accuracy loss when striking a ball before it settles. */
  volleyAccuracyPenalty: number;
  /** Power multiplier for a volley hit from a moving ball. */
  volleyPowerMultiplier: number;
};

/**
 * Shared ball scale and physics tuning. The current player rig is about
 * 3.4 world units tall, so a 0.22 radius keeps football proportions without
 * forcing existing callers to change their radius yet.
 */
export type BallPhysicsConfig = {
  radius: number;
  gravity: number;
  groundRestitution: number;
  groundFrictionPerSecond: number;
  airDragPerSecond: number;
  spinDecayPerSecond: number;
  magnusStrength: number;
  rollingSpinStrength: number;
  /** Maximum free-flight integration step used by swept collision checks. */
  maxSubstep: number;
  postRestitution: number;
  bodyRestitution: number;
};

/** Timing is simulation-owned; presentation can subscribe to these phases. */
export type BallActionTimingConfig = {
  passPrepare: number;
  passContact: number;
  passRecovery: number;
  shotPrepare: number;
  shotContact: number;
  shotRecovery: number;
  touchRecovery: number;
  aerialPrepare: number;
  aerialContact: number;
  aerialRecovery: number;
};

export type DuelConfig = {
  playerRadius: number;
  ballReach: number;
  challengeReach: number;
  bodyContactRadius: number;
  challengeAngleCosine: number;
  cooldown: number;
  recovery: number;
  shieldStrength: number;
  tacklePower: number;
  foulRiskFromBehind: number;
};

export type AerialConfig = {
  contestRadius: number;
  maxJumpHeight: number;
  headerSpeed: number;
  clearanceSpeed: number;
  volleySpeed: number;
  gravity: number;
};

export const DEFAULT_PASSING_CONFIG: PassingConfig = {
  assist: 0.72,
  baseSpeed: 13.5,
  distanceSpeed: 0.23,
  passingStatSpeed: 0.065,
  minSpeed: 14,
  maxSpeed: 36,
  groundLift: 0.12,
  maxGroundLift: 0.42,
  targetLead: 0.72,
  interceptionCorridor: 1.18,
  interceptionReactionTime: 0.16,
  pressureError: 0.7,
  maxAimError: 2.25,
  groundDragPerSecond: 0.54,
  throughLead: 1.05,
  throughLift: 0.16,
  lobApexHeight: 3.8,
  crossApexHeight: 2.6,
  aerialMinSpeed: 10,
  aerialMaxSpeed: 30
};

export const DEFAULT_SHOOTING_CONFIG: ShootingConfig = {
  powerBase: 34,
  powerShotBonus: 7,
  finessePowerBase: 28,
  statPower: 0.13,
  distancePower: 0.035,
  minPower: 25,
  maxPower: 54,
  finesseMaxPower: 43,
  accuracyBase: 0.34,
  statAccuracy: 0.0062,
  pressureAccuracyPenalty: 0.28,
  distanceAccuracyPenalty: 0.0018,
  powerShotAccuracyPenalty: 0.075,
  finesseAccuracyPenalty: 0.025,
  maxAimError: 2.4,
  finesseCurl: 0.9,
  powerBackspin: 0.16,
  shotLift: 2.45,
  chipLift: 6.1,
  volleyAccuracyPenalty: 0.1,
  volleyPowerMultiplier: 1.04
};

export const DEFAULT_BALL_PHYSICS_CONFIG: BallPhysicsConfig = {
  radius: 0.22,
  gravity: 12.5,
  groundRestitution: 0.32,
  groundFrictionPerSecond: 0.54,
  airDragPerSecond: 0.094,
  spinDecayPerSecond: 1.43,
  magnusStrength: 0.035,
  rollingSpinStrength: 0.7,
  maxSubstep: 1 / 120,
  postRestitution: 0.52,
  bodyRestitution: 0.24
};

export const DEFAULT_BALL_ACTION_TIMING_CONFIG: BallActionTimingConfig = {
  passPrepare: 0.16,
  passContact: 0.2,
  passRecovery: 0.2,
  shotPrepare: 0.26,
  shotContact: 0.34,
  shotRecovery: 0.3,
  touchRecovery: 0.12,
  aerialPrepare: 0.18,
  aerialContact: 0.28,
  aerialRecovery: 0.3
};

export const DEFAULT_DUEL_CONFIG: DuelConfig = {
  playerRadius: 0.75,
  ballReach: 1.42,
  challengeReach: 1.6,
  bodyContactRadius: 1.28,
  challengeAngleCosine: -0.28,
  cooldown: 0.58,
  recovery: 0.26,
  shieldStrength: 0.76,
  tacklePower: 5.4,
  foulRiskFromBehind: 0.22
};

export const DEFAULT_AERIAL_CONFIG: AerialConfig = {
  contestRadius: 1.85,
  maxJumpHeight: 1.25,
  headerSpeed: 13.5,
  clearanceSpeed: 18,
  volleySpeed: 24,
  gravity: 12.5
};

/** A single config object is useful to game setup and tuning tools. */
export type GameplayConfig = {
  passing: PassingConfig;
  shooting: ShootingConfig;
  ball: BallPhysicsConfig;
  actions: BallActionTimingConfig;
  duel: DuelConfig;
  aerial: AerialConfig;
};

export const DEFAULT_GAMEPLAY_CONFIG: GameplayConfig = {
  passing: DEFAULT_PASSING_CONFIG,
  shooting: DEFAULT_SHOOTING_CONFIG,
  ball: DEFAULT_BALL_PHYSICS_CONFIG,
  actions: DEFAULT_BALL_ACTION_TIMING_CONFIG,
  duel: DEFAULT_DUEL_CONFIG,
  aerial: DEFAULT_AERIAL_CONFIG
};

// Short aliases keep integrations readable and preserve room for an eventual
// config migration without making the public API brittle.
export const DEFAULT_PASS_CONFIG = DEFAULT_PASSING_CONFIG;
export const DEFAULT_SHOT_CONFIG = DEFAULT_SHOOTING_CONFIG;
export type PassConfig = PassingConfig;
export type ShotConfig = ShootingConfig;
