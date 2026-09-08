import * as THREE from "three";
import type { TeamId } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";
import { DEFAULT_BALL_PHYSICS_CONFIG, type BallPhysicsConfig } from "./GameplayConfig";
import { isGoalCrossed, isInsideGoalMouth } from "./MatchRuleSystem";
import { resolveOutOfPlay } from "./RestartSystem";
import type { AttackingDirections, RestartPlan } from "./RestartSystem";

export type BallCollisionBody = {
  id?: string;
  position: THREE.Vector3;
  radius: number;
  /** Capsule height above the pitch; omitted means a spherical body. */
  height?: number;
  velocity?: THREE.Vector3;
};

export type BallCrossbar = {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
};

export type BallCollisionEvent = {
  kind: "post" | "crossbar" | "body";
  id?: string;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  incomingVelocity: THREE.Vector3;
  outgoingVelocity: THREE.Vector3;
  relativeSpeed: number;
};

export type BallCollisionHooks = {
  /** Legacy point posts; use postBodies for full vertical capsules. */
  posts?: readonly THREE.Vector3[];
  postBodies?: readonly BallCollisionBody[];
  postRadius?: number;
  crossbar?: BallCrossbar;
  bodies?: readonly BallCollisionBody[];
  onCollision?: (event: BallCollisionEvent) => void;
};

export type BallPhysicsInput = {
  ball: SimBall;
  ballOwner: SimPlayer | null;
  dt: number;
  bounds: FieldBounds;
  ballRadius: number;
  goalWidth: number;
  playerForward: (player: SimPlayer) => THREE.Vector3;
  onGoal: (team: TeamId) => void;
  /** Opt into Phase 4 boundaries. Omitting this retains the legacy rebound game. */
  onOutOfPlay?: (restart: RestartPlan) => void;
  lastTouchTeam?: TeamId | null;
  attackingDirections?: AttackingDirections;
  /** Use "free" while an impulse dribble owner remains in possession. */
  ballOwnerMode?: "attachment" | "free";
  /** Additive static/body collision hooks; omitted retains pitch-only physics. */
  collisionHooks?: BallCollisionHooks;
  config?: Partial<BallPhysicsConfig>;
};

export type BallPhysicsResult = {
  advancedSeconds: number;
  substeps: number;
  collisions: BallCollisionEvent[];
  boundary: boolean;
};

export type BallKickOptions = {
  /** Spin around the local x/y/z axes. y is the horizontal curl placeholder. */
  spin?: THREE.Vector3;
  /** Convenience alias for horizontal curl when a full spin vector is not needed. */
  curve?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const mergedPhysics = (config?: Partial<BallPhysicsConfig>): BallPhysicsConfig => ({
  ...DEFAULT_BALL_PHYSICS_CONFIG,
  ...config
});

const closestPointOnSegment = (point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3) => {
  const segment = end.clone().sub(start);
  const lengthSq = segment.lengthSq();
  const t = lengthSq <= 0.000001
    ? 0
    : clamp(point.clone().sub(start).dot(segment) / lengthSq, 0, 1);
  return start.clone().addScaledVector(segment, t);
};

const safeNormal = (value: THREE.Vector3, fallback: THREE.Vector3) => {
  if (value.lengthSq() > 0.000001) return value.normalize();
  if (fallback.lengthSq() > 0.000001) return fallback.normalize();
  return new THREE.Vector3(0, 1, 0);
};

const sweptSphereContact = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  center: THREE.Vector3,
  radius: number
) => {
  const movement = end.clone().sub(start);
  const radiusSq = radius * radius;
  const startOffset = start.clone().sub(center);
  const startDistanceSq = startOffset.lengthSq();
  if (startDistanceSq <= radiusSq + 0.000001) {
    const normal = safeNormal(startOffset, movement.clone().negate());
    // Already separating from an overlap: let the ball leave the surface and
    // avoid repeatedly reflecting it on every substep.
    if (movement.dot(normal) >= 0) return null;
    return {
      point: start.clone(),
      surfacePoint: center.clone().addScaledVector(normal, radius),
      normal,
      time: 0
    };
  }
  const a = movement.lengthSq();
  if (a <= 0.000001) return null;
  const b = 2 * startOffset.dot(movement);
  const c = startDistanceSq - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  const time = t0 >= 0 && t0 <= 1 ? t0 : t1 >= 0 && t1 <= 1 ? t1 : null;
  if (time === null) return null;
  const point = start.clone().addScaledVector(movement, time);
  const normal = safeNormal(point.clone().sub(center), movement.clone().negate());
  return {
    point,
    surfacePoint: center.clone().addScaledVector(normal, radius),
    normal,
    time
  };
};

function findBodyContact(start: THREE.Vector3, end: THREE.Vector3, body: BallCollisionBody, ballRadius: number) {
  const height = Math.max(0, body.height ?? 0);
  if (height <= 0) {
    return sweptSphereContact(start, end, body.position, body.radius + ballRadius);
  }
  // A vertical capsule is represented by its centre line. Checking the
  // nearest point on that segment catches a fast ball crossing the torso or
  // legs without requiring a physics dependency.
  const capsuleStart = body.position.clone();
  const capsuleEnd = body.position.clone().add(new THREE.Vector3(0, height, 0));
  const mid = start.clone().lerp(end, 0.5);
  const bodyPoint = closestPointOnSegment(mid, capsuleStart, capsuleEnd);
  const contact = sweptSphereContact(start, end, bodyPoint, body.radius + ballRadius);
  return contact;
}

function resolveCollision(
  ball: SimBall,
  start: THREE.Vector3,
  contact: { point: THREE.Vector3; surfacePoint?: THREE.Vector3; normal: THREE.Vector3 },
  kind: BallCollisionEvent["kind"],
  id: string | undefined,
  restitution: number,
  bodyVelocity: THREE.Vector3 | undefined,
  onCollision: ((event: BallCollisionEvent) => void) | undefined
) {
  const incoming = ball.velocity.clone();
  const relative = incoming.clone().sub(bodyVelocity ?? new THREE.Vector3());
  const normal = contact.normal.clone();
  const closing = relative.dot(normal);
  if (closing < 0) {
    relative.addScaledVector(normal, -(1 + restitution) * closing);
    ball.velocity.copy(relative).add(bodyVelocity ?? new THREE.Vector3());
  }
  ball.position.copy(contact.surfacePoint ?? contact.point).addScaledVector(normal, 0.002);
  const event: BallCollisionEvent = {
    kind,
    id,
    point: ball.position.clone(),
    normal,
    incomingVelocity: incoming,
    outgoingVelocity: ball.velocity.clone(),
    relativeSpeed: Math.abs(closing)
  };
  onCollision?.(event);
  return event;
}

export function updateBallPhysics({
  ball,
  ballOwner,
  dt,
  bounds,
  ballRadius,
  goalWidth,
  playerForward,
  onGoal,
  onOutOfPlay,
  lastTouchTeam,
  attackingDirections,
  ballOwnerMode = "attachment",
  collisionHooks,
  config: configOverrides
}: BallPhysicsInput): BallPhysicsResult {
  const config = mergedPhysics(configOverrides);
  const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
  const resolvedRadius = Math.max(0.001, Number.isFinite(ballRadius) ? ballRadius : config.radius);
  const collisions: BallCollisionEvent[] = [];
  let boundary = false;
  const checkBoundary = (previousPosition: THREE.Vector3) => {
    if (!onOutOfPlay) return false;
    const result = resolveOutOfPlay({
      previousPosition,
      position: ball.position,
      bounds,
      ballRadius: resolvedRadius,
      goalWidth,
      lastTouchTeam: ballOwner?.team ?? lastTouchTeam,
      attackingDirections
    });
    if (!result) return false;
    boundary = true;
    ball.mesh.position.copy(ball.position);
    if (result.kind === "goal") onGoal(result.team);
    else onOutOfPlay(result.restart);
    return true;
  };
  if (ballOwner && ballOwnerMode === "attachment") {
    const forward = playerForward(ballOwner);
    const foot = ballOwner.position.clone().add(forward.multiplyScalar(1.05));
    foot.y = resolvedRadius;
    ball.position.lerp(foot, clamp(safeDt * 18, 0, 1));
    if (ball.spin) ball.spin.multiplyScalar(Math.exp(-2.53 * safeDt));
    ball.mesh.position.copy(ball.position);
    checkBoundary(ballOwner.position.clone().add(new THREE.Vector3(0, resolvedRadius, 0)));
    return { advancedSeconds: safeDt, substeps: safeDt > 0 ? 1 : 0, collisions, boundary };
  }

  const substeps = safeDt <= 0 ? 0 : Math.max(1, Math.ceil(safeDt / Math.max(config.maxSubstep, 1 / 240)));
  const stepDt = substeps > 0 ? safeDt / substeps : 0;
  for (let stepIndex = 0; stepIndex < substeps; stepIndex += 1) {
    const previousPosition = ball.position.clone();

    if (ball.spin && ball.spin.lengthSq() > 0.000001) {
      const horizontalSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
      if (horizontalSpeed > 0.05) {
        const curve = ball.spin.y * config.magnusStrength * horizontalSpeed * stepDt;
        const perpendicularX = -ball.velocity.z / horizontalSpeed;
        const perpendicularZ = ball.velocity.x / horizontalSpeed;
        ball.velocity.x += perpendicularX * curve;
        ball.velocity.z += perpendicularZ * curve;
      }
      ball.velocity.y += ball.spin.x * 1.8 * stepDt;
      ball.spin.multiplyScalar(Math.exp(-config.spinDecayPerSecond * stepDt));
    }

    ball.velocity.y -= config.gravity * stepDt;
    ball.position.addScaledVector(ball.velocity, stepDt);

    // Swept contacts are evaluated against the full substep segment so a
    // fast shot cannot tunnel through a post, crossbar, or player capsule.
    if (collisionHooks) {
      const candidates: Array<{
        contact: { point: THREE.Vector3; surfacePoint?: THREE.Vector3; normal: THREE.Vector3; time: number };
        kind: BallCollisionEvent["kind"];
        id?: string;
        restitution: number;
        velocity?: THREE.Vector3;
      }> = [];
      const postRadius = Math.max(0.001, collisionHooks.postRadius ?? 0.14);
      for (let index = 0; index < (collisionHooks.posts?.length ?? 0); index += 1) {
        const post = collisionHooks.posts![index];
        const contact = sweptSphereContact(previousPosition, ball.position, post, postRadius + resolvedRadius);
        if (contact) candidates.push({ contact, kind: "post", id: `post-${index}`, restitution: config.postRestitution });
      }
      for (let index = 0; index < (collisionHooks.postBodies?.length ?? 0); index += 1) {
        const body = collisionHooks.postBodies![index];
        const contact = findBodyContact(previousPosition, ball.position, body, resolvedRadius);
        if (contact) candidates.push({ contact, kind: "post", id: body.id ?? `post-body-${index}`, restitution: config.postRestitution, velocity: body.velocity });
      }
      if (collisionHooks.crossbar) {
        const crossbar = collisionHooks.crossbar;
        const pathMid = previousPosition.clone().lerp(ball.position, 0.5);
        const barPoint = closestPointOnSegment(pathMid, crossbar.start, crossbar.end);
        const contact = sweptSphereContact(previousPosition, ball.position, barPoint, crossbar.radius + resolvedRadius);
        if (contact) candidates.push({ contact, kind: "crossbar", id: "crossbar", restitution: config.postRestitution });
      }
      for (const body of collisionHooks.bodies ?? []) {
        const contact = findBodyContact(previousPosition, ball.position, body, resolvedRadius);
        if (contact) candidates.push({ contact, kind: "body", id: body.id, restitution: config.bodyRestitution, velocity: body.velocity });
      }
      candidates.sort((a, b) => a.contact.time - b.contact.time || a.kind.localeCompare(b.kind) || (a.id ?? "").localeCompare(b.id ?? ""));
      const first = candidates[0];
      if (first) {
        collisions.push(resolveCollision(ball, previousPosition, first.contact, first.kind, first.id, first.restitution, first.velocity, collisionHooks.onCollision));
      }
    }

    if (ball.position.y < resolvedRadius) {
      ball.position.y = resolvedRadius;
      if (ball.velocity.y < 0) {
        ball.velocity.y *= -config.groundRestitution;
        if (Math.abs(ball.velocity.y) < 0.42) ball.velocity.y = 0;
      }
      const friction = Math.exp(-config.groundFrictionPerSecond * stepDt);
      ball.velocity.x *= friction;
      ball.velocity.z *= friction;
    } else {
      const air = Math.exp(-config.airDragPerSecond * stepDt);
      ball.velocity.x *= air;
      ball.velocity.z *= air;
    }

    if (checkBoundary(previousPosition)) break;

    if (!onOutOfPlay && Math.abs(ball.position.x) > bounds.halfWidth - resolvedRadius) {
      ball.position.x = Math.sign(ball.position.x) * (bounds.halfWidth - resolvedRadius);
      ball.velocity.x *= -config.postRestitution;
      // Keep the post-bounce contact point stable for this simulation tick;
      // the reflected velocity is integrated on the next tick.
      break;
    }

    if (!onOutOfPlay && Math.abs(ball.position.z) > bounds.halfLength - resolvedRadius) {
      if (isGoalCrossed(ball.position.z, ball.position.x, ball.position.y, bounds.halfLength, goalWidth)) {
        onGoal(ball.position.z > 0 ? "home" : "away");
        boundary = true;
        break;
      }
      // Leave the goal mouth open while the ball travels from the pitch edge
      // to the scoring plane. Bouncing here used to make 60 Hz goals impossible.
      if (!isInsideGoalMouth(ball.position.x, ball.position.y, goalWidth)) {
        ball.position.z = Math.sign(ball.position.z) * (bounds.halfLength - resolvedRadius);
        ball.velocity.z *= -config.postRestitution;
        break;
      }
    }

    ball.mesh.rotation.x += ball.velocity.z * stepDt * config.rollingSpinStrength;
    ball.mesh.rotation.z -= ball.velocity.x * stepDt * config.rollingSpinStrength;
  }

  ball.mesh.position.copy(ball.position);
  return { advancedSeconds: safeDt, substeps, collisions, boundary };
}

export function kickBall(ball: SimBall, target: THREE.Vector3, strength: number, lift = 0, options: BallKickOptions = {}) {
  const direction = target.clone().sub(ball.position);
  if (direction.lengthSq() < 0.000001) {
    direction.set(0, 0, 1);
  } else {
    direction.normalize();
  }
  ball.velocity.copy(direction.multiplyScalar(strength));
  ball.velocity.y += lift;
  if (ball.spin) ball.spin.set(0, 0, 0);
  if (options.spin || options.curve !== undefined) {
    if (!ball.spin) ball.spin = new THREE.Vector3();
    if (options.spin) ball.spin.copy(options.spin);
    if (options.curve !== undefined) ball.spin.y = options.curve;
  }
}

/** Apply a precomputed trajectory from PassingSystem or ShootingSystem. */
export function applyBallTrajectory(ball: SimBall, velocity: THREE.Vector3, spin?: THREE.Vector3) {
  ball.velocity.copy(velocity);
  if (spin) {
    if (!ball.spin) ball.spin = new THREE.Vector3();
    ball.spin.copy(spin);
  } else if (ball.spin) {
    ball.spin.set(0, 0, 0);
  }
  return ball;
}
