import * as THREE from "three";

const WIDTH = 72;
const LENGTH = 112;
const GOAL_WIDTH = 13.5;
const GOAL_HEIGHT = 4.8;
const GOAL_DEPTH = 4.5;
const LENGTH_SCALE = LENGTH / 105;
const WIDTH_SCALE = WIDTH / 68;
const PENALTY_SPOT_Z = LENGTH / 2 - 11 * LENGTH_SCALE;
const TRAIL_CAPACITY = 24;
const RAIN_COUNT = 220;
type Weather = "clear" | "rain";
type GoalNet = { geometry: THREE.BufferGeometry; base: Float32Array; side: -1 | 1; age: number; impactX: number; impactY: number };
const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Pitch markings use the playable side of each goal line, not the run-off area. */
export function createPitchMarkings(): THREE.Vector3[][] {
  const v = (x: number, z: number) => new THREE.Vector3(x, 0.035, z);
  const paths = [
    [v(-36, -56), v(36, -56), v(36, 56), v(-36, 56), v(-36, -56)],
    [v(-36, 0), v(36, 0)],
    Array.from({ length: 97 }, (_, i) => v(Math.cos(i / 96 * Math.PI * 2) * 9.15, Math.sin(i / 96 * Math.PI * 2) * 9.15)),
  ];
  for (const side of [-1, 1]) {
    for (const [standardWidth, standardDepth] of [[40.32, 16.5], [18.32, 5.5]]) {
      const width = standardWidth * WIDTH_SCALE; const depth = standardDepth * LENGTH_SCALE;
      paths.push([v(-width / 2, side * 56), v(-width / 2, side * (56 - depth)), v(width / 2, side * (56 - depth)), v(width / 2, side * 56)]);
    }
    // Only the part of the penalty arc outside the area is marked.
    const arcAngle = Math.acos(5.5 / 9.15);
    paths.push(Array.from({ length: 33 }, (_, i) => {
      const a = -arcAngle + i / 32 * arcAngle * 2;
      return v(Math.sin(a) * 9.15 * LENGTH_SCALE, side * (PENALTY_SPOT_Z - Math.cos(a) * 9.15 * LENGTH_SCALE));
    }));
    for (const x of [-36, 36]) {
      paths.push(Array.from({ length: 13 }, (_, i) => {
        const a = i / 12 * Math.PI / 2;
        return v(x - Math.sign(x) * Math.sin(a), side * (56 - Math.cos(a)));
      }));
    }
  }
  return paths;
}

function grassTexture() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const i = (y * size + x) * 4;
    const grain = noise(y * size + x) * 15;
    pixels[i] = 33 + grain; pixels[i + 1] = 91 + grain; pixels[i + 2] = 49 + grain * 0.45; pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(9, 14); texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

function boardTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 128;
  const context = canvas.getContext("2d"); if (!context) return null;
  context.fillStyle = "#102b38"; context.fillRect(0, 0, 1024, 128);
  ["ELITE KICKOFF", "PLAY TOGETHER", "THE BEAUTIFUL GAME", "NEXT IS NOW"].forEach((label, i) => {
    context.fillStyle = i % 2 === 0 ? "#e9f5f0" : "#8fddc5";
    context.font = "bold 21px Arial"; context.textAlign = "center"; context.fillText(label, i * 256 + 128, 72);
    context.fillStyle = "#d5ac65"; context.fillRect(i * 256 + 16, 100, 224, 3);
  });
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Visual-only arena effects; does not consume the simulation RNG or change ball physics. */
export class StadiumPresentation {
  readonly group = new THREE.Group();
  private weather: Weather = "clear";
  private reducedMotion = false;
  private elapsed = 0;
  private shotAge = 10;
  private goalAge = 10;
  private nets: GoalNet[] = [];
  private trailSamples: THREE.Vector3[] = [];
  private trailAccumulator = 0;
  private trail: THREE.Line;
  private rain: THREE.LineSegments;
  private crowd: THREE.InstancedMesh;
  private shotRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private fill: THREE.DirectionalLight;

  constructor(scene: THREE.Scene) {
    this.group.name = "stadium-presentation"; scene.add(this.group);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x192e37, roughness: 0.88 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x384950, roughness: 0.93 });
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf1f4ef, roughness: 0.32 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const addBox = (name: string, x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(box, material); mesh.name = name; mesh.position.set(x, y, z); mesh.scale.set(w, h, d); mesh.receiveShadow = true; this.group.add(mesh); return mesh;
    };
    this.group.add(new THREE.HemisphereLight(0xd5e8ff, 0x41623c, 2.15));
    const key = new THREE.DirectionalLight(0xffe8c3, 2.8); key.position.set(-36, 78, -42); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -75, right: 75, top: 82, bottom: -82, near: 1, far: 180 });
    key.shadow.normalBias = 0.055; key.shadow.bias = -0.00015; this.group.add(key);
    this.fill = new THREE.DirectionalLight(0xa8d5ff, 1.0); this.fill.position.set(42, 45, 36); this.group.add(this.fill);
    addBox("stadium-plinth", 0, -0.65, 0, 144, 1, 172, baseMaterial);
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(87, 127), new THREE.MeshStandardMaterial({ color: 0x244934, roughness: 1 }));
    surround.rotation.x = -Math.PI / 2; surround.position.y = -0.09; surround.receiveShadow = true; this.group.add(surround);
    const texture = grassTexture();
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, LENGTH), new THREE.MeshStandardMaterial({ map: texture, color: 0xc9e5b8, roughness: 0.96 }));
    grass.name = "pitch-grass"; grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true; this.group.add(grass);
    const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0x94bf7a, transparent: true, opacity: 0.095, roughness: 1, depthWrite: false });
    for (let i = 0; i < 14; i += 2) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, 8), stripeMaterial);
      stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, 0.013, -52 + i * 8); stripe.receiveShadow = true; this.group.add(stripe);
    }
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xe7eee0, transparent: true, opacity: 0.88 });
    for (const points of createPitchMarkings()) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial); line.name = "pitch-marking"; this.group.add(line);
    }
    const spotGeometry = new THREE.CircleGeometry(0.14, 12);
    for (const z of [-PENALTY_SPOT_Z, 0, PENALTY_SPOT_Z]) {
      const spot = new THREE.Mesh(spotGeometry, new THREE.MeshBasicMaterial({ color: 0xe7eee0 })); spot.name = z === 0 ? "center-spot" : "penalty-spot"; spot.rotation.x = -Math.PI / 2; spot.position.set(0, 0.036, z); this.group.add(spot);
    }
    for (const side of [-1, 1] as const) {
      for (const x of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) addBox("goal-post", x, GOAL_HEIGHT / 2, side * 56, 0.26, GOAL_HEIGHT, 0.26, postMaterial);
      addBox("goal-crossbar", 0, GOAL_HEIGHT, side * 56, GOAL_WIDTH + 0.26, 0.26, 0.26, postMaterial);
      this.addNet(side);
      for (const x of [-36, 36]) {
        addBox("corner-pole", x, 1.2, side * 56, 0.09, 2.4, 0.09, postMaterial);
        addBox("corner-flag", x + Math.sign(x) * 0.33, 2.1, side * 56, 0.65, 0.4, 0.05, new THREE.MeshBasicMaterial({ color: 0xe2af57 }));
      }
    }
    const boardMaterial = new THREE.MeshStandardMaterial({ color: 0xd8eeee, map: boardTexture(), roughness: 0.65, emissive: 0x264a51, emissiveIntensity: 0.3 });
    for (const side of [-1, 1]) {
      addBox("sponsor-board", side * 40.2, 0.7, 0, 0.25, 1.4, 116, boardMaterial);
      for (const x of [-23, 23]) addBox("sponsor-board", x, 0.7, side * 63.2, 30, 1.4, 0.25, boardMaterial);
    }
    // Six tiers on all four sides. Seats and spectators share one instanced draw call.
    const crowdPositions: { x: number; y: number; z: number; color: THREE.Color }[] = [];
    const crowdColors = [0xcac7b2, 0x5690a8, 0x1c6078, 0xb4d7ce, 0x9f7457, 0x3d5065];
    for (const side of [-1, 1]) for (let tier = 0; tier < 6; tier += 1) {
      const y = 1.8 + tier * 1.9;
      addBox("stand-tier", side * (47 + tier * 2.8), y / 2, 0, 2.8, y, 128, concrete);
      addBox("stand-tier", 0, y / 2, side * (70 + tier * 2.8), 91, y, 2.8, concrete);
      for (let seat = 0; seat < 62; seat += 1) {
        if (seat % 16 === 0) continue;
        crowdPositions.push({ x: side * (47 + tier * 2.8), y: y + 0.52, z: -61 + seat * 2, color: new THREE.Color(crowdColors[(seat * 7 + tier * 3) % crowdColors.length]) });
      }
      for (let seat = 0; seat < 44; seat += 1) {
        if (seat % 12 === 0) continue;
        crowdPositions.push({ x: -43 + seat * 2, y: y + 0.52, z: side * (70 + tier * 2.8), color: new THREE.Color(crowdColors[(seat * 3 + tier * 5) % crowdColors.length]) });
      }
    }
    this.crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 1.05, 0.85), new THREE.MeshStandardMaterial({ roughness: 0.85 }), crowdPositions.length);
    this.crowd.name = "instanced-crowd";
    const transform = new THREE.Object3D();
    crowdPositions.forEach((seat, index) => { transform.position.set(seat.x, seat.y, seat.z); transform.scale.y = 0.8 + noise(index) * 0.4; transform.updateMatrix(); this.crowd.setMatrixAt(index, transform.matrix); this.crowd.setColorAt(index, seat.color); });
    this.group.add(this.crowd);
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x293d49, metalness: 0.38, roughness: 0.65 });
    const ledMaterial = new THREE.MeshBasicMaterial({ color: 0x72cbbd });
    for (const side of [-1, 1]) {
      addBox("stand-canopy", side * 61, 15.9, 0, 18, 0.55, 130, roofMaterial);
      addBox("stand-ribbon", side * 45.1, 1.8, 0, 0.08, 0.24, 125, ledMaterial);
    }
    for (const x of [-44, 44]) for (const z of [-66, 66]) {
      addBox("floodlight-mast", x, 18, z, 0.45, 36, 0.45, concrete);
      addBox("floodlight-housing", x, 36, z, 8, 2.4, 0.7, roofMaterial);
      const bulbs = new THREE.MeshBasicMaterial({ color: x < 0 ? 0xffe5bb : 0xd0e8ff });
      for (let i = 0; i < 6; i += 1) addBox("floodlight-bulb", x - 3.3 + i * 1.3, 36, z - Math.sign(z) * 0.38, 0.9, 1.45, 0.06, bulbs);
    }
    const trailGeometry = new THREE.BufferGeometry(); trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3)); trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ color: 0xd4eaf4, transparent: true, opacity: 0.38, depthWrite: false })); this.trail.frustumCulled = false; this.trail.name = "ball-trail"; this.group.add(this.trail);
    const rainGeometry = new THREE.BufferGeometry(); rainGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN_COUNT * 6), 3));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xb8d6e0, transparent: true, opacity: 0.24, depthWrite: false })); this.rain.name = "cosmetic-rain"; this.rain.frustumCulled = false; this.rain.visible = false; this.group.add(this.rain);
    this.shotRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 28), new THREE.MeshBasicMaterial({ color: 0xd7ece1, transparent: true, opacity: 0, depthWrite: false })); this.shotRing.rotation.x = -Math.PI / 2; this.shotRing.visible = false; this.group.add(this.shotRing);
  }

  private addNet(side: -1 | 1) {
    const points: number[] = [];
    const segment = (a: number[], b: number[]) => points.push(...a, ...b);
    const back = side * (LENGTH / 2 + GOAL_DEPTH);
    const front = side * LENGTH / 2;
    // Subdivided horizontal and vertical threads ripple without moving their frame anchors.
    const nx = 28; const ny = 12;
    for (let iy = 0; iy <= ny; iy += 1) for (let ix = 0; ix < nx; ix += 1) segment([-GOAL_WIDTH / 2 + ix / nx * GOAL_WIDTH, iy / ny * GOAL_HEIGHT, back], [-GOAL_WIDTH / 2 + (ix + 1) / nx * GOAL_WIDTH, iy / ny * GOAL_HEIGHT, back]);
    for (let ix = 0; ix <= nx; ix += 1) for (let iy = 0; iy < ny; iy += 1) segment([-GOAL_WIDTH / 2 + ix / nx * GOAL_WIDTH, iy / ny * GOAL_HEIGHT, back], [-GOAL_WIDTH / 2 + ix / nx * GOAL_WIDTH, (iy + 1) / ny * GOAL_HEIGHT, back]);
    const geometry = new THREE.BufferGeometry(); const base = new Float32Array(points); geometry.setAttribute("position", new THREE.BufferAttribute(base.slice(), 3));
    const material = new THREE.LineBasicMaterial({ color: 0xdbe9e6, transparent: true, opacity: 0.32 });
    const mesh = new THREE.LineSegments(geometry, material); mesh.name = `goal-net-${side}`; this.group.add(mesh);
    this.nets.push({ geometry, base, side, age: 10, impactX: 0, impactY: 2 });
    const framePoints: number[] = [];
    const add = (a: number[], b: number[]) => framePoints.push(...a, ...b);
    for (let i = 0; i <= 28; i += 1) { const x = -GOAL_WIDTH / 2 + i / 28 * GOAL_WIDTH; add([x, GOAL_HEIGHT, front], [x, GOAL_HEIGHT, back]); }
    for (let i = 0; i <= 9; i += 1) {
      const z = front + side * i / 9 * GOAL_DEPTH; add([-GOAL_WIDTH / 2, GOAL_HEIGHT, z], [GOAL_WIDTH / 2, GOAL_HEIGHT, z]);
      for (const x of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) add([x, 0, z], [x, GOAL_HEIGHT, z]);
    }
    for (let i = 0; i <= 12; i += 1) for (const x of [-GOAL_WIDTH / 2, GOAL_WIDTH / 2]) add([x, i / 12 * GOAL_HEIGHT, front], [x, i / 12 * GOAL_HEIGHT, back]);
    const sides = new THREE.BufferGeometry(); sides.setAttribute("position", new THREE.Float32BufferAttribute(framePoints, 3)); this.group.add(new THREE.LineSegments(sides, material));
  }

  setWeather(weather: Weather) { this.weather = weather; this.rain.visible = weather === "rain" && !this.reducedMotion; this.fill.intensity = weather === "rain" ? 0.75 : 1; }
  setReducedMotion(enabled: boolean) {
    this.reducedMotion = enabled;
    if (enabled) this.reset();
    this.rain.visible = this.weather === "rain" && !enabled;
  }
  goal(_team: "home" | "away", position: THREE.Vector3) {
    if (this.reducedMotion) return;
    const side = position.z < 0 ? -1 : 1;
    const net = this.nets.find((candidate) => candidate.side === side)!;
    net.age = 0; net.impactX = THREE.MathUtils.clamp(position.x, -GOAL_WIDTH / 2, GOAL_WIDTH / 2); net.impactY = THREE.MathUtils.clamp(position.y, 0.5, GOAL_HEIGHT - 0.5); this.goalAge = 0;
    this.trailSamples.length = 0; this.trail.geometry.setDrawRange(0, 0);
  }
  shot(position: THREE.Vector3) {
    if (this.reducedMotion) return;
    this.shotAge = 0; this.shotRing.position.set(position.x, 0.06, position.z);
    this.trailSamples.length = 0; this.trailAccumulator = 0;
  }
  update(dt: number, ballPosition: THREE.Vector3, ballSpeed: number) {
    const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    this.elapsed += step; this.goalAge += step; this.shotAge += step;
    this.crowd.position.y = !this.reducedMotion && this.goalAge < 2 ? Math.abs(Math.sin(this.goalAge * 12)) * 0.26 * Math.exp(-this.goalAge) : 0;
    for (const net of this.nets) {
      if (net.age > 3) continue;
      net.age += step; const attribute = net.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < net.base.length; i += 3) {
        const x = net.base[i]; const y = net.base[i + 1];
        const anchor = Math.sin((x / GOAL_WIDTH + 0.5) * Math.PI) * Math.sin(y / GOAL_HEIGHT * Math.PI);
        const distance = Math.hypot(x - net.impactX, y - net.impactY);
        attribute.array[i + 2] = net.base[i + 2] + (net.age < 3 && !this.reducedMotion ? net.side * anchor * Math.sin(net.age * 19 - distance * 0.8) * Math.exp(-net.age * 2.5) * 0.85 : 0);
      }
      attribute.needsUpdate = true; net.geometry.computeBoundingSphere();
    }
    this.shotRing.visible = !this.reducedMotion && this.shotAge < 0.35;
    if (this.shotRing.visible) { this.shotRing.scale.setScalar(1 + this.shotAge * 5); this.shotRing.material.opacity = (1 - this.shotAge / 0.35) * 0.35; }
    const trailActive = !this.reducedMotion && Number.isFinite(ballSpeed) && ballSpeed > 16 && (this.shotAge < 1.5 || ballSpeed > 28) && Number.isFinite(ballPosition.lengthSq());
    this.trailAccumulator += step;
    if (this.trailAccumulator >= 0.025) {
      this.trailAccumulator = 0;
      if (trailActive) {
        const previous = this.trailSamples[this.trailSamples.length - 1];
        if (previous && previous.distanceToSquared(ballPosition) > 400) this.trailSamples.length = 0;
        this.trailSamples.push(ballPosition.clone()); if (this.trailSamples.length > TRAIL_CAPACITY) this.trailSamples.shift();
      } else this.trailSamples.shift();
      const attribute = this.trail.geometry.getAttribute("position") as THREE.BufferAttribute;
      this.trailSamples.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z)); attribute.needsUpdate = true;
      this.trail.geometry.setDrawRange(0, this.trailSamples.length);
    }
    if (this.rain.visible) {
      const attribute = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < RAIN_COUNT; i += 1) {
        const x = noise(i * 3) * 86 - 43; const z = noise(i * 3 + 1) * 126 - 63;
        const y = ((noise(i * 3 + 2) * 28 - this.elapsed * 24) % 28 + 28) % 28;
        attribute.setXYZ(i * 2, x, y, z); attribute.setXYZ(i * 2 + 1, x + 0.16, y + 1.25, z - 0.08);
      }
      attribute.needsUpdate = true;
    }
  }
  reset() {
    this.elapsed = 0; this.shotAge = 10; this.goalAge = 10; this.trailAccumulator = 0; this.trailSamples.length = 0;
    this.trail.geometry.setDrawRange(0, 0); this.shotRing.visible = false; this.crowd.position.y = 0;
    for (const net of this.nets) { net.age = 10; const attribute = net.geometry.getAttribute("position") as THREE.BufferAttribute; attribute.array.set(net.base); attribute.needsUpdate = true; net.geometry.computeBoundingSphere(); }
  }
  debugSnapshot() {
    return { weather: this.weather, reducedMotion: this.reducedMotion, crowdInstances: this.crowd.count, rainParticles: this.rain.visible ? RAIN_COUNT : 0, trailPoints: this.trailSamples.length, trailCapacity: TRAIL_CAPACITY, activeNetRipples: this.nets.filter((net) => net.age < 3).length, goalHeight: GOAL_HEIGHT, pitch: { width: WIDTH, length: LENGTH } };
  }
}

export function addPitch(scene: THREE.Scene): StadiumPresentation { return new StadiumPresentation(scene); }
