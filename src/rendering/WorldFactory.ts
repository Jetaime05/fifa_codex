import * as THREE from "three";
import type { PlayerData, TeamData } from "../data/types";

export const FIELD_WIDTH = 72;
export const FIELD_LENGTH = 112;
export const HALF_W = FIELD_WIDTH / 2;
export const HALF_L = FIELD_LENGTH / 2;
export const GOAL_WIDTH = 13.5;
export const GOAL_DEPTH = 4.5;

function makeTextSprite(text: string, color: string) {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "rgba(0,0,0,.52)"; ctx.roundRect(18, 12, 220, 62, 14); ctx.fill(); ctx.font = "800 24px Arial"; ctx.textAlign = "center"; ctx.fillStyle = color; ctx.fillText(text, 128, 52);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(6.6, 2.45, 1); return sprite;
}

export function createPlayerVisual(team: TeamData, spec: PlayerData) {
  const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.58 });
  const group = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.05, 8, 16), material(team.secondary)); lower.position.y = 1.05;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.68, 1.28, 8, 18), material(team.primary)); body.position.y = 2.04;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), material(0xc99265)); head.position.y = 3.12;
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.72), material(0x141414)); boot.position.set(-0.28, 0.2, 0.12); const boot2 = boot.clone(); boot2.position.x = 0.28;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.45, 0.08), material(team.accent)); stripe.position.set(0, 2.05, -0.66);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.18, 36), new THREE.MeshBasicMaterial({ color: 0xffe15b, transparent: true, opacity: 0 })); marker.rotation.x = -Math.PI / 2; marker.position.y = 0.04;
  const label = document.createElement("div"); label.className = "name-tag"; label.textContent = spec.short;
  const number = makeTextSprite(String(spec.number), team.id === "home" ? "#fff7cc" : "#e8fbff"); number.position.set(0, 4.3, 0);
  group.add(lower, body, head, boot, boot2, stripe, marker, number); group.traverse((object) => { if ("castShadow" in object) object.castShadow = true; });
  return { group, body, marker, label };
}

export function createBallVisual(radius: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.45, metalness: 0.04 }));
  mesh.castShadow = true; mesh.receiveShadow = true; return mesh;
}

function addGoal(scene: THREE.Scene, side: -1 | 1) {
  const post = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 0.35 }); const net = new THREE.MeshBasicMaterial({ color: 0xeaf4f0, transparent: true, opacity: 0.18, wireframe: true }); const group = new THREE.Group(); const z = side * (HALF_L + GOAL_DEPTH / 2); const back = side * (HALF_L + GOAL_DEPTH);
  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(GOAL_WIDTH, 0.35, 0.35), post); crossbar.position.set(0, 4, side * HALF_L);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), post); left.position.set(-GOAL_WIDTH / 2, 2, side * HALF_L); const right = left.clone(); right.position.x = GOAL_WIDTH / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(GOAL_WIDTH, 0.14, GOAL_DEPTH), net); roof.position.set(0, 4, z); const backNet = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_WIDTH, 4), net); backNet.position.set(0, 2, back);
  const sideA = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, 4), net); sideA.position.set(-GOAL_WIDTH / 2, 2, z); sideA.rotation.y = Math.PI / 2; const sideB = sideA.clone(); sideB.position.x = GOAL_WIDTH / 2;
  group.add(crossbar, left, right, roof, backNet, sideA, sideB); scene.add(group);
}

function addStadium(scene: THREE.Scene) {
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1b2625, roughness: 0.78 }); const accents = [0xf2f2e8, 0x71caed, 0x263a87, 0xd0a842].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  const addStand = (x: number) => { const stand = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 120), standMat); stand.position.set(x, 4.6, 0); stand.castShadow = stand.receiveShadow = true; scene.add(stand); for (let i = 0; i < 42; i += 1) { const seat = new THREE.Mesh(new THREE.BoxGeometry(12 / 44, 0.25, 86), accents[i % accents.length]); seat.position.set(x - 6 + (i + 0.5) * (12 / 42), 10 + (i % 4) * 0.25, 0); scene.add(seat); } };
  addStand(-50); addStand(50);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x242d2b, roughness: 0.52 }); for (const [x, z] of [[-48, -65], [48, -65], [-48, 65], [48, 65]]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 37, 12), towerMat); pole.position.set(x, 18.5, z); scene.add(pole); const lamp = new THREE.Mesh(new THREE.BoxGeometry(9, 2.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xe7f2ff, emissive: 0xaecfff, emissiveIntensity: 0.45 })); lamp.position.set(x, 37, z); scene.add(lamp); }
}

export function addPitch(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xeaf8ff, 0x0d1d13, 1.65)); const sun = new THREE.DirectionalLight(0xfff1d5, 2.7); sun.position.set(-34, 78, -44); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -90; sun.shadow.camera.right = 90; sun.shadow.camera.top = 100; sun.shadow.camera.bottom = -100; sun.shadow.camera.far = 170; scene.add(sun);
  for (const [x, y, z] of [[-48, 42, -68], [48, 42, -68], [-48, 42, 68], [48, 42, 68]]) { const light = new THREE.PointLight(0xdbefff, 92, 150, 1.75); light.position.set(x, y, z); scene.add(light); }
  const grass = document.createElement("canvas"); grass.width = grass.height = 256; const ctx = grass.getContext("2d")!; ctx.fillStyle = "#1d6d3b"; ctx.fillRect(0, 0, 256, 256); const texture = new THREE.CanvasTexture(grass); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(8, 13); texture.colorSpace = THREE.SRGBColorSpace;
  const field = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_LENGTH, 18, 28), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 })); field.rotation.x = -Math.PI / 2; field.receiveShadow = true; scene.add(field);
  const lines = new THREE.LineBasicMaterial({ color: 0xf1f5ec }); const addLine = (points: THREE.Vector3[]) => { const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lines); line.position.y = 0.045; scene.add(line); };
  addLine([new THREE.Vector3(-HALF_W, 0, -HALF_L), new THREE.Vector3(HALF_W, 0, -HALF_L), new THREE.Vector3(HALF_W, 0, HALF_L), new THREE.Vector3(-HALF_W, 0, HALF_L), new THREE.Vector3(-HALF_W, 0, -HALF_L)]); addLine([new THREE.Vector3(-HALF_W, 0, 0), new THREE.Vector3(HALF_W, 0, 0)]); const center = new THREE.EllipseCurve(0, 0, 9.15, 9.15, 0, Math.PI * 2, false, 0); addLine(center.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y)));
  const rect = (width: number, length: number, z: number) => { const x = width / 2; const end = z + length * Math.sign(z); addLine([new THREE.Vector3(-x, 0, z), new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0, end), new THREE.Vector3(-x, 0, end), new THREE.Vector3(-x, 0, z)]); }; rect(40.3, 16.5, -HALF_L); rect(18.3, 5.5, -HALF_L); rect(40.3, 16.5, HALF_L); rect(18.3, 5.5, HALF_L); addGoal(scene, -1); addGoal(scene, 1); addStadium(scene);
}
