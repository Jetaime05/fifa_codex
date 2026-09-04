import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { addPitch, createPitchMarkings } from "./StadiumPresentation";
import { createRestartPlan } from "../core/systems/RestartSystem";

describe("stadium presentation", () => {
  it("keeps every painted marking inside the playable pitch and both boxes inward", () => {
    const markings = createPitchMarkings();
    for (const path of markings) for (const point of path) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(36.00001);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(56.00001);
    }
    const boxes = markings.filter((path) => path.length === 4);
    expect(boxes).toHaveLength(4);
    expect(boxes.map((path) => Math.abs(path[1].z))).toEqual([56 - 16.5 * 56 / 52.5, 56 - 5.5 * 56 / 52.5, 56 - 16.5 * 56 / 52.5, 56 - 5.5 * 56 / 52.5]);
    expect(Math.abs(boxes[0][0].x)).toBeCloseTo(36 * 20.16 / 34);
  });

  it("aligns painted penalty spots and goal areas with actual restart placement", () => {
    const scene = new THREE.Scene(); addPitch(scene);
    const spots: THREE.Object3D[] = []; scene.traverse((object) => { if (object.name === "penalty-spot") spots.push(object); });
    const bounds = { halfWidth: 36, halfLength: 56 };
    for (const direction of [-1, 1] as const) {
      const restart = createRestartPlan({ kind: "penalty", team: direction === 1 ? "home" : "away", bounds, attackingDirection: direction });
      const spot = spots.find((candidate) => Math.sign(candidate.position.z) === direction)!;
      expect(spot.position.z).toBeCloseTo(restart.position.z);
      const goalKick = createRestartPlan({ kind: "goalKick", team: direction === 1 ? "home" : "away", bounds, attackingDirection: direction });
      const goalArea = createPitchMarkings().find((path) => path.length === 4 && Math.abs(path[0].x) < 10 && Math.sign(path[0].z) === -direction)!;
      expect(goalArea[1].z).toBeCloseTo(goalKick.position.z);
    }
  });

  it("builds a bounded crowd and one shadow-casting light without WebGL or canvas", () => {
    const scene = new THREE.Scene(); const stadium = addPitch(scene);
    const lights: THREE.Light[] = []; const crossbars: THREE.Object3D[] = [];
    scene.traverse((object) => { if (object instanceof THREE.Light && object.castShadow) lights.push(object); if (object.name === "goal-crossbar") crossbars.push(object); });
    expect(lights).toHaveLength(1);
    expect((lights[0] as THREE.DirectionalLight).shadow.mapSize.x).toBe(1024);
    expect(stadium.debugSnapshot().crowdInstances).toBeGreaterThan(1000);
    expect(stadium.debugSnapshot().crowdInstances).toBeLessThan(1500);
    expect(crossbars.map((bar) => bar.position.y)).toEqual([4.8, 4.8]);
    expect(stadium.debugSnapshot().pitch).toEqual({ width: 72, length: 112 });
    expect(() => JSON.stringify(stadium.debugSnapshot())).not.toThrow();
  });

  it("ripples only the scored net and keeps the boundary threads anchored", () => {
    const scene = new THREE.Scene(); const stadium = addPitch(scene);
    const net = scene.getObjectByName("goal-net-1") as THREE.LineSegments;
    const other = scene.getObjectByName("goal-net--1") as THREE.LineSegments;
    const attribute = net.geometry.getAttribute("position"); const base = attribute.array.slice();
    const otherBase = other.geometry.getAttribute("position").array.slice();
    const impact = new THREE.Vector3(1, 2, 56.8); stadium.goal("home", impact); stadium.update(0.08, impact, 0);
    expect(stadium.debugSnapshot().activeNetRipples).toBe(1);
    let moved = 0;
    for (let i = 0; i < attribute.count; i += 1) {
      const displacement = Math.abs(attribute.getZ(i) - base[i * 3 + 2]);
      if (Math.abs(attribute.getX(i)) > 6.7499 || attribute.getY(i) < 0.001 || attribute.getY(i) > 4.7999) expect(displacement).toBeLessThan(0.0001);
      else if (displacement > 0.001) moved += 1;
      expect(displacement).toBeLessThan(0.85);
    }
    expect(moved).toBeGreaterThan(0);
    expect(Array.from(other.geometry.getAttribute("position").array)).toEqual(Array.from(otherBase));
    for (let i = 0; i < 40; i += 1) stadium.update(0.1, impact, 0);
    expect(stadium.debugSnapshot().activeNetRipples).toBe(0);
    expect(Array.from(attribute.array)).toEqual(Array.from(base));
  });

  it("caps the trail buffer, drops teleports and drains stationary-ball trails", () => {
    const scene = new THREE.Scene(); const stadium = addPitch(scene); const ball = new THREE.Vector3(0, 1, 0);
    stadium.shot(ball);
    for (let i = 0; i < 200; i += 1) { ball.z += 0.3; stadium.update(0.03, ball, 32); }
    expect(stadium.debugSnapshot().trailPoints).toBe(24);
    const trail = scene.getObjectByName("ball-trail") as THREE.Line;
    expect(trail.geometry.getAttribute("position").count).toBe(24);
    ball.set(0, 1, -50); stadium.update(0.03, ball, 32);
    expect(stadium.debugSnapshot().trailPoints).toBe(1);
    for (let i = 0; i < 25; i += 1) stadium.update(0.03, ball, 0);
    expect(stadium.debugSnapshot().trailPoints).toBe(0);
  });

  it("keeps rain cosmetic and bounded and honors reduced motion immediately", () => {
    const scene = new THREE.Scene(); const stadium = addPitch(scene); const ball = new THREE.Vector3(2, 1, 4);
    stadium.setWeather("rain"); stadium.shot(ball); stadium.goal("home", new THREE.Vector3(0, 2, 57)); stadium.update(0.05, ball, 40);
    expect(ball.toArray()).toEqual([2, 1, 4]);
    expect(stadium.debugSnapshot().rainParticles).toBe(220);
    const rain = scene.getObjectByName("cosmetic-rain") as THREE.LineSegments;
    const attribute = rain.geometry.getAttribute("position");
    expect(attribute.count).toBe(440);
    expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    stadium.setReducedMotion(true);
    expect(stadium.debugSnapshot()).toMatchObject({ weather: "rain", rainParticles: 0, trailPoints: 0, activeNetRipples: 0 });
    stadium.shot(ball); stadium.goal("away", new THREE.Vector3(0, 2, -57)); stadium.update(0.1, ball, 40);
    expect(stadium.debugSnapshot()).toMatchObject({ trailPoints: 0, activeNetRipples: 0 });
    stadium.setReducedMotion(false); expect(stadium.debugSnapshot().rainParticles).toBe(220);
    stadium.setWeather("clear"); expect(stadium.debugSnapshot().rainParticles).toBe(0);
  });

  it("resets transient state but preserves weather preferences", () => {
    const stadium = addPitch(new THREE.Scene()); const ball = new THREE.Vector3(0, 2, 58);
    stadium.setWeather("rain"); stadium.goal("home", ball); stadium.shot(ball); stadium.update(0.1, ball, 30); stadium.reset();
    expect(stadium.debugSnapshot()).toMatchObject({ weather: "rain", trailPoints: 0, activeNetRipples: 0, rainParticles: 220 });
    stadium.update(Number.NaN, ball, 0);
    expect(() => JSON.stringify(stadium.debugSnapshot())).not.toThrow();
  });
});
