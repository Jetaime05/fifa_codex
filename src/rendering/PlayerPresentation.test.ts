import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { PlayerData, TeamData } from "../data/types";
import type { SimPlayer } from "../core/systems/types";
import { createPlayerRig, PlayerAnimationSystem, type PlayerAction, type PreferredFoot } from "./PlayerPresentation";

const spec: PlayerData = {
  name: "Prototype Player", short: "PLAYER", role: "FWD", number: 9,
  formation: { x: 0, z: 0 },
  stats: { pace: 80, shooting: 80, passing: 80, dribbling: 80, defending: 50, physical: 70 },
};
const team: TeamData = { id: "home", name: "Home", short: "HOM", attackingDirection: 1,
  primary: 0xffffff, secondary: 0x20232a, accent: 0xddbb55, players: [spec] };

function fixture() {
  const visual = createPlayerRig(team, spec);
  const player: SimPlayer = {
    id: "home-9", team: "home", role: "FWD", number: 9, short: "PLAYER",
    position: new THREE.Vector3(7, 0, -4), velocity: new THREE.Vector3(), home: new THREE.Vector3(0, 0, 20),
    hasBall: false, stamina: 0.8, cooldown: 0.5, intent: "hold", stats: { ...spec.stats },
    mesh: visual.group, body: visual.body,
  };
  player.mesh.position.copy(player.position);
  player.mesh.rotation.y = 1.3;
  return { ...visual, player, system: new PlayerAnimationSystem() };
}

describe("PlayerPresentation", () => {
  it("creates an articulated DOM-free rig with the original raycast and marker contract", () => {
    const { group, body, marker, rig } = fixture();
    expect(body.isMesh).toBe(true);
    expect(body).toBeInstanceOf(THREE.SkinnedMesh);
    expect(rig.skeleton.bones.map((bone) => bone.name)).toEqual(expect.arrayContaining(["hips", "spine", "chest"]));
    expect(group.getObjectByName("shirt-raycast-target")).toBe(body);
    expect(marker.parent).toBe(group);
    expect(marker.material.opacity).toBe(0);
    expect(rig.leftElbow.parent).toBe(rig.leftArm);
    expect(rig.rightKnee.parent).toBe(rig.rightLeg);
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(7, 2.1, 10), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(body).length).toBeGreaterThan(0);
  });

  it("keeps simulation-clock actions frozen until sync and reaches a finite foot contact marker", () => {
    const { player, system, rig } = fixture();
    const forward = new THREE.Vector3(Math.sin(player.mesh.rotation.y), 0, Math.cos(player.mesh.rotation.y));
    const target = player.position.clone().addScaledVector(forward, 1.02).add(new THREE.Vector3(0, 0.22, 0));
    system.startAction(player.id, "pass", { clock: "simulation", preferredFoot: "left", contactAt: 0.5, contactTarget: target });
    system.update([player], 0.2);
    expect(system.getActionTiming(player.id)?.elapsed).toBe(0);
    expect(system.isActionContactReached(player.id)).toBe(false);
    system.syncActionContact(player.id, { progress: 0.35 });
    system.update([player], 0);
    const windupRotation = rig.leftLeg.rotation.x;
    expect(system.syncActionContact(player.id, { progress: 0.5 })).toBe(true);
    system.update([player], 0);
    const foot = system.getFootWorldPosition(player, "left");
    expect(foot).not.toBeNull();
    expect(Math.abs(rig.leftLeg.rotation.x - windupRotation)).toBeLessThan(1.1);
    expect(foot!.distanceTo(target)).toBeLessThan(0.25);
    expect(foot!.y).toBeGreaterThan(0.02);
    expect(foot!.y).toBeLessThan(0.5);
    expect(system.cancelAction(player.id)).toBe(true);
    expect(system.getActionTiming(player.id)).toBeNull();
    system.startAction(player.id, "shot", { clock: "simulation" });
    system.syncActionContact(player.id, { elapsed: 0.62 });
    expect(system.getActionTiming(player.id)).toBeNull();
  });

  it.each<[PreferredFoot, number]>([["left", 0], ["right", 1.3]])("reaches a live-height contact marker with the %s foot at yaw %s", (preferredFoot, yaw) => {
    const { player, system } = fixture();
    player.mesh.rotation.y = yaw;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const target = player.position.clone().addScaledVector(forward, 1.08).add(new THREE.Vector3(0, 0.22, 0));
    system.startAction(player.id, "shot", { clock: "simulation", contactAt: 0.48, preferredFoot, contactTarget: target });
    system.syncActionContact(player.id, { progress: 0.48 });
    system.update([player], 0);
    const foot = system.getFootWorldPosition(player, preferredFoot)!;
    const support = system.getFootWorldPosition(player, preferredFoot === "left" ? "right" : "left")!;
    expect(foot.distanceTo(target)).toBeLessThan(0.25);
    expect(foot.y).toBeGreaterThan(0.02);
    expect(foot.y).toBeLessThan(0.48);
    expect(support.y).toBeGreaterThan(-0.08);
    expect(support.y).toBeLessThan(0.3);
  });

  it.each([0.8, 4, 10])("keeps both feet grounded while locomotion is blended at %s speed", (speed) => {
    const { player, system } = fixture();
    player.velocity.set(0, 0, speed);
    for (let i = 0; i < 24; i += 1) system.update([player], 1 / 60);
    const left = system.getFootWorldPosition(player, "left")!;
    const right = system.getFootWorldPosition(player, "right")!;
    expect(left.y).toBeGreaterThan(-0.08);
    expect(left.y).toBeLessThan(0.3);
    expect(right.y).toBeGreaterThan(-0.08);
    expect(right.y).toBeLessThan(0.3);
    expect(Number.isFinite(left.y) && Number.isFinite(right.y)).toBe(true);
  });

  it("gives goalkeepers a contrasting generic kit", () => {
    const normal = createPlayerRig(team, spec);
    const keeper = createPlayerRig(team, { ...spec, role: "GK" });
    expect((keeper.body.material as THREE.MeshStandardMaterial).color.getHex())
      .not.toBe((normal.body.material as THREE.MeshStandardMaterial).color.getHex());
  });

  it("limits each rig to four dynamic silhouette shadow casters", () => {
    for (const role of ["FWD", "GK"] as const) {
      const visual = createPlayerRig(team, { ...spec, role });
      let casters = 0, meshes = 0;
      visual.group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          meshes++;
          if (object.castShadow) casters++;
        }
      });
      expect(casters).toBe(4);
      expect(meshes).toBe(role === "GK" ? 25 : 27);
    }
  });

  it("runs independent arms and legs from velocity without moving gameplay roots or state", () => {
    const { player, system, rig } = fixture();
    player.velocity.set(0, 0, 10);
    const position = player.position.clone(), rootPosition = player.mesh.position.clone();
    const rootRotation = player.mesh.rotation.clone(), velocity = player.velocity.clone();
    for (let i = 0; i < 8; i++) system.update([player], 1 / 60);
    expect(Math.abs(rig.leftLeg.rotation.x)).toBeGreaterThan(0.1);
    expect(rig.leftLeg.rotation.x).toBeCloseTo(-rig.rightLeg.rotation.x);
    expect(rig.leftArm.rotation.x).toBeCloseTo(-rig.rightArm.rotation.x);
    expect(player.position.equals(position)).toBe(true);
    expect(player.mesh.position.equals(rootPosition)).toBe(true);
    expect(player.mesh.rotation.equals(rootRotation)).toBe(true);
    expect(player.velocity.equals(velocity)).toBe(true);
    expect(player.stamina).toBe(0.8);
  });

  it.each<PlayerAction>(["kick", "pass", "shot", "tackle", "dive", "celebrate"])(
    "plays and completes the %s one-shot pose", (action) => {
      const { player, system, rig } = fixture();
      system.trigger(player.id, action, -1);
      system.update([player], 0.1);
      expect(system.debugSnapshot().actions[0].action).toBe(action);
      const activeRotation = Math.abs(rig.rightLeg.rotation.x) + Math.abs(rig.pose.rotation.z) + Math.abs(rig.rightArm.rotation.z);
      expect(activeRotation).toBeGreaterThan(0.1);
      for (let i = 0; i < 40; i++) system.update([player], 0.1);
      expect(system.debugSnapshot().actions).toHaveLength(0);
      expect(rig.pose.rotation.x).toBe(0);
      expect(rig.pose.rotation.z).toBe(0);
      expect(rig.rightLeg.rotation.x).toBe(0);
      expect(player.mesh.position.toArray()).toEqual([7, 0, -4]);
      expect(player.mesh.rotation.y).toBe(1.3);
    },
  );

  it("reset clears poses and pending actions including invisible or no-longer-listed players", () => {
    const { player, system, rig } = fixture();
    system.trigger(player.id, "dive");
    system.update([player], 0.1);
    player.mesh.visible = false;
    system.update([], 0.1);
    system.trigger("not-loaded-yet", "shot");
    system.reset();
    expect(rig.pose.position.length()).toBe(0);
    expect(rig.pose.rotation.z).toBe(0);
    expect(rig.leftArm.rotation.z).toBe(0);
    expect(system.debugSnapshot()).toEqual({ animatedPlayers: 0, actions: [], movingPlayers: 0 });
    expect(player.mesh.visible).toBe(false);
    expect(player.mesh.rotation.y).toBe(1.3);
  });

  it("uses idle during dead balls despite stale velocity while allowing celebration to finish", () => {
    const { player, system, rig } = fixture();
    player.velocity.set(0, 0, 12);
    for (let i = 0; i < 10; i++) system.update([player], 0.1);
    expect(system.debugSnapshot().movingPlayers).toBe(1);
    system.trigger(player.id, "celebrate");
    system.update([player], 0.1, false);
    expect(system.debugSnapshot().movingPlayers).toBe(0);
    expect(rig.leftLeg.rotation.x).toBeCloseTo(0);
    expect(rig.rightLeg.rotation.x).toBeCloseTo(0);
    expect(Math.abs(rig.rightArm.rotation.z)).toBeGreaterThan(0.1);
    for (let i = 0; i < 30; i++) system.update([player], 0.1, false);
    expect(system.debugSnapshot().actions).toHaveLength(0);
    expect(player.velocity.z).toBe(12);
    system.update([player], 0.1, true);
    expect(system.debugSnapshot().movingPlayers).toBe(1);
  });

  it("neutralizes hidden/dismissed players without changing visibility", () => {
    const { player, system, rig } = fixture();
    system.trigger(player.id, "tackle");
    system.update([player], 0.1);
    player.mesh.visible = false;
    system.update([player], 0.1);
    expect(rig.pose.position.length()).toBe(0);
    expect(system.debugSnapshot().actions).toHaveLength(0);
    expect(player.mesh.visible).toBe(false);
  });

  it("ignores invalid time and velocity, clamps large deltas and keeps snapshots JSON-safe", () => {
    const { player, system, rig } = fixture();
    player.velocity.set(Infinity, NaN, Infinity);
    system.trigger(player.id, "dive", NaN);
    for (const dt of [NaN, Infinity, -1]) system.update([player], dt);
    expect(system.debugSnapshot().actions[0].elapsed).toBe(0);
    system.update([player], 1000);
    expect(system.debugSnapshot().actions[0].elapsed).toBe(0.1);
    expect(Number.isFinite(rig.pose.position.y)).toBe(true);
    expect(Number.isFinite(rig.leftLeg.rotation.x)).toBe(true);
    expect(JSON.parse(JSON.stringify(system.debugSnapshot()))).toEqual(system.debugSnapshot());
  });

  it("works safely with legacy unrigged players", () => {
    const { player, system } = fixture();
    player.mesh = new THREE.Group();
    system.update([player], 0.1);
    expect(system.debugSnapshot().animatedPlayers).toBe(0);
  });
});
