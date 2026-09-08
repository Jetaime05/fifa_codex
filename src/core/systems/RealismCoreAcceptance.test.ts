import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { updateBallPhysics } from "./BallSystem";
import type { BallCollisionEvent } from "./BallSystem";
import { DEFAULT_MOVEMENT_CONFIG, updatePlayerMovement } from "./MovementSystem";
import { DribblingSystem } from "./DribblingSystem";
import { FirstTouchSystem } from "./FirstTouchSystem";
import { createPassPlan } from "./PassingSystem";
import { resolvePossession } from "./PossessionSystem";
import { DuelSystem, resolveDuel } from "./DuelSystem";
import type { SimBall, SimPlayer } from "./types";

const makePlayer = (
  id: string,
  team: "home" | "away",
  position: THREE.Vector3,
  options: {
    role?: SimPlayer["role"];
    velocity?: THREE.Vector3;
    hasBall?: boolean;
    stats?: Partial<SimPlayer["stats"]>;
  } = {}
): SimPlayer => ({
  id,
  team,
  role: options.role ?? "MID",
  number: 8,
  short: id,
  position: position.clone(),
  velocity: options.velocity?.clone() ?? new THREE.Vector3(),
  home: position.clone(),
  hasBall: options.hasBall ?? false,
  stamina: 1,
  cooldown: 0,
  intent: "hold",
  stats: {
    pace: 75,
    shooting: 70,
    passing: 78,
    dribbling: 78,
    defending: 70,
    physical: 70,
    ...options.stats
  },
  mesh: new THREE.Group(),
  body: new THREE.Mesh()
});

const makeBall = (position: THREE.Vector3, velocity = new THREE.Vector3()): SimBall => ({
  position: position.clone(),
  velocity: velocity.clone(),
  spin: new THREE.Vector3(),
  mesh: new THREE.Mesh()
});

const seededUnit = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const runPhysicalDribble = () => {
  const player = makePlayer("home-carrier", "home", new THREE.Vector3(), {
    hasBall: true,
    stats: { pace: 82, dribbling: 84 }
  });
  const ball = makeBall(new THREE.Vector3(0, 0.22, 0.82));
  const dribbling = new DribblingSystem({ mode: "impulse" });
  const dt = 1 / 60;
  let releases = 0;
  let maxSeparation = 0;
  let touchCount = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    const now = frame * dt;
    updatePlayerMovement({
      player,
      inputDirection: new THREE.Vector3(0, 0, 1),
      sprint: false,
      dt,
      bounds: { halfWidth: 36, halfLength: 56 },
      playerRadius: 0.75,
      isControlled: true,
      hasBall: true,
      config: DEFAULT_MOVEMENT_CONFIG
    });
    const result = dribbling.update({
      player,
      ball,
      dt,
      now,
      mode: "impulse",
      random: () => 1
    });
    touchCount = result.touchCount;
    if (result.shouldReleaseBall) {
      releases += 1;
      player.hasBall = false;
    }
    updateBallPhysics({
      ball,
      ballOwner: releases === 0 ? player : null,
      ballOwnerMode: "free",
      dt,
      bounds: { halfWidth: 36, halfLength: 56 },
      ballRadius: 0.22,
      goalWidth: 13.5,
      playerForward: (candidate) => candidate.velocity.clone().setY(0).normalize(),
      onGoal: () => undefined
    });
    maxSeparation = Math.max(
      maxSeparation,
      Math.hypot(ball.position.x - player.position.x, ball.position.z - player.position.z)
    );
  }
  return {
    releases,
    touchCount,
    maxSeparation: Number(maxSeparation.toFixed(9)),
    playerPosition: player.position.toArray(),
    ballPosition: ball.position.toArray()
  };
};

const runCoreRealismScenario = () => {
  const random = seededUnit(0x5eed1234);
  const dribble = runPhysicalDribble();

  const receiver = makePlayer("home-receiver", "home", new THREE.Vector3(0, 0, 0), {
    velocity: new THREE.Vector3(0, 0, 3),
    stats: { dribbling: 92 }
  });
  const firstTouchBall = makeBall(
    new THREE.Vector3(0, 0.22, -2),
    new THREE.Vector3(0, 0, 14)
  );
  const firstTouch = new FirstTouchSystem();
  const touchBefore = firstTouchBall.position.clone();
  const firstTouchResult = firstTouch.update({
    player: receiver,
    ball: firstTouchBall,
    random: () => random()
  });
  const retainedVelocity = firstTouchBall.velocity.clone();
  updateBallPhysics({
    ball: firstTouchBall,
    ballOwner: null,
    dt: 0.1,
    bounds: { halfWidth: 36, halfLength: 56 },
    ballRadius: 0.22,
    goalWidth: 13.5,
    playerForward: () => new THREE.Vector3(0, 0, 1),
    onGoal: () => undefined
  });

  const passer = makePlayer("home-passer", "home", new THREE.Vector3(0, 0, 0), {
    stats: { passing: 88 }
  });
  const movingReceiver = makePlayer("home-runner", "home", new THREE.Vector3(0, 0, 18), {
    role: "FWD",
    velocity: new THREE.Vector3(0, 0, 2.2)
  });
  const defender = makePlayer("away-interceptor", "away", new THREE.Vector3(0, 0, 6), {
    velocity: new THREE.Vector3()
  });
  const kickedBall = makeBall(new THREE.Vector3(0, 0.22, 0));
  const pass = createPassPlan({
    passer,
    teammates: [movingReceiver],
    opponents: [defender],
    intendedTarget: movingReceiver,
    ball: kickedBall,
    assist: 1,
    random: (min, max) => min + (max - min) * random()
  });
  if (!pass) throw new Error("Expected deterministic pass plan");
  kickedBall.velocity.copy(pass.trajectory.velocity);
  const passDt = 1 / 120;
  const receiverStart = movingReceiver.position.clone();
  const collisionEvents: BallCollisionEvent[] = [];
  let interceptedOwner: SimPlayer | null = null;
  let lastTouchPlayerId: string | null = null;
  for (let elapsed = 0; elapsed < pass.trajectory.travelTime; elapsed += passDt) {
    const step = Math.min(passDt, pass.trajectory.travelTime - elapsed);
    movingReceiver.position.addScaledVector(movingReceiver.velocity, step);
    updateBallPhysics({
      ball: kickedBall,
      ballOwner: null,
      dt: step,
      bounds: { halfWidth: 36, halfLength: 56 },
      ballRadius: 0.22,
      goalWidth: 13.5,
      playerForward: () => new THREE.Vector3(0, 0, 1),
      onGoal: () => undefined,
      collisionHooks: {
        bodies: [{
          id: defender.id,
          position: defender.position,
          radius: 0.72,
          height: 1.8,
          velocity: defender.velocity
        }],
        onCollision: (event) => {
          collisionEvents.push(event);
          lastTouchPlayerId = event.id ?? null;
        }
      }
    });
    if (collisionEvents.length > 0) {
      // Apply the production loose-ball collection rule after the physical
      // body contact. This makes the assertion an ownership transition, not
      // merely a prediction that a defender could reach the pass lane.
      const possession = resolvePossession({
        players: [passer, movingReceiver, defender],
        homePlayers: [passer, movingReceiver],
        awayPlayers: [defender],
        activePlayer: passer,
        ballOwner: null,
        ballPosition: kickedBall.position,
        random: (min) => min
      });
      interceptedOwner = possession?.owner ?? null;
      break;
    }
  }
  const interceptionCollision = collisionEvents[0] ?? null;

  const duelOwner = makePlayer("home-owner", "home", new THREE.Vector3(0, 0, 0), {
    stats: { pace: 40, dribbling: 25, defending: 20, physical: 25 }
  });
  const strongChallenger = makePlayer("away-strong", "away", new THREE.Vector3(0, 0, 0.95), {
    velocity: new THREE.Vector3(0, 0, -2),
    stats: { pace: 88, defending: 95, physical: 95 }
  });
  const weakChallenger = makePlayer("away-weak", "away", new THREE.Vector3(0, 0, 0.95), {
    velocity: new THREE.Vector3(0, 0, -2),
    stats: { pace: 40, defending: 20, physical: 25 }
  });
  const strongOwner = makePlayer("home-strong-owner", "home", new THREE.Vector3(0, 0, 0), {
    stats: { pace: 80, dribbling: 92, defending: 80, physical: 90 }
  });
  const duelInput = {
    owner: duelOwner,
    ballPosition: new THREE.Vector3(0, 0.2, 0.84),
    now: 4,
    action: "poke" as const
  };
  const successfulDuel = resolveDuel({ ...duelInput, challenger: strongChallenger, random: 1 });
  const failedDuel = resolveDuel({ ...duelInput, owner: strongOwner, challenger: weakChallenger, random: 0 });

  const duelSystem = new DuelSystem();
  const statefulInput = { ...duelInput, challenger: strongChallenger, random: 1 };
  duelSystem.resolve(statefulInput);
  const blocked = duelSystem.eligibility({ ...statefulInput, now: 4.1 });
  duelSystem.reset();
  const afterReset = duelSystem.eligibility({ ...statefulInput, now: 4.1 });

  return {
    dribble,
    firstTouch: {
      retained: firstTouchResult.retained,
      incomingSpeed: firstTouchResult.incomingSpeed,
      outgoingSpeed: retainedVelocity.length(),
      movedAfterTouch: firstTouchBall.position.distanceTo(touchBefore) > 0,
      outgoingVelocity: retainedVelocity.toArray()
    },
    pass: {
      targetLead: pass.requestedTarget.z - movingReceiver.position.z +
        movingReceiver.velocity.z * pass.trajectory.travelTime,
      receiverMoved: movingReceiver.position.distanceTo(receiverStart) > 0,
      predictedThreat: pass.interception.interceptable,
      intercepted: interceptedOwner?.id === defender.id,
      lastTouchPlayerId,
      collisionKind: interceptionCollision?.kind ?? null,
      deflected: interceptionCollision
        ? !interceptionCollision.outgoingVelocity.equals(interceptionCollision.incomingVelocity)
        : false,
      interceptorId: pass.interception.interceptorId,
      stoppedBeforeTarget: kickedBall.position.distanceTo(pass.trajectory.target) > 2,
      ballPosition: kickedBall.position.toArray()
    },
    duels: {
      successful: successfulDuel.status,
      failed: failedDuel.status,
      blockedReason: blocked.reason,
      resetEligible: afterReset.eligible
    }
  };
};

describe("Phase 6.5 realism core acceptance", () => {
  it("keeps physical touches, retained first touch, live receiver prediction and duels deterministic", () => {
    const first = runCoreRealismScenario();
    const second = runCoreRealismScenario();

    expect(first).toEqual(second);
    expect(first.dribble.releases).toBe(0);
    expect(first.dribble.touchCount).toBeGreaterThan(3);
    expect(first.dribble.maxSeparation).toBeLessThan(2);
    expect(first.firstTouch.retained).toBe(true);
    expect(first.firstTouch.outgoingSpeed).toBeGreaterThan(0);
    expect(first.firstTouch.outgoingSpeed).toBeLessThan(first.firstTouch.incomingSpeed);
    expect(first.firstTouch.movedAfterTouch).toBe(true);
    expect(first.pass.targetLead).toBeGreaterThan(0);
    expect(first.pass.receiverMoved).toBe(true);
    expect(first.pass.predictedThreat).toBe(true);
    expect(first.pass.intercepted).toBe(true);
    expect(first.pass.lastTouchPlayerId).toBe("away-interceptor");
    expect(first.pass.collisionKind).toBe("body");
    expect(first.pass.deflected).toBe(true);
    expect(first.pass.interceptorId).toBe("away-interceptor");
    expect(first.pass.stoppedBeforeTarget).toBe(true);
    expect(first.duels.successful).toBe("won");
    expect(first.duels.failed).toBe("lost");
    expect(["cooldown", "recovery"]).toContain(first.duels.blockedReason);
    expect(first.duels.resetEligible).toBe(true);
  });
});
