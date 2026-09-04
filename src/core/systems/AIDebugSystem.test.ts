import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { AIDebugSystem, createAIDebugSnapshot, createAIDecisionDebug, getAIIntentLabel } from "./AIDebugSystem";
import type { SimBall, SimPlayer } from "./types";

function player(id: string, team: "home" | "away", intent: SimPlayer["intent"]): SimPlayer {
  const position = new THREE.Vector3(id.length, 0, team === "home" ? -10 : 10);
  return {
    id, team, role: "MID", number: 8, short: id, position, velocity: new THREE.Vector3(),
    home: position.clone(), hasBall: false, stamina: 1, cooldown: 0.4, intent,
    stats: { pace: 70, shooting: 70, passing: 70, dribbling: 70, defending: 70, physical: 70 },
    mesh: new THREE.Group(), body: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  };
}

function ball(): SimBall {
  return {
    position: new THREE.Vector3(2, 0.5, 4), velocity: new THREE.Vector3(3, 0, 4),
    mesh: new THREE.Mesh(new THREE.SphereGeometry(0.5))
  };
}

describe("AIDebugSystem", () => {
  it("maps simulation intents to readable labels", () => {
    expect(getAIIntentLabel("chase")).toBe("Press ball");
    expect(getAIIntentLabel("support")).toBe("Offer support");
    expect(getAIIntentLabel("keeper")).toBe("Protect goal");
  });

  it("builds a stable sorted snapshot without retaining mutable vectors", () => {
    const away = player("z-away", "away", "return");
    const home = player("a-home", "home", "support");
    const matchBall = ball();
    const decision = createAIDecisionDebug({
      player: home,
      label: "Overlap wide",
      reason: "The right lane is open.",
      target: new THREE.Vector3(14, 0, 18),
      scores: { hold: 0.2, overlap: 0.8 }
    });
    const snapshot = createAIDebugSnapshot({
      players: [home, away], ball: matchBall, ballOwner: home, frame: 7.9, elapsed: 2.5, decisions: [decision]
    });
    matchBall.position.x = 99;
    home.position.x = 88;

    expect(snapshot.frame).toBe(7);
    expect(snapshot.possession).toBe("home");
    expect(snapshot.ball).toEqual(expect.objectContaining({ speed: 5, ownerId: "a-home" }));
    expect(snapshot.ball.position.x).toBe(2);
    expect(snapshot.decisions.map((item) => item.playerId)).toEqual(["z-away", "a-home"]);
    expect(snapshot.decisions[1].label).toBe("Overlap wide");
    expect(Object.keys(snapshot.decisions[1].scores ?? {})).toEqual(["hold", "overlap"]);
  });

  it("records optional telemetry without changing player state", () => {
    const system = new AIDebugSystem(true);
    const ai = player("mid", "home", "chase");
    const before = JSON.stringify({ intent: ai.intent, position: ai.position.toArray(), cooldown: ai.cooldown });
    system.recordDecision({ player: ai, reason: "Nearest defender to the ball." });
    const snapshot = system.snapshot({ players: [ai], ball: ball(), frame: 3 });

    expect(snapshot.enabled).toBe(true);
    expect(snapshot.decisions[0].reason).toContain("Nearest defender");
    expect(JSON.stringify({ intent: ai.intent, position: ai.position.toArray(), cooldown: ai.cooldown })).toBe(before);
  });
});
