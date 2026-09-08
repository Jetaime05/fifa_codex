import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DRIBBLING_CONFIG,
  DribblingSystem,
  getDribbleAttachmentPoint,
  getDribbleControlDistance,
  getShieldingPlaceholder,
  updateDribbling
} from "./DribblingSystem";
import type { SimBall, SimPlayer } from "./types";

const createPlayer = (dribbling: number, speed = 0): SimPlayer => ({
  id: `home-${dribbling}`,
  team: "home",
  role: "FWD",
  number: 7,
  short: "Vini",
  position: new THREE.Vector3(2, 0, 3),
  velocity: new THREE.Vector3(0, 0, speed),
  home: new THREE.Vector3(),
  hasBall: true,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: { pace: 90, shooting: 80, passing: 80, dribbling, defending: 40, physical: 70 },
  mesh: new THREE.Group(),
  body: new THREE.Mesh()
});

const createBall = (): SimBall => ({
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  mesh: new THREE.Mesh()
});

const createRandom = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const aggregateLooseTouchProbability = (hz: number, dribbling: number, trials = 600) => {
  let hits = 0;
  const speed = DEFAULT_DRIBBLING_CONFIG.highSpeedThreshold * 1.9;
  for (let trial = 0; trial < trials; trial += 1) {
    const player = createPlayer(dribbling, speed);
    const ball = createBall();
    const random = createRandom(0x12340000 + trial * 17 + hz);
    let touchedLoose = false;
    for (let step = 0; step < hz; step += 1) {
      const result = updateDribbling({ player, ball, dt: 1 / hz, sprint: true, random });
      touchedLoose ||= result.looseTouch;
    }
    if (touchedLoose) hits += 1;
  }
  return hits / trials;
};

describe("DribblingSystem", () => {
  it("keeps a better dribbler's normal touch closer", () => {
    const low = createPlayer(20);
    const high = createPlayer(90);
    expect(getDribbleControlDistance(high)).toBeLessThan(getDribbleControlDistance(low));
    const highPoint = getDribbleAttachmentPoint(high);
    expect(Math.hypot(highPoint.x - high.position.x, highPoint.z - high.position.z)).toBeCloseTo(
      getDribbleControlDistance(high)
    );
    expect(getDribbleControlDistance(low, true)).toBeGreaterThan(getDribbleControlDistance(low));
  });

  it("attaches a controlled ball to the stat-scaled forward foot point", () => {
    const player = createPlayer(80);
    const ball = createBall();
    const result = updateDribbling({
      player,
      ball,
      dt: 0.25,
      sprint: false,
      random: () => 1
    });

    expect(result.attached).toBe(true);
    expect(result.looseTouch).toBe(false);
    expect(result.shouldReleaseBall).toBe(false);
    expect(ball.position.distanceTo(result.attachmentPoint)).toBeLessThan(0.3);
    expect(ball.velocity.length()).toBe(0);
  });

  it("reports a deterministic loose touch when sprinting above the risk speed", () => {
    const player = createPlayer(20, DEFAULT_DRIBBLING_CONFIG.highSpeedThreshold * 1.9);
    const ball = createBall();
    const result = updateDribbling({
      player,
      ball,
      dt: 1 / 60,
      sprint: true,
      random: () => 0
    });

    expect(result.looseTouchRisk).toBeGreaterThan(0);
    expect(result.looseTouchRiskPerSecond).toBe(result.looseTouchRisk);
    expect(result.looseTouchChance).toBeLessThan(result.looseTouchRiskPerSecond);
    expect(result.looseTouch).toBe(true);
    expect(result.shouldReleaseBall).toBe(true);
    expect(ball.velocity.length()).toBeGreaterThan(0);
    // Ownership remains a match-level decision for the caller to apply.
    expect(player.hasBall).toBe(true);
  });

  it("does not create a loose touch below the high-speed threshold", () => {
    const player = createPlayer(20, DEFAULT_DRIBBLING_CONFIG.highSpeedThreshold - 0.1);
    const result = updateDribbling({ player, ball: createBall(), dt: 1 / 60, sprint: true, random: () => 0 });
    expect(result.looseTouchRisk).toBe(0);
    expect(result.looseTouch).toBe(false);
  });

  it("keeps one-second loose-touch probability stable across simulation rates", () => {
    const thirty = aggregateLooseTouchProbability(30, 20);
    const sixty = aggregateLooseTouchProbability(60, 20);
    const oneTwenty = aggregateLooseTouchProbability(120, 20);
    const observed = [thirty, sixty, oneTwenty];

    expect(Math.max(...observed) - Math.min(...observed)).toBeLessThan(0.1);
    expect(sixty).toBeGreaterThan(0.3);
    expect(sixty).toBeLessThan(0.7);
  });

  it("gives a high dribbling player a lower aggregate loose-touch risk", () => {
    const low = aggregateLooseTouchProbability(60, 20);
    const high = aggregateLooseTouchProbability(60, 90);
    expect(high).toBeLessThan(low);
  });

  it("exposes shielding as an explicit non-blocking placeholder", () => {
    const player = createPlayer(75);
    const opponent = createPlayer(60);
    opponent.id = "away-5";
    opponent.team = "away";
    const shield = getShieldingPlaceholder({ player, opponent, requested: true });

    expect(shield.status).toBe("placeholder");
    expect(shield.active).toBe(true);
    expect(shield.ownerId).toBe(player.id);
    expect(shield.opponentId).toBe(opponent.id);
    expect(shield.protectsBall).toBe(false);
  });

  it("supports the class facade for shared tuning", () => {
    const system = new DribblingSystem({ minAttachmentDistance: 0.6 });
    const player = createPlayer(100);
    const point = system.attachmentPoint(player);
    expect(Math.hypot(point.x - player.position.x, point.z - player.position.z)).toBeCloseTo(0.6);
  });

  it("applies a bounded desired-velocity touch independent of simulation tick size", () => {
    const impulses = [1 / 30, 1 / 60, 1 / 120].map((dt) => {
      const player = createPlayer(80);
      const ball = createBall();
      ball.position.copy(player.position).add(new THREE.Vector3(0, 0.22, 0.82));
      const state = { nextTouchAt: 0, touchCount: 0 };
      return updateDribbling({ player, ball, dt, now: 0, touchState: state, mode: "impulse", random: () => 1 });
    });
    expect(impulses.every((result) => result.touchApplied)).toBe(true);
    expect(impulses[0].touchImpulse.toArray()).toEqual(impulses[1].touchImpulse.toArray());
    expect(impulses[1].touchImpulse.toArray()).toEqual(impulses[2].touchImpulse.toArray());
  });

  it("keeps the ball free between discrete contacts and cadence stable at 30/60/120Hz", () => {
    const counts = [30, 60, 120].map((hz) => {
      const player = createPlayer(85, 4);
      const ball = createBall();
      ball.position.copy(player.position).add(new THREE.Vector3(0, 0.22, 0.86));
      const state = { nextTouchAt: 0, touchCount: 0 };
      let betweenTouchResult = updateDribbling({ player, ball, dt: 1 / hz, now: 0, touchState: state, mode: "impulse", random: () => 1 });
      expect(betweenTouchResult.touchApplied).toBe(true);
      const velocityAfterFirstTouch = ball.velocity.clone();
      betweenTouchResult = updateDribbling({ player, ball, dt: 1 / hz, now: 1 / hz, touchState: state, mode: "impulse", random: () => 1 });
      expect(betweenTouchResult.touchApplied).toBe(false);
      expect(ball.velocity.equals(velocityAfterFirstTouch)).toBe(true);
      for (let step = 2; step <= hz; step += 1) updateDribbling({ player, ball, dt: 1 / hz, now: step / hz, touchState: state, mode: "impulse", random: () => 1 });
      return state.touchCount;
    });
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("releases ownership when the foot cannot reach a distant or sharp-turn ball", () => {
    const player = createPlayer(80, 5);
    player.velocity.set(5, 0, 0);
    const ball = createBall();
    ball.position.copy(player.position).add(new THREE.Vector3(0, 0.22, 1.8));
    const result = updateDribbling({ player, ball, dt: 1 / 60, now: 0, mode: "impulse", random: () => 1 });
    expect(result.shouldReleaseBall).toBe(true);
    expect(result.touchApplied).toBe(false);
    expect(ball.velocity.length()).toBe(0);
  });

  it("resets cadence state so a new possession can make its first contact immediately", () => {
    const system = new DribblingSystem({ mode: "impulse" });
    const player = createPlayer(85);
    const ball = createBall();
    ball.position.copy(player.position).add(new THREE.Vector3(0, 0.22, 0.82));

    const first = system.update({ player, ball, dt: 1 / 60, now: 0, mode: "impulse", random: () => 1 });
    expect(first.touchApplied).toBe(true);
    expect(first.touchCount).toBe(1);

    system.reset(player.id);
    ball.position.copy(player.position).add(new THREE.Vector3(0, 0.22, 0.82));
    const afterReset = system.update({ player, ball, dt: 1 / 60, now: 0.01, mode: "impulse", random: () => 1 });
    expect(afterReset.touchApplied).toBe(true);
    expect(afterReset.touchCount).toBe(1);
  });
});
