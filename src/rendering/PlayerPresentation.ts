import * as THREE from "three";
import type { PlayerData, TeamData } from "../data/types";
import type { SimPlayer } from "../core/systems/types";

export type PlayerAction = "kick" | "pass" | "shot" | "tackle" | "dive" | "celebrate";

export type PlayerRig = {
  pose: THREE.Group;
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
};

// Shared low-poly geometry keeps the 22-player procedural roster inexpensive.
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitSphere = new THREE.SphereGeometry(1, 10, 8);
const unitLimb = new THREE.CylinderGeometry(1, 0.86, 1, 8);
const markerGeometry = new THREE.RingGeometry(0.96, 1.15, 32);
const rigs = new WeakMap<THREE.Group, PlayerRig>();
const durations: Record<PlayerAction, number> = { kick: 0.48, pass: 0.42, shot: 0.62, tackle: 0.7, dive: 0.9, celebrate: 2.4 };

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
  const torso = new THREE.Group();
  torso.position.y = 1.54;
  pose.add(torso);
  const body = part(unitLimb, shirt, torso, 0, 0.58, 0, 0.55, 1.05, 0.38);
  body.name = "shirt-raycast-target";
  body.castShadow = true;
  part(unitBox, shorts, pose, 0, 1.47, 0, 0.84, 0.38, 0.56);
  // Generic piping, collar and skin/head details; deliberately no licensed marks.
  part(unitBox, trim, torso, 0, 0.77, 0.36, 0.73, 0.065, 0.035);
  part(unitLimb, skin, torso, 0, 1.16, 0, 0.17, 0.2, 0.17);
  part(unitSphere, trim, torso, 0, 1.07, 0, 0.27, 0.07, 0.24);
  const head = part(unitSphere, skin, torso, 0, 1.57, 0.01, 0.34, 0.42, 0.33);
  head.castShadow = true;
  part(unitSphere, hair, torso, 0, 1.79, -0.035, 0.35, 0.22, 0.335);
  part(unitSphere, skin, torso, 0, 1.56, 0.32, 0.09, 0.1, 0.08);

  function arm(side: number) {
    const joint = new THREE.Group();
    joint.position.set(side * 0.59, 0.92, 0);
    torso.add(joint);
    part(unitLimb, shirt, joint, 0, -0.21, 0, 0.19, keeper ? 0.46 : 0.32, 0.19);
    if (!keeper) part(unitLimb, skin, joint, 0, -0.4, 0, 0.145, 0.19, 0.145);
    const elbow = new THREE.Group();
    elbow.position.y = -0.48;
    joint.add(elbow);
    part(unitLimb, keeper ? shirt : skin, elbow, 0, -0.22, 0, 0.13, 0.43, 0.13);
    part(unitSphere, gloves, elbow, 0, -0.48, 0, keeper ? 0.19 : 0.125, 0.18, 0.12);
    return { joint, elbow };
  }
  function leg(side: number) {
    const joint = new THREE.Group();
    joint.position.set(side * 0.25, 1.43, 0);
    pose.add(joint);
    const thigh = part(unitLimb, shorts, joint, 0, -0.19, 0, 0.245, 0.39, 0.23);
    thigh.castShadow = true;
    part(unitLimb, skin, joint, 0, -0.44, 0, 0.18, 0.2, 0.18);
    const knee = new THREE.Group();
    knee.position.y = -0.55;
    joint.add(knee);
    part(unitLimb, shirt, knee, 0, -0.29, 0, 0.15, 0.52, 0.15);
    part(unitLimb, trim, knee, 0, -0.095, 0, 0.158, 0.075, 0.158);
    part(unitBox, boots, knee, 0, -0.69, 0.1, 0.33, 0.18, 0.6);
    return { joint, knee };
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
  canvas.width = 96; canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(9,20,24,.72)";
    context.fillRect(18, 4, 60, 52);
    context.font = "bold 34px Arial";
    context.textAlign = "center";
    context.fillStyle = "#ffffff";
    context.fillText(String(spec.number), 48, 42);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const number = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    number.name = "shirt-number";
    number.scale.set(1.65, 1.1, 1);
    number.position.set(0, 4.12, 0);
    visual.group.add(number);
  }
  return { ...visual, label };
}

function neutral(rig: PlayerRig) {
  rig.pose.position.set(0, 0, 0);
  rig.pose.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.leftArm.rotation.set(0, 0, 0); rig.rightArm.rotation.set(0, 0, 0);
  rig.leftElbow.rotation.set(0, 0, 0); rig.rightElbow.rotation.set(0, 0, 0);
  rig.leftLeg.rotation.set(0, 0, 0); rig.rightLeg.rotation.set(0, 0, 0);
  rig.leftKnee.rotation.set(0, 0, 0); rig.rightKnee.rotation.set(0, 0, 0);
}

type ActionState = { action: PlayerAction; elapsed: number; direction: number };
type AnimationState = { rig: PlayerRig; phase: number; speed: number };

/** Procedural poses are visual only; no position, velocity, stamina or root edits. */
export class PlayerAnimationSystem {
  private readonly states = new Map<string, AnimationState>();
  private readonly actions = new Map<string, ActionState>();

  trigger(playerId: string, action: PlayerAction, direction = 1) {
    this.actions.set(playerId, { action, elapsed: 0, direction: Number.isFinite(direction) && direction < 0 ? -1 : 1 });
  }

  update(players: SimPlayer[], dt: number, locomotionEnabled = true) {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    for (const player of players) {
      const rig = rigs.get(player.mesh);
      if (!rig) continue;
      let state = this.states.get(player.id);
      if (!state || state.rig !== rig) {
        if (state) neutral(state.rig);
        state = { rig, phase: 0, speed: 0 };
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
      state.speed = locomotionEnabled ? state.speed + (speed - state.speed) * (1 - Math.exp(-12 * step)) : 0;
      state.phase = (state.phase + step * (2.6 + state.speed * 1.22)) % (Math.PI * 2);
      const run = Math.min(1, state.speed / 9);
      const wave = Math.sin(state.phase);
      rig.pose.position.y = Math.abs(wave) * 0.095 * run;
      rig.torso.rotation.x = run * 0.1;
      rig.torso.rotation.z = Math.sin(state.phase * 0.5) * 0.015 * (1 - run);
      rig.leftLeg.rotation.x = wave * run * 0.67;
      rig.rightLeg.rotation.x = -wave * run * 0.67;
      rig.leftKnee.rotation.x = Math.max(0, -wave) * run * 0.85;
      rig.rightKnee.rotation.x = Math.max(0, wave) * run * 0.85;
      rig.leftArm.rotation.x = -wave * run * 0.57;
      rig.rightArm.rotation.x = wave * run * 0.57;
      rig.leftArm.rotation.z = -0.075; rig.rightArm.rotation.z = 0.075;
      rig.leftElbow.rotation.x = -0.12 - run * 0.65;
      rig.rightElbow.rotation.x = -0.12 - run * 0.65;

      const action = this.actions.get(player.id);
      if (!action) continue;
      action.elapsed += step;
      const progress = Math.min(1, action.elapsed / durations[action.action]);
      const pulse = Math.sin(progress * Math.PI);
      const side = action.direction;
      switch (action.action) {
        case "kick": case "pass": case "shot": {
          const strength = action.action === "shot" ? 1.35 : action.action === "pass" ? 0.8 : 1;
          rig.rightLeg.rotation.x = -pulse * strength;
          rig.rightKnee.rotation.x = Math.sin(Math.min(1, progress * 2) * Math.PI) * 0.5;
          rig.torso.rotation.y = pulse * 0.2;
          rig.leftArm.rotation.z = -pulse * 0.45;
          break;
        }
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
      actions: Array.from(this.actions, ([playerId, value]) => ({ playerId, ...value })),
      movingPlayers: Array.from(this.states.values()).filter((state) => state.speed > 0.2).length,
    };
  }
}
