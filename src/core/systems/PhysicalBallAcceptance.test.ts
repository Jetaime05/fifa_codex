import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { updateBallPhysics } from "./BallSystem";
import { DEFAULT_MOVEMENT_CONFIG, updatePlayerMovement } from "./MovementSystem";
import { DribblingSystem } from "./DribblingSystem";
import type { SimBall, SimPlayer } from "./types";

const makePlayer = (): SimPlayer => ({
  id: "home-7", team: "home", role: "FWD", number: 7, short: "Vini",
  position: new THREE.Vector3(), velocity: new THREE.Vector3(), home: new THREE.Vector3(),
  hasBall: true, stamina: 1, cooldown: 0, intent: "hold",
  stats: { pace: 82, shooting: 80, passing: 80, dribbling: 84, defending: 45, physical: 70 },
  mesh: new THREE.Group(), body: new THREE.Mesh()
});

const makeBall = (player: SimPlayer): SimBall => ({
  position: player.position.clone().add(new THREE.Vector3(0, 0.22, 0.82)),
  velocity: new THREE.Vector3(), spin: new THREE.Vector3(), mesh: new THREE.Mesh()
});

const run = (hz: number, mode: "straight" | "stop" | "turn") => {
  const player = makePlayer();
  const ball = makeBall(player);
  const dribble = new DribblingSystem({ mode: "impulse" });
  let releases = 0;
  let maxSeparation = 0;
  let ownsBall = true;
  const dt = 1 / hz;
  for (let frame = 0; frame < Math.round(5 * hz); frame += 1) {
    const now = frame * dt;
    const direction = mode === "stop" && now > 2.2
      ? new THREE.Vector3()
      : mode === "turn" && now > 2.2
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1);
    updatePlayerMovement({
      player, inputDirection: direction, sprint: false, dt,
      bounds: { halfWidth: 36, halfLength: 56 }, playerRadius: 0.75,
      isControlled: true, hasBall: true, config: DEFAULT_MOVEMENT_CONFIG
    });
    if (ownsBall) {
      const result = dribble.update({ player, ball, dt, now, mode: "impulse", sprint: false, random: () => 1 });
      if (result.shouldReleaseBall) {
        releases += 1;
        ownsBall = false;
        player.hasBall = false;
      }
    }
    updateBallPhysics({
      ball, ballOwner: ownsBall ? player : null, ballOwnerMode: "free", dt,
      bounds: { halfWidth: 36, halfLength: 56 }, ballRadius: 0.22, goalWidth: 13.5,
      playerForward: (candidate) => candidate.velocity.clone().setY(0).normalize(), onGoal: () => undefined
    });
    const separation = Math.hypot(ball.position.x - player.position.x, ball.position.z - player.position.z);
    maxSeparation = Math.max(maxSeparation, separation);
  }
  return { player, ball, releases, maxSeparation, touches: dribble.update({ player, ball, dt: 0, now: 5, mode: "impulse" }).touchCount };
};

describe("physical ball pipeline", () => {
  it("keeps a straight controlled dribble physically close at 30/60/120Hz", () => {
    const runs = [30, 60, 120].map((hz) => run(hz, "straight"));
    expect(runs.every((result) => result.releases === 0)).toBe(true);
    expect(Math.max(...runs.map((result) => result.maxSeparation))).toBeLessThan(2.0);
    expect(Math.max(...runs.map((result) => result.touches) as number[]) - Math.min(...runs.map((result) => result.touches) as number[])).toBeLessThanOrEqual(1);
  });

  it("settles when the player stops and releases when a sharp turn leaves the touch behind", () => {
    const stop = run(60, "stop");
    expect(stop.releases).toBe(0);
    expect(stop.ball.velocity.length()).toBeLessThan(4);
    const turn = run(60, "turn");
    expect(turn.releases).toBeGreaterThan(0);
  });
});
