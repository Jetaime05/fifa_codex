export type AIDifficultyLevel = "easy" | "normal" | "hard";

export type AIRange = {
  min: number;
  max: number;
};

/**
 * Difficulty deliberately tunes perception and decisions rather than movement
 * speed. This keeps players physically fair while making stronger opponents
 * read danger earlier and choose better football actions.
 */
export type AIDifficultyConfig = {
  level: AIDifficultyLevel;
  reactionDelayMs: AIRange;
  decisionCooldownMs: AIRange;
  perceptionAccuracy: number;
  scoreNoise: number;
  mistakeChance: number;
  mistakeSeverity: number;
  passVision: number;
  shotPatience: number;
  dribbleConfidence: number;
  pressAggression: number;
  markDiscipline: number;
  clearanceComposure: number;
};

export const AI_DIFFICULTIES: Record<AIDifficultyLevel, Readonly<AIDifficultyConfig>> = {
  easy: {
    level: "easy",
    reactionDelayMs: { min: 420, max: 720 },
    decisionCooldownMs: { min: 480, max: 760 },
    perceptionAccuracy: 0.64,
    scoreNoise: 0.16,
    mistakeChance: 0.22,
    mistakeSeverity: 0.72,
    passVision: 0.66,
    shotPatience: 0.62,
    dribbleConfidence: 0.82,
    pressAggression: 0.68,
    markDiscipline: 0.64,
    clearanceComposure: 0.65
  },
  normal: {
    level: "normal",
    reactionDelayMs: { min: 230, max: 430 },
    decisionCooldownMs: { min: 300, max: 520 },
    perceptionAccuracy: 0.82,
    scoreNoise: 0.075,
    mistakeChance: 0.09,
    mistakeSeverity: 0.42,
    passVision: 0.84,
    shotPatience: 0.82,
    dribbleConfidence: 0.9,
    pressAggression: 0.84,
    markDiscipline: 0.84,
    clearanceComposure: 0.84
  },
  hard: {
    level: "hard",
    reactionDelayMs: { min: 90, max: 210 },
    decisionCooldownMs: { min: 180, max: 340 },
    perceptionAccuracy: 0.96,
    scoreNoise: 0.022,
    mistakeChance: 0.025,
    mistakeSeverity: 0.18,
    passVision: 1,
    shotPatience: 1,
    dribbleConfidence: 0.96,
    pressAggression: 0.96,
    markDiscipline: 1,
    clearanceComposure: 1
  }
};

export type AIDifficultyOverrides = Partial<Omit<AIDifficultyConfig, "level" | "reactionDelayMs" | "decisionCooldownMs">> & {
  level?: AIDifficultyLevel;
  reactionDelayMs?: Partial<AIRange>;
  decisionCooldownMs?: Partial<AIRange>;
};

export function getAIDifficulty(
  level: AIDifficultyLevel = "normal",
  overrides: AIDifficultyOverrides = {}
): AIDifficultyConfig {
  const base = AI_DIFFICULTIES[level];
  return {
    ...base,
    ...overrides,
    level: overrides.level ?? level,
    reactionDelayMs: { ...base.reactionDelayMs, ...overrides.reactionDelayMs },
    decisionCooldownMs: { ...base.decisionCooldownMs, ...overrides.decisionCooldownMs }
  };
}

export function sampleAIRange(range: AIRange, random: () => number): number {
  const roll = Math.max(0, Math.min(1, random()));
  return range.min + (range.max - range.min) * roll;
}
