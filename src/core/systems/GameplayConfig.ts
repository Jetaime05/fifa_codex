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
  maxAimError: 2.25
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
  shotLift: 2.45
};

/** A single config object is useful to game setup and tuning tools. */
export type GameplayConfig = {
  passing: PassingConfig;
  shooting: ShootingConfig;
};

export const DEFAULT_GAMEPLAY_CONFIG: GameplayConfig = {
  passing: DEFAULT_PASSING_CONFIG,
  shooting: DEFAULT_SHOOTING_CONFIG
};

// Short aliases keep integrations readable and preserve room for an eventual
// config migration without making the public API brittle.
export const DEFAULT_PASS_CONFIG = DEFAULT_PASSING_CONFIG;
export const DEFAULT_SHOT_CONFIG = DEFAULT_SHOOTING_CONFIG;
export type PassConfig = PassingConfig;
export type ShotConfig = ShootingConfig;
