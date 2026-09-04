import { describe, expect, it } from "vitest";
import { decideUtilityAI, memoryFromDecision, UtilityAISystem, type UtilityAIContext } from "./UtilityAISystem";

const midpoint = () => 0.5;
const base: UtilityAIContext = {
  playerId: "away-9",
  role: "FWD",
  possession: "self",
  nowMs: 1_000,
  distanceToGoal: 30,
  goalAngleQuality: 0.6,
  pressure: 0.3,
  passingLaneQuality: 0.6,
  passTargetOpen: 0.6,
  passProgress: 0.7,
  dribbleSpace: 0.5,
  dangerNearOwnGoal: 0,
  stamina: 0.9,
  stats: { passing: 75, shooting: 78, dribbling: 76, defending: 35 }
};

describe("UtilityAISystem", () => {
  it("shoots from a high-quality close chance and explains every score", () => {
    const result = decideUtilityAI({
      ...base,
      distanceToGoal: 8,
      goalAngleQuality: 1,
      pressure: 0.05,
      passingLaneQuality: 0.25,
      passTargetOpen: 0.2
    }, { difficulty: "hard", random: midpoint });
    expect(result.action).toBe("shoot");
    expect(result.reason).toBe("distance to goal");
    expect(result.scores).toHaveLength(7);
    expect(result.scores.every((score) => score.reasons.length > 0)).toBe(true);
  });

  it("passes instead of shooting when a progressive target is clearly open", () => {
    const result = decideUtilityAI({
      ...base,
      distanceToGoal: 40,
      goalAngleQuality: 0.2,
      pressure: 0.55,
      passingLaneQuality: 1,
      passTargetOpen: 1,
      passProgress: 1,
      dribbleSpace: 0.15
    }, { difficulty: "normal", random: midpoint });
    expect(result.action).toBe("pass");
    expect(result.reason).toBe("passing lane quality");
  });

  it("clears danger near its own goal under pressure", () => {
    const result = decideUtilityAI({
      ...base,
      role: "DEF",
      dangerNearOwnGoal: 1,
      pressure: 1,
      passingLaneQuality: 0.05,
      passTargetOpen: 0.05,
      dribbleSpace: 0.05
    }, { difficulty: "hard", random: midpoint });
    expect(result.action).toBe("clear");
    expect(result.reason).toBe("danger near own goal");
  });

  it("presses near the ball but marks a major threat when far away", () => {
    const defensive = { ...base, possession: "opponent" as const, role: "MID" as const, shapeError: 0.1, markThreat: 0.45 };
    const press = decideUtilityAI({ ...defensive, distanceToBall: 2 }, { difficulty: "hard", random: midpoint });
    const mark = decideUtilityAI({ ...defensive, distanceToBall: 30, markThreat: 1 }, { difficulty: "hard", random: midpoint });
    expect(press.action).toBe("press");
    expect(mark.action).toBe("mark");
  });

  it("removes actions on cooldown from selection", () => {
    const context = {
      ...base,
      distanceToGoal: 8,
      goalAngleQuality: 1,
      pressure: 0,
      passingLaneQuality: 1,
      passTargetOpen: 1,
      actionCooldownsMs: { shoot: 900 }
    };
    const result = decideUtilityAI(context, { difficulty: "hard", random: midpoint });
    const shoot = result.scores.find((score) => score.action === "shoot")!;
    expect(shoot.available).toBe(false);
    expect(shoot.cooldownRemainingMs).toBe(900);
    expect(result.action).not.toBe("shoot");
  });

  it("reuses the previous intent until its reaction/cooldown window expires", () => {
    const first = decideUtilityAI(base, { difficulty: "normal", random: midpoint });
    const waiting = decideUtilityAI({ ...base, nowMs: first.timestampMs + 1 }, {
      difficulty: "normal",
      random: midpoint,
      memory: memoryFromDecision(first)
    });
    expect(waiting.deferred).toBe(true);
    expect(waiting.action).toBe(first.action);
    expect(waiting.nextDecisionAtMs).toBe(first.nextDecisionAtMs);
    expect(waiting.reason).toContain("before reassessing");
  });

  it("uses injected randomness deterministically and exposes deliberate mistakes", () => {
    const zero = () => 0;
    const first = decideUtilityAI(base, { difficulty: "easy", random: zero });
    const second = decideUtilityAI(base, { difficulty: "easy", random: zero });
    expect(first).toEqual(second);
    expect(first.mistakeApplied).toBe(true);
  });

  it("makes hard AI react faster and evaluate good passes more accurately", () => {
    const context = { ...base, passingLaneQuality: 1, passTargetOpen: 1, passProgress: 1 };
    const easy = decideUtilityAI(context, { difficulty: "easy", random: midpoint });
    const hard = decideUtilityAI(context, { difficulty: "hard", random: midpoint });
    const passScore = (result: typeof easy) => result.scores.find((score) => score.action === "pass")!.score;
    expect(hard.reactionDelayMs).toBeLessThan(easy.reactionDelayMs);
    expect(passScore(hard)).toBeGreaterThan(passScore(easy));
  });

  it("offers a stateful facade without coupling decisions to rendering", () => {
    const system = new UtilityAISystem({ difficulty: "normal", random: midpoint });
    const result = system.decide(base);
    expect(result.playerId).toBe("away-9");
    expect(result.executeAtMs).toBeGreaterThan(result.timestampMs);
    expect(result.nextDecisionAtMs).toBeGreaterThan(result.timestampMs);
  });
});
