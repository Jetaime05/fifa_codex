import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FirstTouchSystem,
  applyFirstTouch,
  evaluateFirstTouch
} from "./FirstTouchSystem";
import type { SimBall, SimPlayer } from "./types";

const createPlayer = (dribbling: number): SimPlayer => ({
  id: `home-${dribbling}`,
  team: "home",
  role: "MID",
  number: 8,
  short: "Player",
  position: new THREE.Vector3(4, 0, 2),
  velocity: new THREE.Vector3(),
  home: new THREE.Vector3(),
  hasBall: false,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: { pace: 70, shooting: 70, passing: 70, dribbling, defending: 50, physical: 70 },
  mesh: new THREE.Group(),
  body: new THREE.Mesh()
});

const createBall = (velocity = new THREE.Vector3(0, 0, 10)): SimBall => ({
  position: new THREE.Vector3(0, 0.55, 2),
  velocity: velocity.clone(),
  mesh: new THREE.Mesh()
});

describe("FirstTouchSystem", () => {
  it("uses dribbling and incoming speed to calculate control quality", () => {
    const low = evaluateFirstTouch({ player: createPlayer(20), ball: createBall() });
    const high = evaluateFirstTouch({ player: createPlayer(90), ball: createBall() });
    const hard = evaluateFirstTouch({ player: createPlayer(90), ball: createBall(new THREE.Vector3(0, 0, 28)) });

    expect(high.touchQuality).toBeGreaterThan(low.touchQuality);
    expect(high.controlDistance).toBeLessThan(low.controlDistance);
    expect(hard.touchQuality).toBeLessThan(high.touchQuality);
  });

  it("places a good touch at the chosen control direction and kills pace", () => {
    const player = createPlayer(95);
    const ball = createBall(new THREE.Vector3(0, 0, 8));
    const result = applyFirstTouch({
      player,
      ball,
      controlDirection: new THREE.Vector3(1, 0, 0)
    });

    expect(result.retained).toBe(true);
    expect(result.shouldReleaseBall).toBe(false);
    expect(ball.position.x).toBeGreaterThan(player.position.x);
    expect(ball.position.z).toBeCloseTo(player.position.z);
    expect(ball.velocity.length()).toBeLessThan(8);
    expect(ball.mesh.position.equals(ball.position)).toBe(true);
  });

  it("keeps a poor high-speed touch loose instead of snapping to the feet", () => {
    const player = createPlayer(0);
    const ball = createBall(new THREE.Vector3(0, 0, 28));
    const before = ball.position.clone();
    const result = applyFirstTouch({ player, ball });

    expect(result.retained).toBe(false);
    expect(result.shouldReleaseBall).toBe(true);
    expect(ball.position.equals(result.controlPoint)).toBe(false);
    expect(ball.position.distanceTo(before)).toBeGreaterThan(0);
    expect(ball.velocity.length()).toBeCloseTo(28 * 0.72);
  });

  it("allows deterministic jitter for replayable tuning experiments", () => {
    const player = createPlayer(60);
    const ball = createBall(new THREE.Vector3(0, 0, 12));
    const base = evaluateFirstTouch({ player, ball });
    const jittered = evaluateFirstTouch({
      player,
      ball,
      random: () => 1,
      config: { randomJitter: 0.1 }
    });
    expect(jittered.touchQuality).toBeGreaterThan(base.touchQuality);
  });

  it("supports a reusable configured system facade", () => {
    const system = new FirstTouchSystem({ minimumRetentionQuality: 0 });
    const player = createPlayer(0);
    const result = system.update({ player, ball: createBall(new THREE.Vector3(0, 0, 20)) });
    expect(result.retained).toBe(true);
    expect(result.shouldReleaseBall).toBe(false);
  });
});

