import * as THREE from "three";
import type { PlayerData, TeamData } from "../data/types";
import type { SimPlayer } from "../core/systems/types";

export type PlayerAction = "kick" | "pass" | "shot" | "clearance" | "header" | "volley" | "tackle" | "dive" | "celebrate";
export type PreferredFoot = "left" | "right";
export type ActionClock = "renderer" | "simulation";

export type ActionTimingOptions = {
  /** Normalized point in the action at which the foot meets the contact marker. */
  contactAt?: number;
  /** Contact foot selected by the simulation/card data. */
  preferredFoot?: PreferredFoot;
  /** Optional world-space point for a ball/tackle contact marker. */
  contactTarget?: THREE.Vector3;
  /** Simulation-owned actions advance only when syncActionContact supplies elapsed time. */
  clock?: ActionClock;
  /** Full duration in seconds; invalid values fall back to the action default. */
  duration?: number;
  /** Signed visual direction used by dives and legacy callers. */
  direction?: number;
};

export type ActionContactSync = {
  elapsed?: number;
  progress?: number;
  contactAt?: number;
  preferredFoot?: PreferredFoot;
  contactTarget?: THREE.Vector3;
};

export type PlayerRig = {
  pose: THREE.Group;
  torso: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftElbow: THREE.Object3D;
  rightElbow: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  leftKnee: THREE.Object3D;
  rightKnee: THREE.Object3D;
  leftFoot: THREE.Object3D;
  rightFoot: THREE.Object3D;
  skeleton: THREE.Skeleton;
};

// Shared geometry keeps the 22-player procedural roster inexpensive. The body
// shell is a skinned capsule, while the smaller kit/skin pieces remain attached
// to the same Bone hierarchy for crisp joints at the broadcast distance.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.SphereGeometry(1, 10, 8);
const unitLimb = new THREE.CapsuleGeometry(1, 0.01, 3, 8);
unitLimb.scale(1, 0.5, 1);
const unitShorts = new THREE.CapsuleGeometry(1, 0.08, 3, 8);
unitShorts.scale(1, 0.27, 1);
const bodyGeometry = new THREE.CapsuleGeometry(0.48, 0.62, 4, 8);
bodyGeometry.scale(1.05, 0.78, 0.82);
const bodyPosition = bodyGeometry.getAttribute("position");
const bodySkinIndices = new Uint16Array(bodyPosition.count * 4);
const bodySkinWeights = new Float32Array(bodyPosition.count * 4);
for (let index = 0; index < bodyPosition.count; index += 1) {
  // Smoothly divide the shirt between the hip, spine and chest bones. This
  // keeps the waist stable while allowing the torso to twist with a kick.
  const y = THREE.MathUtils.clamp((bodyPosition.getY(index) + 0.61) / 1.22, 0, 1);
  const chest = THREE.MathUtils.smoothstep(y, 0.42, 0.92);
  const hips = 1 - chest;
  bodySkinIndices[index * 4] = 1; // hips
  bodySkinIndices[index * 4 + 1] = 2; // spine
  bodySkinWeights[index * 4] = hips * 0.55;
  bodySkinWeights[index * 4 + 1] = hips * 0.45;
  bodySkinIndices[index * 4 + 2] = 3; // chest
  bodySkinWeights[index * 4 + 2] = chest;
  bodySkinWeights[index * 4 + 3] = 0;
}
bodyGeometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(bodySkinIndices, 4));
bodyGeometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(bodySkinWeights, 4));
const shirtNumberGeometry = new THREE.PlaneGeometry(0.46, 0.54);
const markerGeometry = new THREE.RingGeometry(0.96, 1.15, 32);
const rigs = new WeakMap<THREE.Group, PlayerRig>();
const durations: Record<PlayerAction, number> = {
  kick: 0.48, pass: 0.42, shot: 0.62, clearance: 0.52, header: 0.5, volley: 0.48,
  tackle: 0.7, dive: 0.9, celebrate: 2.4
};
const contactMarkers: Record<PlayerAction, number> = {
  kick: 0.46, pass: 0.5, shot: 0.44, clearance: 0.4, header: 0.34, volley: 0.4,
  tackle: 0.38, dive: 0.48, celebrate: 0.52
};

function part(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D,
  x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  // Only the main silhouette pieces cast dynamic shadows (enabled below).
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

/** DOM-free articulated model. Root transform belongs exclusively to gameplay. */
export function createPlayerRig(team: TeamData, spec: PlayerData) {
  const keeper = spec.role === "GK";
  const mat = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: 0.86 });
  const shirt = mat(keeper ? (team.id === "home" ? 0xf0a537 : 0xcb668b) : team.primary);
  const shorts = mat(keeper ? 0x202a34 : team.secondary);
  const trim = mat(keeper ? 0x172932 : team.accent);
  const skinTones = [0xc78d63, 0x8e563d, 0xe6b58b, 0x653e2e, 0xb7774c];
  const skin = mat(skinTones[Math.abs(spec.number) % skinTones.length]);
  const hair = mat(spec.number % 3 === 0 ? 0x503524 : 0x201d1b);
  const boots = mat(spec.number % 2 === 0 ? 0xe1f0c1 : 0x171e27);
  const gloves = keeper ? mat(0xedf6ef) : skin;
  const group = new THREE.Group();
  group.name = `player-${team.id}-${spec.number}`;
  const pose = new THREE.Group();
  pose.name = "presentation-pose";
  group.add(pose);

  // A small original biped skeleton is intentionally kept procedural: it is
  // deterministic, has no external asset dependency, and gives the visible
  // mesh a proper bone hierarchy for future clips and contact events.
  const skeletonRoot = new THREE.Bone();
  skeletonRoot.name = "skeleton-root";
  pose.add(skeletonRoot);
  const hipsBone = new THREE.Bone();
  hipsBone.name = "hips";
  hipsBone.position.set(0, 1.43, 0);
  skeletonRoot.add(hipsBone);
  const spineBone = new THREE.Bone();
  spineBone.name = "spine";
  spineBone.position.set(0, 0.16, 0);
  hipsBone.add(spineBone);
  const chestBone = new THREE.Bone();
  chestBone.name = "chest";
  chestBone.position.set(0, 0.39, 0);
  // Keep the visible torso in the original local space while retaining hips
  // and spine as skinning influences for the shirt shell.
  skeletonRoot.add(chestBone);
  const neckBone = new THREE.Bone();
  neckBone.name = "neck";
  neckBone.position.set(0, 1.16, 0);
  chestBone.add(neckBone);
  const headBone = new THREE.Bone();
  headBone.name = "head";
  headBone.position.set(0, 0.41, 0);
  neckBone.add(headBone);

  // Groups are still exposed through the established PlayerRig contract. Bone
  // is an Object3D, so existing rotation/position consumers remain unchanged.
  const torso = chestBone;
  torso.position.y = 1.54;

  const body = new THREE.SkinnedMesh(bodyGeometry, shirt);
  body.position.set(0, 2.12, 0);
  body.name = "shirt-raycast-target";
  body.castShadow = true;
  pose.updateMatrixWorld(true);
  body.updateMatrixWorld(true);
  const skeletonBones = [skeletonRoot, hipsBone, spineBone, chestBone, neckBone, headBone];
  const skeleton = new THREE.Skeleton(skeletonBones);
  body.bind(skeleton);
  pose.add(body);
  part(unitShorts, shorts, pose, 0, 1.47, 0, 0.84, 0.38, 0.56);
  // Generic piping, collar and skin/head details; deliberately no licensed marks.
  part(unitBox, trim, torso, 0, 0.77, 0.36, 0.73, 0.065, 0.035);
  part(unitLimb, skin, torso, 0, 1.16, 0, 0.17, 0.2, 0.17);
  part(unitSphere, trim, torso, 0, 1.07, 0, 0.27, 0.07, 0.24);
  const head = part(unitSphere, skin, torso, 0, 1.57, 0.01, 0.34, 0.42, 0.33);
  head.castShadow = true;
  part(unitSphere, hair, torso, 0, 1.79, -0.035, 0.35, 0.22, 0.335);
  part(unitSphere, skin, torso, 0, 1.56, 0.32, 0.09, 0.1, 0.08);

  function arm(side: number) {
    const joint = new THREE.Bone();
    joint.position.set(side * 0.59, 0.92, 0);
    torso.add(joint);
    part(unitLimb, shirt, joint, 0, -0.21, 0, 0.19, keeper ? 0.46 : 0.32, 0.19);
    if (!keeper) part(unitLimb, skin, joint, 0, -0.4, 0, 0.145, 0.19, 0.145);
    const elbow = new THREE.Bone();
    elbow.position.y = -0.48;
    joint.add(elbow);
    part(unitLimb, keeper ? shirt : skin, elbow, 0, -0.22, 0, 0.13, 0.43, 0.13);
    part(unitSphere, gloves, elbow, 0, -0.48, 0, keeper ? 0.19 : 0.125, 0.18, 0.12);
    return { joint, elbow };
  }
  function leg(side: number) {
    const joint = new THREE.Bone();
    joint.position.set(side * 0.25, 1.74, 0);
    skeletonRoot.add(joint);
    const thigh = part(unitLimb, shorts, joint, 0, -0.25, 0, 0.245, 0.5, 0.23);
    thigh.castShadow = true;
    part(unitLimb, skin, joint, 0, -0.58, 0, 0.18, 0.2, 0.18);
    const knee = new THREE.Bone();
    knee.position.y = -0.78;
    joint.add(knee);
    part(unitLimb, shirt, knee, 0, -0.42, 0, 0.15, 0.72, 0.15);
    part(unitLimb, trim, knee, 0, -0.095, 0, 0.158, 0.075, 0.158);
    part(unitBox, boots, knee, 0, -0.85, 0.1, 0.33, 0.2, 0.6);
    const foot = new THREE.Object3D();
    foot.name = side < 0 ? "left-foot-contact" : "right-foot-contact";
    foot.position.set(0, -0.98, 0.1);
    knee.add(foot);
    return { joint, knee, foot };
  }
  const leftArm = arm(-1), rightArm = arm(1), leftLeg = leg(-1), rightLeg = leg(1);
  const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color: 0xffe15b, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.045;
  marker.name = "selection-marker";
  group.add(marker);
  const rig: PlayerRig = {
    pose, torso, leftArm: leftArm.joint, rightArm: rightArm.joint,
    leftElbow: leftArm.elbow, rightElbow: rightArm.elbow,
    leftLeg: leftLeg.joint, rightLeg: rightLeg.joint,
    leftKnee: leftLeg.knee, rightKnee: rightLeg.knee,
    leftFoot: leftLeg.foot, rightFoot: rightLeg.foot, skeleton,
  };
  rigs.set(group, rig);
  return { group, body, marker, rig };
}

/** Existing WorldFactory contract, with an optional rig for presentation consumers. */
export function createPlayerVisual(team: TeamData, spec: PlayerData) {
  const visual = createPlayerRig(team, spec);
  const label = document.createElement("div");
  label.className = "name-tag";
  label.textContent = spec.short;
  const canvas = document.createElement("canvas");
  canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    // The number is a small kit patch on the shirt front. It deliberately has
    // no billboard/depth-test bypass, so it scales with the player and cannot
    // become a giant floating plaque in the broadcast camera.
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = "900 82px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.strokeStyle = "rgba(5, 17, 25, .9)";
    context.lineWidth = 10;
    context.strokeText(String(spec.number), 64, 66);
    context.fillStyle = "#f6f8ed";
    context.fillText(String(spec.number), 64, 66);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const numberMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const number = new THREE.Mesh(shirtNumberGeometry, numberMaterial);
    number.name = "shirt-number";
    number.position.set(0, 0.58, 0.405);
    visual.rig.torso.add(number);
    const backNumber = number.clone();
    backNumber.name = "shirt-number-back";
    backNumber.position.z = -0.405;
    backNumber.rotation.y = Math.PI;
    visual.rig.torso.add(backNumber);
  }
  return { ...visual, label };
}

function neutral(rig: PlayerRig) {
  rig.pose.position.set(0, 0, 0);
  rig.pose.rotation.set(0, 0, 0);
  for (const bone of rig.skeleton.bones) bone.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.leftArm.rotation.set(0, 0, 0); rig.rightArm.rotation.set(0, 0, 0);
  rig.leftElbow.rotation.set(0, 0, 0); rig.rightElbow.rotation.set(0, 0, 0);
  rig.leftLeg.rotation.set(0, 0, 0); rig.rightLeg.rotation.set(0, 0, 0);
  rig.leftKnee.rotation.set(0, 0, 0); rig.rightKnee.rotation.set(0, 0, 0);
}

type ActionState = {
  action: PlayerAction;
  elapsed: number;
  direction: number;
  duration: number;
  contactAt: number;
  preferredFoot: PreferredFoot;
  contactTarget: THREE.Vector3 | null;
  clock: ActionClock;
  contactReached: boolean;
};
type AnimationState = { rig: PlayerRig; phase: number; speed: number; previousSpeed: number };

const clamp01 = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? THREE.MathUtils.clamp(value!, 0, 1) : fallback;
const signedAngle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

function resolveFoot(rig: PlayerRig, foot: PreferredFoot) {
  return foot === "left"
    ? { leg: rig.leftLeg, knee: rig.leftKnee, foot: rig.leftFoot }
    : { leg: rig.rightLeg, knee: rig.rightKnee, foot: rig.rightFoot };
}

function solveFootPose(
  leg: THREE.Object3D,
  knee: THREE.Object3D,
  target: THREE.Vector3,
) {
  const l1 = 0.78;
  const l2 = 0.99;
  const dy = target.y - leg.position.y;
  const dx = target.x - leg.position.x;
  const dz = target.z - leg.position.z;
  const lateral = Math.atan2(dx, Math.max(0.05, Math.hypot(-dy, dz)));
  const planar = Math.hypot(dy, Math.hypot(dx, dz));
  const radius = THREE.MathUtils.clamp(planar, 0.58, l1 + l2 - 0.015);
  const targetAngle = Math.atan2(dz, Math.max(0.001, -dy));
  const hipOffset = Math.acos(THREE.MathUtils.clamp((l1 * l1 + radius * radius - l2 * l2) / (2 * l1 * radius), -1, 1));
  const shinOffset = Math.acos(THREE.MathUtils.clamp((l2 * l2 + radius * radius - l1 * l1) / (2 * l2 * radius), -1, 1));
  // Three.js rotation around X sends a downward shin toward +Z at negative
  // angles. Preserve the target's forward/back sign so a retreating touch
  // does not accidentally animate the foot through the ball.
  return { hip: -targetAngle - hipOffset, knee: hipOffset + shinOffset, lateral };
}

function getActionTarget(player: SimPlayer, rig: PlayerRig, action: ActionState) {
  if (action.contactTarget) {
    rig.pose.updateMatrixWorld(true);
    const target = action.contactTarget.clone();
    rig.pose.worldToLocal(target);
    return target;
  }
  const contactFoot = resolveFoot(rig, action.preferredFoot);
  const strength = action.action === "shot" || action.action === "volley" ? 0.98
    : action.action === "pass" ? 0.88 : action.action === "clearance" ? 0.92 : 0.74;
  return new THREE.Vector3(contactFoot.leg.position.x, 0.12, contactFoot.leg.position.z + strength);
}

function applyContactKick(player: SimPlayer, rig: PlayerRig, action: ActionState, progress: number) {
  const active = resolveFoot(rig, action.preferredFoot);
  const support = resolveFoot(rig, action.preferredFoot === "left" ? "right" : "left");
  const target = getActionTarget(player, rig, action);
  const contactPose = solveFootPose(active.leg, active.knee, target);
  const contact = clamp01(action.contactAt, 0.5);
  const strength = action.action === "shot" || action.action === "volley" ? 1.24
    : action.action === "pass" ? 0.92 : action.action === "clearance" ? 1.08 : 0.78;
  const windup = clamp01(progress / Math.max(contact, 0.01));
  const follow = clamp01((progress - contact) / Math.max(1 - contact, 0.01));
  const reach = progress <= contact ? windup : 1 - follow;
  // The active foot retracts, reaches the contact marker at contactAt, then
  // follows through. The support foot remains planted through the marker.
  const backswing = Math.sin(windup * Math.PI * 0.5) * 0.42 * strength;
  const followThrough = -Math.sin(follow * Math.PI * 0.5) * 0.68 * strength;
  const windupBlend = THREE.MathUtils.smoothstep(windup, 0, 1);
  const recovery = THREE.MathUtils.smoothstep(follow, 0.7, 1);
  active.leg.rotation.x = progress < contact
    ? backswing * (1 - windupBlend) + contactPose.hip * windupBlend
    : (contactPose.hip * reach + followThrough) * (1 - recovery);
  active.leg.rotation.z = progress < contact
    ? contactPose.lateral * windupBlend
    : contactPose.lateral * reach * (1 - recovery);
  active.knee.rotation.x = progress < contact
    ? contactPose.knee * windupBlend + Math.sin(windup * Math.PI) * 0.1
    : (contactPose.knee * reach + Math.sin(follow * Math.PI) * 0.18) * (1 - recovery);
  support.leg.rotation.x = -0.045 * Math.sin(windup * Math.PI);
  support.knee.rotation.x = 0.075 * Math.sin(windup * Math.PI);
  rig.torso.rotation.y = Math.sin(progress * Math.PI) * (action.action === "shot" ? 0.24 : 0.16) * (action.preferredFoot === "left" ? -1 : 1);
  rig.leftArm.rotation.z = -Math.sin(progress * Math.PI) * 0.42;
  rig.rightArm.rotation.z = Math.sin(progress * Math.PI) * 0.42;
}

function stabilizeFeet(player: SimPlayer, rig: PlayerRig) {
  player.mesh.updateMatrixWorld(true);
  rig.pose.updateMatrixWorld(true);
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  rig.leftFoot.getWorldPosition(left);
  rig.rightFoot.getWorldPosition(right);
  const lowest = Math.min(left.y, right.y);
  if (!Number.isFinite(lowest)) return;
  // The mesh root can carry a small simulation bob. Offset only the visual pose
  // so the lowest foot stays within a few centimetres of the pitch plane.
  rig.pose.position.y = THREE.MathUtils.clamp(rig.pose.position.y + THREE.MathUtils.clamp(0.055 - lowest, -0.24, 0.24), -0.3, 0.3);
}

/** Procedural poses are visual only; no position, velocity, stamina or root edits. */
export class PlayerAnimationSystem {
  private readonly states = new Map<string, AnimationState>();
  private readonly actions = new Map<string, ActionState>();

  trigger(playerId: string, action: PlayerAction, direction = 1) {
    return this.startAction(playerId, action, { direction });
  }

  /** Start an action with an explicit simulation contact marker and foot. */
  startAction(playerId: string, action: PlayerAction, options: ActionTimingOptions = {}) {
    const duration = Number.isFinite(options.duration) && (options.duration ?? 0) > 0.05
      ? Math.min(options.duration!, 4)
      : durations[action];
    const state: ActionState = {
      action,
      elapsed: 0,
      direction: Number.isFinite(options.direction) && (options.direction ?? 1) < 0 ? -1 : 1,
      duration,
      contactAt: clamp01(options.contactAt, contactMarkers[action]),
      preferredFoot: options.preferredFoot === "left" ? "left" : "right",
      contactTarget: options.contactTarget?.clone() ?? null,
      clock: options.clock === "simulation" ? "simulation" : "renderer",
      contactReached: false,
    };
    this.actions.set(playerId, state);
    return { ...state, contactTarget: state.contactTarget?.clone() ?? null };
  }

  /** Explicit alias for integrations that describe actions as timed events. */
  triggerTimed(playerId: string, action: PlayerAction, options: ActionTimingOptions = {}) {
    return this.startAction(playerId, action, options);
  }

  /**
   * Sync a simulation-owned action. Returns true once, on the frame the
   * normalized contact marker is crossed. Presentation never mutates the
   * simulation clock or ball state.
   */
  syncActionContact(playerId: string, sync: ActionContactSync = {}) {
    const action = this.actions.get(playerId);
    if (!action) return false;
    if (Number.isFinite(sync.elapsed)) action.elapsed = THREE.MathUtils.clamp(sync.elapsed!, 0, action.duration);
    else if (Number.isFinite(sync.progress)) action.elapsed = clamp01(sync.progress) * action.duration;
    if (sync.contactAt !== undefined) action.contactAt = clamp01(sync.contactAt, action.contactAt);
    if (sync.preferredFoot) action.preferredFoot = sync.preferredFoot;
    if (sync.contactTarget) action.contactTarget = sync.contactTarget.clone();
    const crossed = !action.contactReached && action.elapsed / action.duration >= action.contactAt;
    action.contactReached = action.contactReached || action.elapsed / action.duration >= action.contactAt;
    // Simulation-owned actions can finish while reduced-motion rendering is
    // disabled; clear them here so presentation state cannot accumulate.
    if (action.elapsed >= action.duration) this.actions.delete(playerId);
    return crossed;
  }

  isActionContactReached(playerId: string) {
    return this.actions.get(playerId)?.contactReached ?? false;
  }

  /** Cancel a pending renderer or simulation-clock action without touching the root. */
  cancelAction(playerId: string) {
    return this.actions.delete(playerId);
  }

  /** Read the current marker configuration for diagnostics/integration tests. */
  getActionTiming(playerId: string) {
    const action = this.actions.get(playerId);
    if (!action) return null;
    return {
      action: action.action,
      elapsed: action.elapsed,
      duration: action.duration,
      contactAt: action.contactAt,
      preferredFoot: action.preferredFoot,
      clock: action.clock,
      contactReached: action.contactReached,
      target: action.contactTarget?.clone() ?? null,
    };
  }

  /** World-space foot marker for the chosen contact foot, after the current pose. */
  getFootWorldPosition(player: SimPlayer, foot: PreferredFoot = "right") {
    const rig = rigs.get(player.mesh);
    if (!rig) return null;
    player.mesh.updateMatrixWorld(true);
    const result = new THREE.Vector3();
    resolveFoot(rig, foot).foot.getWorldPosition(result);
    return result;
  }

  update(players: SimPlayer[], dt: number, locomotionEnabled = true) {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    for (const player of players) {
      const rig = rigs.get(player.mesh);
      if (!rig) continue;
      let state = this.states.get(player.id);
      if (!state || state.rig !== rig) {
        if (state) neutral(state.rig);
        state = { rig, phase: 0, speed: 0, previousSpeed: 0 };
        this.states.set(player.id, state);
      }
      neutral(rig);
      if (!player.mesh.visible) {
        this.actions.delete(player.id);
        state.speed = 0;
        continue;
      }
      const rawSpeed = Math.hypot(player.velocity.x, player.velocity.z);
      const speed = locomotionEnabled && Number.isFinite(rawSpeed) ? Math.min(rawSpeed, 18) : 0;
      // Dead balls must not inherit held simulation velocities or ease out a run.
      state.previousSpeed = state.speed;
      state.speed = locomotionEnabled ? state.speed + (speed - state.speed) * (1 - Math.exp(-12 * step)) : 0;
      const strideLength = 1.22 + Math.min(1, state.speed / 9) * 0.34;
      if (state.speed > 0.12) state.phase = (state.phase + step * state.speed / strideLength * Math.PI) % (Math.PI * 2);
      else state.phase *= Math.exp(-8 * step);
      const run = THREE.MathUtils.smoothstep(state.speed, 2.1, 9.5);
      const walk = 1 - run;
      const wave = Math.sin(state.phase);
      const gait = (0.28 + run * 0.44 + walk * 0.12) * clamp01(state.speed / 0.8);
      const braking = step > 0 ? THREE.MathUtils.clamp((state.previousSpeed - state.speed) / (step * 16), 0, 1) : 0;
      const travelAngle = state.speed > 0.15 ? Math.atan2(player.velocity.x, player.velocity.z) : player.mesh.rotation.y;
      const turn = THREE.MathUtils.clamp(signedAngle(travelAngle - player.mesh.rotation.y) / 0.85, -1, 1);
      rig.pose.position.y = 0;
      rig.torso.rotation.x = run * 0.075 + braking * 0.09;
      rig.torso.rotation.y = turn * 0.08;
      rig.torso.rotation.z = -turn * 0.11 + Math.sin(state.phase * 0.5) * 0.018 * walk;
      rig.leftLeg.rotation.x = gait > 0.000001 ? wave * gait : 0;
      rig.rightLeg.rotation.x = gait > 0.000001 ? -wave * gait : 0;
      rig.leftKnee.rotation.x = Math.max(0, -wave) * (0.18 + run * 0.64);
      rig.rightKnee.rotation.x = Math.max(0, wave) * (0.18 + run * 0.64);
      rig.leftArm.rotation.x = -wave * (0.16 + run * 0.42);
      rig.rightArm.rotation.x = wave * (0.16 + run * 0.42);
      rig.leftArm.rotation.z = -0.075; rig.rightArm.rotation.z = 0.075;
      rig.leftElbow.rotation.x = -0.12 - run * 0.58;
      rig.rightElbow.rotation.x = -0.12 - run * 0.58;

      const action = this.actions.get(player.id);
      if (action && action.clock === "renderer") action.elapsed = Math.min(action.duration, action.elapsed + step);
      if (!action) {
        stabilizeFeet(player, rig);
        continue;
      }
      const progress = clamp01(action.elapsed / action.duration);
      const pulse = Math.sin(progress * Math.PI);
      const side = action.direction;
      switch (action.action) {
        case "kick": case "pass": case "shot": case "volley": case "clearance": {
          applyContactKick(player, rig, action, progress);
          break;
        }
        case "header":
          // Header contact is above the feet, so keep the root untouched and
          // use only the presentation pose to show the jump/neck snap. The
          // simulation owns the actual ball contact and impulse.
          rig.pose.position.y = pulse * 0.28;
          rig.pose.rotation.x = -pulse * 0.18;
          rig.torso.rotation.x += pulse * 0.18;
          rig.leftArm.rotation.z = -pulse * 0.32;
          rig.rightArm.rotation.z = pulse * 0.32;
          break;
        case "tackle":
          rig.pose.position.y = -0.68 * pulse;
          rig.pose.rotation.x = -0.42 * pulse;
          rig.rightLeg.rotation.x = -1.18 * pulse;
          rig.leftKnee.rotation.x = 1.35 * pulse;
          rig.leftArm.rotation.z = -0.6 * pulse;
          break;
        case "dive":
          // Visual lean only; the collision/root transform stays in place.
          rig.pose.position.y = pulse * 0.7;
          rig.pose.rotation.z = side * pulse * 1.18;
          rig.leftArm.rotation.z = -pulse * 2.3;
          rig.rightArm.rotation.z = pulse * 2.3;
          rig.leftKnee.rotation.x = pulse * 0.4;
          break;
        case "celebrate":
          rig.pose.position.y = pulse * Math.abs(Math.sin(progress * Math.PI * 4)) * 0.36;
          rig.leftArm.rotation.z = -pulse * 2.75;
          rig.rightArm.rotation.z = pulse * 2.75;
          rig.leftElbow.rotation.x = -pulse * 0.2;
          rig.rightElbow.rotation.x = -pulse * 0.2;
          break;
      }
      // Kick contact is solved against the simulation marker and the support
      // foot remains at the authored ground height. Do not offset the whole
      // pose here: doing so would move the contact foot away from the marker.
      if (progress >= 1) this.actions.delete(player.id);
    }
  }

  reset() {
    for (const state of this.states.values()) neutral(state.rig);
    this.states.clear();
    this.actions.clear();
  }

  debugSnapshot() {
    return {
      animatedPlayers: this.states.size,
      actions: Array.from(this.actions, ([playerId, value]) => ({
        playerId,
        action: value.action,
        elapsed: value.elapsed,
        duration: value.duration,
        contactAt: value.contactAt,
        preferredFoot: value.preferredFoot,
        clock: value.clock,
        contactReached: value.contactReached,
        contactTarget: value.contactTarget?.toArray() ?? null,
      })),
      movingPlayers: Array.from(this.states.values()).filter((state) => state.speed > 0.2).length,
    };
  }
}
