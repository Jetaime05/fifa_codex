import { describe, expect, it } from "vitest";
import { AI_DIFFICULTIES, getAIDifficulty, sampleAIRange } from "./AIDifficulty";

describe("AIDifficulty", () => {
  it("changes reaction, perception, and mistakes without a movement-speed modifier", () => {
    const easy = AI_DIFFICULTIES.easy;
    const hard = AI_DIFFICULTIES.hard;
    expect(easy.reactionDelayMs.min).toBeGreaterThan(hard.reactionDelayMs.max);
    expect(easy.perceptionAccuracy).toBeLessThan(hard.perceptionAccuracy);
    expect(easy.mistakeChance).toBeGreaterThan(hard.mistakeChance);
    expect(easy.markDiscipline).toBeLessThan(hard.markDiscipline);
    expect(easy).not.toHaveProperty("speedMultiplier");
  });

  it("merges nested overrides without mutating the preset", () => {
    const tuned = getAIDifficulty("normal", { mistakeChance: 0, reactionDelayMs: { min: 10 } });
    expect(tuned.mistakeChance).toBe(0);
    expect(tuned.reactionDelayMs).toEqual({ min: 10, max: 430 });
    expect(AI_DIFFICULTIES.normal.reactionDelayMs.min).toBe(230);
  });

  it("samples ranges through the injected random source", () => {
    expect(sampleAIRange({ min: 100, max: 300 }, () => 0.25)).toBe(150);
    expect(sampleAIRange({ min: 100, max: 300 }, () => 2)).toBe(300);
  });
});
