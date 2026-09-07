import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_TEAM_TACTICS,
  getPlayerInstruction,
  getTacticalModifiers,
  getTacticalTargetOverride,
  sanitizeTactics
} from "./TacticsSystem";

describe("TacticsSystem", () => {
  it("clamps finite editor values and clones instruction data", () => {
    const source = {
      defensiveLine: -10,
      pressingIntensity: Number.POSITIVE_INFINITY,
      buildUpSpeed: Number.NaN,
      passingStyle: "not-a-style",
      attackWidth: 140,
      instructions: { cardA: { role: "getForward" }, cardB: "invalid" }
    } as unknown as Record<string, unknown>;
    const result = sanitizeTactics(source);
    expect(result).toEqual({
      defensiveLine: 0,
      pressingIntensity: 50,
      buildUpSpeed: 50,
      passingStyle: "balanced",
      attackWidth: 100,
      instructions: { cardA: "getForward", cardB: "balanced" }
    });
    expect(result.instructions).not.toBe(source.instructions);
    expect(DEFAULT_RUNTIME_TEAM_TACTICS.instructions).toEqual({});
  });

  it("keeps tactical modifiers bounded and makes profiles visibly distinct", () => {
    const short = getTacticalModifiers({ buildUpSpeed: 0, passingStyle: "short" });
    const direct = getTacticalModifiers({ buildUpSpeed: 100, passingStyle: "direct" });
    expect(short.supportForwardMultiplier).toBeLessThan(direct.supportForwardMultiplier);
    expect(short.passDistanceMultiplier).toBeLessThan(direct.passDistanceMultiplier);
    expect(short.widthMultiplier).toBeGreaterThan(0);
    expect(direct.widthMultiplier).toBeLessThan(2);
    for (const value of Object.values(direct)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("resolves player and card compatibility keys without mutating targets", () => {
    const target = new THREE.Vector3(0, 0, 10);
    const tactics = sanitizeTactics({ instructions: { cardA: "getForward", 7: "stayBack" } });
    const forward = getTacticalTargetOverride({ target, playerId: "runtime-a", short: "cardA", role: "MID", homeX: 0, attackingDirection: 1, tactics });
    expect(forward.z).toBeGreaterThan(target.z);
    expect(target.z).toBe(10);
    expect(getPlayerInstruction(tactics, { id: "runtime-7", number: 7 })).toBe("stayBack");
  });
});
