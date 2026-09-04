import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MatchAudio } from "../audio/MatchAudio";
import { SeededRandom } from "../core/random";
import { kickBall, updateBallPhysics } from "../core/systems/BallSystem";
import type { SimBall, SimPlayer } from "../core/systems/types";
import { manCity, realMadrid } from "../data/teams";
import { createPlayerRig, PlayerAnimationSystem, type PlayerAction } from "./PlayerPresentation";
import { addPitch, createBallVisual, GOAL_WIDTH, HALF_L, HALF_W } from "./WorldFactory";

function presentationFixture() {
  const scene = new THREE.Scene();
  const stadium = addPitch(scene);
  const animations = new PlayerAnimationSystem();
  const players = [realMadrid, manCity].flatMap((team) => team.players.map((spec): SimPlayer => {
    const visual = createPlayerRig(team, spec);
    const position = new THREE.Vector3(spec.formation.x, 0, spec.formation.z);
    visual.group.position.copy(position); visual.group.rotation.y = team.id === "home" ? 0 : Math.PI;
    scene.add(visual.group);
    return { id: `${team.id}-${spec.number}`, team: team.id, role: spec.role, short: spec.short, number: spec.number,
      position, home: position.clone(), velocity: new THREE.Vector3(2, 0, team.attackingDirection * 6),
      stats: { ...spec.stats }, hasBall: false, stamina: 0.75, cooldown: 0.3, intent: "hold", mesh: visual.group, body: visual.body };
  }));
  const ball: SimBall = { position: new THREE.Vector3(0, 0.42, 0), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), mesh: createBallVisual(0.42) };
  scene.add(ball.mesh);
  return { scene, stadium, animations, players, ball };
}

function playerGameplaySnapshot(players: SimPlayer[]) {
  return players.map((p) => ({ id: p.id, position: p.position.toArray(), root: p.mesh.position.toArray(), quaternion: p.mesh.quaternion.toArray(),
    scale: p.mesh.scale.toArray(), velocity: p.velocity.toArray(), home: p.home.toArray(), stamina: p.stamina, cooldown: p.cooldown,
    hasBall: p.hasBall, intent: p.intent, visible: p.mesh.visible, stats: { ...p.stats } }));
}

describe("Phase 5 integrated presentation acceptance", () => {
  it("animates the actual 22-player roster and arena without mutating gameplay or consuming its RNG", () => {
    const { players, stadium, animations, ball } = presentationFixture();
    const audioFactory = vi.fn(() => { throw new Error("Audio must require explicit enable."); });
    const audio = new MatchAudio({ contextFactory: audioFactory });
    const random = new SeededRandom(505);
    const rngState = random.snapshot(); const baseline = playerGameplaySnapshot(players);
    const ballBaseline = { position: ball.position.toArray(), velocity: ball.velocity.toArray(), spin: ball.spin!.toArray(), root: ball.mesh.position.toArray() };
    const actions: PlayerAction[] = ["pass", "shot", "tackle", "dive", "celebrate", "kick"];
    const globalRandom = vi.spyOn(Math, "random");
    try {
      stadium.setWeather("rain");
      for (let frame = 0; frame < 240; frame += 1) {
        if (frame % 30 === 0) {
          players.forEach((player, index) => animations.trigger(player.id, actions[(index + frame / 30) % actions.length]));
          stadium.shot(ball.position); audio.play("shot");
        }
        if (frame === 90) { stadium.goal("home", new THREE.Vector3(1, 2, 57)); audio.play("goal"); }
        animations.update(players, 1 / 60); stadium.update(1 / 60, ball.position, 32);
      }
      // Stop retriggering shots long enough to genuinely fill the capped trail.
      for (let frame = 0; frame < 48; frame += 1) {
        animations.update(players, 1 / 60); stadium.update(1 / 60, ball.position, 32);
      }
      expect(globalRandom).not.toHaveBeenCalled();
    } finally { globalRandom.mockRestore(); }
    expect(audioFactory).not.toHaveBeenCalled();
    expect(random.snapshot()).toBe(rngState);
    expect(playerGameplaySnapshot(players)).toEqual(baseline);
    expect({ position: ball.position.toArray(), velocity: ball.velocity.toArray(), spin: ball.spin!.toArray(), root: ball.mesh.position.toArray() }).toEqual(ballBaseline);
    expect(animations.debugSnapshot().animatedPlayers).toBe(22);
    expect(animations.debugSnapshot().movingPlayers).toBe(22);
    expect(stadium.debugSnapshot()).toMatchObject({ rainParticles: 220, trailPoints: 24 });
  });

  it("produces identical seeded ball trajectories with presentation enabled or absent", () => {
    function run(withPresentation: boolean) {
      const random = new SeededRandom(0x505);
      const rig = withPresentation ? presentationFixture() : null;
      const ball: SimBall = rig?.ball ?? { position: new THREE.Vector3(0, 0.42, 0), velocity: new THREE.Vector3(), spin: new THREE.Vector3(), mesh: new THREE.Mesh() };
      const events: string[] = [];
      rig?.stadium.setWeather("rain");
      for (let frame = 0; frame < 1800; frame += 1) {
        if (frame % 150 === 0) {
          kickBall(ball, new THREE.Vector3(random.range(-25, 25), random.range(0.42, 3), random.range(-48, 48)), random.range(25, 42), 3, { curve: random.range(-2, 2) });
          rig?.stadium.shot(ball.position);
          if (rig) rig.animations.trigger(rig.players[frame / 150 % 22].id, "shot");
        }
        updateBallPhysics({ ball, ballOwner: null, dt: 1 / 60, bounds: { halfWidth: HALF_W, halfLength: HALF_L }, ballRadius: 0.42, goalWidth: GOAL_WIDTH,
          playerForward: () => new THREE.Vector3(0, 0, 1), onGoal: (team) => { events.push(team); rig?.stadium.goal(team, ball.position); } });
        rig?.animations.update(rig.players, 1 / 60); rig?.stadium.update(1 / 60, ball.position, ball.velocity.length());
      }
      return { position: ball.position.toArray(), velocity: ball.velocity.toArray(), spin: ball.spin?.toArray(), events, random: random.snapshot() };
    }
    expect(run(true)).toEqual(run(false));
  });

  it("keeps resource and particle buffers fixed during repeated weather and action changes", () => {
    const { scene, stadium, animations, players, ball } = presentationFixture();
    const resources = () => {
      const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); let meshes = 0;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          geometries.add(object.geometry); meshes += object instanceof THREE.Mesh ? 1 : 0;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
        }
      });
      return { geometries, materials, meshes };
    };
    const before = resources();
    expect(before.geometries.size).toBeLessThan(80); expect(before.meshes).toBeLessThan(1000);
    const rain = scene.getObjectByName("cosmetic-rain") as THREE.LineSegments;
    const trail = scene.getObjectByName("ball-trail") as THREE.Line;
    const rainArray = rain.geometry.getAttribute("position").array; const trailArray = trail.geometry.getAttribute("position").array;
    for (let frame = 0; frame < 480; frame += 1) {
      stadium.setWeather(frame % 60 < 30 ? "rain" : "clear");
      if (frame % 20 === 0) { stadium.shot(ball.position); stadium.goal(frame % 40 === 0 ? "home" : "away", new THREE.Vector3(0, 2, frame % 40 === 0 ? 57 : -57)); }
      animations.update(players, 1 / 60); stadium.update(1 / 60, ball.position, 40);
    }
    const after = resources();
    expect(after.geometries).toEqual(before.geometries); expect(after.materials).toEqual(before.materials); expect(after.meshes).toBe(before.meshes);
    expect(rain.geometry.getAttribute("position").array).toBe(rainArray); expect(rainArray.length).toBe(220 * 6);
    expect(trail.geometry.getAttribute("position").array).toBe(trailArray); expect(trailArray.length).toBe(24 * 3);
    for (const geometry of after.geometries) {
      const positions = geometry.getAttribute("position");
      if (positions) expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
    }
    // A recognizable ball uses 12 shared pentagon patches, not extra gameplay bodies.
    expect(ball.mesh.children).toHaveLength(12);
    expect(new Set(ball.mesh.children.map((object) => (object as THREE.Mesh).geometry)).size).toBe(1);
  });

  it("clears a goal/action sequence for reduced motion and match reset while retaining weather", () => {
    const { stadium, animations, players, ball } = presentationFixture();
    stadium.setWeather("rain"); stadium.goal("away", new THREE.Vector3(2, 2, -57)); stadium.shot(ball.position);
    animations.trigger(players[0].id, "dive", -1); animations.trigger(players[10].id, "celebrate");
    animations.update(players, 0.1); stadium.update(0.1, ball.position, 38);
    stadium.setReducedMotion(true); animations.reset();
    expect(stadium.debugSnapshot()).toMatchObject({ weather: "rain", reducedMotion: true, rainParticles: 0, trailPoints: 0, activeNetRipples: 0 });
    expect(animations.debugSnapshot()).toMatchObject({ animatedPlayers: 0, actions: [] });
    for (const player of players) {
      const pose = player.mesh.getObjectByName("presentation-pose")!;
      expect(pose.position.lengthSq()).toBe(0); expect(pose.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    }
    stadium.setReducedMotion(false); stadium.reset(); animations.reset();
    expect(stadium.debugSnapshot()).toMatchObject({ weather: "rain", rainParticles: 220, trailPoints: 0, activeNetRipples: 0 });
    expect(JSON.parse(JSON.stringify({ arena: stadium.debugSnapshot(), animation: animations.debugSnapshot() }))).toBeTruthy();
  });
});
