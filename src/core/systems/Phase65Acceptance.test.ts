import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  BallActionSystem,
  isBallActionContactReachable
} from "./BallActionSystem";
import { applyBallTrajectory, updateBallPhysics } from "./BallSystem";
import { getCameraRelativeDirection, getCameraScreenRight } from "./CameraSystem";
import { DribblingSystem, getDribbleAttachmentPoint } from "./DribblingSystem";
import { DuelSystem, resolveDuel } from "./DuelSystem";
import { FirstTouchSystem } from "./FirstTouchSystem";
import { predictAerialArrival, resolveAerialContest } from "./AerialSystem";
import { DEFAULT_BALL_PHYSICS_CONFIG } from "./GameplayConfig";
import { DEFAULT_MOVEMENT_CONFIG, updatePlayerMovement } from "./MovementSystem";
import {
  resolveOutOfPlay,
  sweepGoalLineCrossing
} from "./RestartSystem";
import { sweptKeeperContactBeforeGoalPlane } from "./GoalkeeperContact";
import type { SimBall, SimPlayer } from "./types";

const BALL_RADIUS = DEFAULT_BALL_PHYSICS_CONFIG.radius;
const FIELD = { halfWidth: 36, halfLength: 52.5 };
const GOAL_WIDTH = 13.5;
const EPSILON = 0.000001;

type PlayerOptions = {
  role?: SimPlayer["role"];
  velocity?: THREE.Vector3;
  hasBall?: boolean;
  stats?: Partial<SimPlayer["stats"]>;
};

function makePlayer(
  id: string,
  team: "home" | "away",
  position: THREE.Vector3,
  options: PlayerOptions = {}
): SimPlayer {
  return {
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
    intent: options.role === "GK" ? "keeper" : "hold",
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
  };
}

function makeBall(position: THREE.Vector3, velocity = new THREE.Vector3()): SimBall {
  return {
    position: position.clone(),
    velocity: velocity.clone(),
    spin: new THREE.Vector3(),
    mesh: new THREE.Mesh()
  };
}

function round(value: number) {
  return Number(value.toFixed(8));
}

function freeBallStep(ball: SimBall, dt: number) {
  return updateBallPhysics({
    ball,
    ballOwner: null,
    ballOwnerMode: "free",
    dt,
    bounds: FIELD,
    ballRadius: BALL_RADIUS,
    goalWidth: GOAL_WIDTH,
    playerForward: () => new THREE.Vector3(0, 0, 1),
    onGoal: () => undefined
  });
}

function runPhysicalDribble() {
  const player = makePlayer("home-carrier", "home", new THREE.Vector3(), {
    hasBall: true,
    stats: { pace: 82, dribbling: 88 }
  });
  const forward = () => new THREE.Vector3(0, 0, 1);
  const ball = makeBall(getDribbleAttachmentPoint(player, false, forward));
  const dribbling = new DribblingSystem({ mode: "impulse" });
  const dt = 1 / 120;
  let touchAppliedCount = 0;
  let touchCount = 0;
  let releaseCount = 0;
  let freeFlightFrames = 0;
  let maxSeparation = 0;

  for (let frame = 0; frame < 120; frame += 1) {
    const now = frame * dt;
    updatePlayerMovement({
      player,
      inputDirection: new THREE.Vector3(0, 0, 1),
      sprint: false,
      dt,
      now,
      bounds: FIELD,
      playerRadius: 0.75,
      isControlled: true,
      hasBall: player.hasBall,
      config: DEFAULT_MOVEMENT_CONFIG
    });
    const before = ball.position.clone();
    const result = dribbling.update({
      player,
      ball,
      dt,
      now,
      mode: "impulse",
      playerForward: forward,
      random: () => 1
    });
    if (result.touchApplied) touchAppliedCount += 1;
    touchCount = result.touchCount;
    if (result.shouldReleaseBall) {
      releaseCount += 1;
      player.hasBall = false;
    }
    freeBallStep(ball, dt);
    if (!result.touchApplied && ball.position.distanceTo(before) > EPSILON) {
      freeFlightFrames += 1;
    }
    maxSeparation = Math.max(
      maxSeparation,
      Math.hypot(ball.position.x - player.position.x, ball.position.z - player.position.z)
    );
  }

  return {
    touchAppliedCount,
    releaseCount,
    freeFlightFrames,
    touchCount,
    maxSeparation: round(maxSeparation),
    playerPosition: player.position.toArray().map(round),
    ballPosition: ball.position.toArray().map(round)
  };
}

type AerialCase = {
  action: "header" | "volley" | "clearance" | "keeperClaim";
  startHeight: number;
  arrivalHeight: number;
  player: SimPlayer;
  target?: THREE.Vector3;
  goalTarget?: THREE.Vector3;
};

function runAerialCase(input: AerialCase) {
  const start = new THREE.Vector3(0, input.startHeight, 8);
  const target = input.target?.clone() ?? new THREE.Vector3(0, 0, 8);
  const ball = makeBall(start);
  const arrival = predictAerialArrival({
    ball,
    target,
    contactHeight: input.arrivalHeight,
    gravity: DEFAULT_BALL_PHYSICS_CONFIG.gravity,
    maxTime: 2
  });
  if (!arrival) throw new Error(`Expected ${input.action} aerial arrival`);

  let elapsed = 0;
  while (elapsed < arrival.time - EPSILON) {
    const dt = Math.min(1 / 240, arrival.time - elapsed);
    freeBallStep(ball, dt);
    elapsed += dt;
  }
  const trajectoryPoint = ball.position.clone();
  const beforeResolution = ball.position.clone();
  const contest = resolveAerialContest({
    ball,
    players: [input.player],
    attackingTeam: "home",
    target,
    goalTarget: input.goalTarget,
    contactHeight: 1.28
  });
  if (!contest) throw new Error(`Expected ${input.action} aerial contest`);

  // Apply the returned physical velocity only after recording the actual
  // trajectory point. Aerial resolution must never move the ball to a winner.
  applyBallTrajectory(ball, contest.velocity);
  let controlledOwnerId: string | null = null;
  let ballAttachedToOwner = false;
  if (contest.action !== "keeperClaim") {
    freeBallStep(ball, 1 / 120);
  } else {
    // A keeper claim is a controlled ownership transition: the production
    // resolver stops the outgoing trajectory, while this headless harness
    // records the attachment that the runtime would use for the next tick.
    controlledOwnerId = contest.player.id;
    ballAttachedToOwner = contest.velocity.length() <= EPSILON &&
      contest.point.distanceTo(ball.position) <= EPSILON;
  }

  return {
    action: contest.action,
    predictedTime: round(arrival.time),
    arrivedAt: trajectoryPoint.toArray().map(round),
    noTeleport: contest.point.distanceTo(beforeResolution) <= EPSILON &&
      ball.position.y !== start.y,
    outgoingSpeed: round(contest.velocity.length()),
    controlledOwnerId,
    ballAttachedToOwner,
    movedAfterResolution: ball.position.distanceTo(beforeResolution) > EPSILON
  };
}

function runPhase65Scenario() {
  const actions = new BallActionSystem();
  const action = actions.queue({
    ownerId: "home-9",
    kind: "pass",
    now: 0,
    timing: { prepare: 0, contact: 0.2, recovery: 0.5 }
  });
  const prepareEvents = actions.advance(0);
  const pausedAt = 0.1;
  const pausedFirstRead = actions.advance(pausedAt);
  const pausedSecondRead = actions.advance(pausedAt);
  const contactEvents = actions.advance(0.2);
  const duplicateContactEvents = actions.advance(0.2);
  const releaseOwner = makePlayer("home-9", "home", new THREE.Vector3(), { hasBall: true });
  const releaseBall = makeBall(new THREE.Vector3(0, BALL_RADIUS, 0));
  let ballOwner: SimPlayer | null = releaseOwner;
  let physicalReleases = 0;
  let trajectoryApplications = 0;
  const releaseVelocity = new THREE.Vector3(0, 0, 8);
  const applyReachableContact = (events: ReturnType<BallActionSystem["advance"]>) => {
    for (const event of events) {
      if (event.phase !== "contact" || !ballOwner) continue;
      const ownerPosition = ballOwner.position;
      const ballPosition = releaseBall.position;
      if (isBallActionContactReachable({
        ownerId: event.action.ownerId,
        currentOwnerId: ballOwner.id,
        ownerPosition,
        ballPosition,
        ballRadius: BALL_RADIUS
      })) {
        applyBallTrajectory(releaseBall, releaseVelocity);
        trajectoryApplications += 1;
        physicalReleases += 1;
        ballOwner = null;
      }
    }
  };
  applyReachableContact(contactEvents);
  const positionBeforeReleaseStep = releaseBall.position.clone();
  freeBallStep(releaseBall, 1 / 60);
  const positionAfterReleaseStep = releaseBall.position.clone();
  applyReachableContact(duplicateContactEvents);
  const positionAfterReplay = releaseBall.position.clone();
  const recoveryEvents = actions.advance(0.5);

  const staleAction = actions.queue({
    ownerId: "home-7",
    kind: "shot",
    now: 1,
    timing: { prepare: 0, contact: 0.25, recovery: 0.4 }
  });
  actions.advance(1);
  const turnoverEvents = actions.cancelOwner("home-7", "ownership-lost", 1.05);
  const staleFutureEvents = actions.advance(2);

  const resetAction = actions.queue({
    ownerId: "home-8",
    kind: "cross",
    now: 2,
    timing: { prepare: 0, contact: 0.3, recovery: 0.5 }
  });
  actions.advance(2);
  const generationBeforeReset = actions.generation;
  const resetEvents = actions.reset("cancelled", 2.1);
  const generationAfterReset = actions.generation;
  const freshAction = actions.queue({
    ownerId: "home-8",
    kind: "pass",
    now: 0,
    timing: { prepare: 0, contact: 0.01, recovery: 0.02 }
  });
  actions.advance(0);
  actions.advance(0.02);

  const dribble = runPhysicalDribble();

  const receiver = makePlayer("home-receiver", "home", new THREE.Vector3(), {
    velocity: new THREE.Vector3(0, 0, 3),
    stats: { dribbling: 92 }
  });
  const firstTouchBall = makeBall(
    new THREE.Vector3(0, BALL_RADIUS, -2),
    new THREE.Vector3(0, 0, 14)
  );
  const firstTouchBefore = firstTouchBall.position.clone();
  const firstTouch = new FirstTouchSystem().update({
    player: receiver,
    ball: firstTouchBall,
    controlDirection: new THREE.Vector3(0, 0, 1),
    random: () => 0.5
  });
  const firstTouchPosition = firstTouchBall.position.clone();
  freeBallStep(firstTouchBall, 0.1);

  const duelOwner = makePlayer("home-owner", "home", new THREE.Vector3(), {
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
  const strongOwner = makePlayer("home-strong-owner", "home", new THREE.Vector3(), {
    stats: { pace: 80, dribbling: 92, defending: 80, physical: 90 }
  });
  const duelInput = {
    owner: duelOwner,
    ballPosition: new THREE.Vector3(0, BALL_RADIUS, 0.84),
    now: 4,
    action: "poke" as const
  };
  const duelWin = resolveDuel({ ...duelInput, challenger: strongChallenger, random: 1 });
  const duelLoss = resolveDuel({
    ...duelInput,
    owner: strongOwner,
    challenger: weakChallenger,
    random: 0
  });
  const duelSystem = new DuelSystem();
  duelSystem.resolve({ ...duelInput, challenger: strongChallenger, random: 1 });
  const duelDuringRecovery = duelSystem.eligibility({
    ...duelInput,
    challenger: strongChallenger,
    now: 4.1
  });
  duelSystem.reset();
  const duelAfterReset = duelSystem.eligibility({
    ...duelInput,
    challenger: strongChallenger,
    now: 4.1
  });

  const cameraForward = new THREE.Vector3(-1, -0.3, 0).normalize();
  const screenRight = getCameraScreenRight(cameraForward);
  const cameraRightInput = getCameraRelativeDirection(
    new THREE.Vector3(1, 0, 0),
    cameraForward
  );
  const cameraForwardInput = getCameraRelativeDirection(
    new THREE.Vector3(0, 0, 1),
    cameraForward
  );

  const plane = FIELD.halfLength + BALL_RADIUS;
  const goalStart = new THREE.Vector3(0, BALL_RADIUS, FIELD.halfLength - 0.1);
  const goalEnd = new THREE.Vector3(0, BALL_RADIUS, FIELD.halfLength + 0.4);
  const goalCrossing = sweepGoalLineCrossing({
    previousPosition: goalStart,
    position: goalEnd,
    bounds: FIELD,
    ballRadius: BALL_RADIUS,
    goalWidth: GOAL_WIDTH
  });
  const goalDecision = resolveOutOfPlay({
    previousPosition: goalStart,
    position: goalEnd,
    bounds: FIELD,
    ballRadius: BALL_RADIUS,
    goalWidth: GOAL_WIDTH,
    lastTouchTeam: "home"
  });
  const keeperSave = sweptKeeperContactBeforeGoalPlane({
    start: new THREE.Vector3(0, 1.2, 50.5),
    end: new THREE.Vector3(0, 1.2, 53),
    keeperCenter: new THREE.Vector3(0, 1.2, 51.3),
    reach: 0.6,
    goalSide: 1,
    wholeBallGoalPlane: plane,
    maxContactHeight: 4.8
  });
  const outOfReachKeeper = sweptKeeperContactBeforeGoalPlane({
    start: new THREE.Vector3(0, BALL_RADIUS, FIELD.halfLength),
    end: new THREE.Vector3(0, BALL_RADIUS, FIELD.halfLength + 0.5),
    keeperCenter: new THREE.Vector3(0, BALL_RADIUS, 50),
    reach: 0.4,
    goalSide: 1,
    wholeBallGoalPlane: plane,
    maxContactHeight: 4.8
  });
  const alreadyPastPlane = sweptKeeperContactBeforeGoalPlane({
    start: new THREE.Vector3(0, BALL_RADIUS, plane + 0.02),
    end: new THREE.Vector3(0, BALL_RADIUS, plane + 0.4),
    keeperCenter: new THREE.Vector3(0, BALL_RADIUS, plane + 0.1),
    reach: 2,
    goalSide: 1,
    wholeBallGoalPlane: plane,
    maxContactHeight: 4.8
  });

  const aerialHeader = runAerialCase({
    action: "header",
    startHeight: 2.4,
    arrivalHeight: 1.7,
    player: makePlayer("home-header", "home", new THREE.Vector3(0, 0, 8), {
      role: "FWD"
    }),
    goalTarget: new THREE.Vector3(0, 1.8, 56)
  });
  const aerialVolley = runAerialCase({
    action: "volley",
    // Keep the descending speed in the production volley window (<3.2 m/s),
    // rather than making a hard drop that should correctly classify as a
    // header even when it arrives low.
    startHeight: 1.3,
    arrivalHeight: 1.05,
    player: makePlayer("home-volley", "home", new THREE.Vector3(0, 0, 8), {
      role: "FWD"
    }),
    goalTarget: new THREE.Vector3(0, 1.4, 56)
  });
  const aerialClearance = runAerialCase({
    action: "clearance",
    startHeight: 2.4,
    arrivalHeight: 1.7,
    player: makePlayer("away-clearance", "away", new THREE.Vector3(0, 0, 8), {
      role: "DEF"
    })
  });
  const aerialKeeper = runAerialCase({
    action: "keeperClaim",
    startHeight: 2.4,
    arrivalHeight: 1.7,
    player: makePlayer("away-keeper", "away", new THREE.Vector3(0, 0, 8), {
      role: "GK"
    })
  });

  return {
    action: {
      phases: [
        ...prepareEvents,
        ...contactEvents,
        ...recoveryEvents
      ].map((event) => event.phase),
      pausedReads: [pausedFirstRead.length, pausedSecondRead.length],
      duplicateContactEvents: duplicateContactEvents.length,
      physicalReleases,
      trajectoryApplications,
      ballOwnerAfterRelease: ballOwner?.id ?? null,
      releaseDistance: round(positionAfterReleaseStep.distanceTo(positionBeforeReleaseStep)),
      replayDistance: round(positionAfterReplay.distanceTo(positionAfterReleaseStep)),
      activeAfterRecovery: actions.activeCount === 0,
      turnoverCancelled: turnoverEvents.some((event) => event.action.id === staleAction.id && event.reason === "ownership-lost"),
      staleFutureContact: staleFutureEvents.some((event) => event.phase === "contact"),
      resetCancelled: resetEvents.some((event) => event.action.id === resetAction.id),
      generationDelta: generationAfterReset - generationBeforeReset,
      freshActionId: freshAction.id,
      activeAfterReset: actions.activeCount === 0
    },
    dribble,
    firstTouch: {
      retained: firstTouch.retained,
      incomingSpeed: round(firstTouch.incomingSpeed),
      outgoingSpeed: round(firstTouch.outgoingVelocity.length()),
      positionChanged: firstTouchPosition.distanceTo(firstTouchBefore) > EPSILON,
      movedAfterTouch: firstTouchBall.position.distanceTo(firstTouchPosition) > EPSILON
    },
    duel: {
      win: duelWin.status,
      loss: duelLoss.status,
      blocked: duelDuringRecovery.reason,
      eligibleAfterReset: duelAfterReset.eligible
    },
    camera: {
      screenRight: screenRight.toArray().map(round),
      rightInputDot: round(cameraRightInput.dot(screenRight)),
      forwardInputDot: round(cameraForwardInput.dot(cameraForward.clone().setY(0).normalize()))
    },
    goal: {
      plane,
      crossingPlane: goalCrossing?.plane ?? null,
      crossingZ: goalCrossing?.position.z ?? null,
      decision: goalDecision?.kind ?? null,
      scoringTeam: goalDecision?.kind === "goal" ? goalDecision.team : null,
      keeperSaveBeforePlane: keeperSave !== null && keeperSave.point.z < plane,
      keeperSaveBeforePlaneTime: keeperSave !== null && keeperSave.time < keeperSave.planeTime,
      outOfReachKeeper: outOfReachKeeper === null,
      alreadyPastPlaneNotRescued: alreadyPastPlane === null
    },
    aerial: [aerialHeader, aerialVolley, aerialClearance, aerialKeeper]
  };
}

describe("Phase 6.5 cross-system acceptance", () => {
  it("replays one deterministic headless realism orchestration across cooperating systems", () => {
    const first = runPhase65Scenario();
    const second = runPhase65Scenario();

    expect(first).toEqual(second);

    expect(first.action.phases).toEqual(["prepare", "contact", "recovery"]);
    expect(first.action.pausedReads).toEqual([0, 0]);
    expect(first.action.duplicateContactEvents).toBe(0);
    expect(first.action.physicalReleases).toBe(1);
    expect(first.action.trajectoryApplications).toBe(1);
    expect(first.action.ballOwnerAfterRelease).toBeNull();
    expect(first.action.releaseDistance).toBeGreaterThan(0);
    expect(first.action.replayDistance).toBe(0);
    expect(first.action.activeAfterRecovery).toBe(true);
    expect(first.action.turnoverCancelled).toBe(true);
    expect(first.action.staleFutureContact).toBe(false);
    expect(first.action.resetCancelled).toBe(true);
    expect(first.action.generationDelta).toBe(1);
    expect(first.action.freshActionId).toBe(1);
    expect(first.action.activeAfterReset).toBe(true);

    expect(first.dribble.touchAppliedCount).toBeGreaterThan(3);
    expect(first.dribble.touchCount).toBe(first.dribble.touchAppliedCount);
    expect(first.dribble.releaseCount).toBe(0);
    expect(first.dribble.freeFlightFrames).toBeGreaterThan(3);
    expect(first.dribble.maxSeparation).toBeLessThan(2);
    expect(first.firstTouch.retained).toBe(true);
    expect(first.firstTouch.outgoingSpeed).toBeGreaterThan(0);
    expect(first.firstTouch.outgoingSpeed).toBeLessThan(first.firstTouch.incomingSpeed);
    expect(first.firstTouch.positionChanged).toBe(true);
    expect(first.firstTouch.movedAfterTouch).toBe(true);

    expect(first.duel.win).toBe("won");
    expect(first.duel.loss).toBe("lost");
    expect(["cooldown", "recovery"]).toContain(first.duel.blocked);
    expect(first.duel.eligibleAfterReset).toBe(true);

    expect(first.camera.screenRight[2]).toBeLessThan(-0.99);
    expect(first.camera.rightInputDot).toBeGreaterThan(0.99);
    expect(first.camera.forwardInputDot).toBeGreaterThan(0.99);

    expect(first.goal.crossingPlane).toBeCloseTo(first.goal.plane);
    expect(first.goal.crossingZ).toBeCloseTo(first.goal.plane);
    expect(first.goal.decision).toBe("goal");
    expect(first.goal.scoringTeam).toBe("home");
    expect(first.goal.keeperSaveBeforePlane).toBe(true);
    expect(first.goal.keeperSaveBeforePlaneTime).toBe(true);
    expect(first.goal.outOfReachKeeper).toBe(true);
    expect(first.goal.alreadyPastPlaneNotRescued).toBe(true);

    expect(first.aerial.map((result) => result.action)).toEqual([
      "header",
      "volley",
      "clearance",
      "keeperClaim"
    ]);
    expect(first.aerial.every((result) => result.noTeleport)).toBe(true);
    expect(first.aerial.slice(0, 3).every((result) => result.outgoingSpeed > 0)).toBe(true);
    expect(first.aerial.slice(0, 3).every((result) => result.movedAfterResolution)).toBe(true);
    expect(first.aerial[3].outgoingSpeed).toBe(0);
    expect(first.aerial[3].movedAfterResolution).toBe(false);
    expect(first.aerial[3].controlledOwnerId).toBe("away-keeper");
    expect(first.aerial[3].ballAttachedToOwner).toBe(true);
  });
});
