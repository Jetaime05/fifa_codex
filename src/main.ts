import * as THREE from "three";
import {
  addGoal as addScoreGoal,
  addMatchEvent,
  advanceMatchClock,
  clockText,
  compactScoreText,
  createInitialMatchState,
  isMatchClockExpired,
  isMatchEnded,
  resetMatchState,
  scoreText,
  setActivePlayerId,
  setBallOwnerId,
  setFullTime,
  setMatchStatus,
  startMatchIfNeeded,
  switchCameraMode
} from "./core/match/MatchState";
import type { CameraMode } from "./core/match/MatchState";
import { updateBallPhysics } from "./core/systems/BallSystem";
import { separatePlayers as separatePlayerCollisions } from "./core/systems/CollisionSystem";
import { updatePlayerMovement as updateMovementSystem } from "./core/systems/MovementSystem";
import { resolvePossession as resolvePossessionSystem } from "./core/systems/PossessionSystem";
import type { SimPlayer } from "./core/systems/types";
import { manCity, realMadrid } from "./data/teams";
import type { PlayerData, TeamData, TeamId } from "./data/types";
import "./styles.css";

type Player = PlayerData &
  SimPlayer & {
  marker: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: HTMLDivElement;
  target: THREE.Vector3;
};

declare global {
  interface Window {
    __eliteKickoffDebug?: {
      sampleCanvas: () => {
        width: number;
        height: number;
        samples: number[][];
        nonDarkSamples: number;
      };
      state: () => {
        players: number;
        score: string;
        clock: string;
        ballOwner: string;
        cameraMode: CameraMode;
      };
    };
  }
}

const FIELD_WIDTH = 72;
const FIELD_LENGTH = 112;
const HALF_W = FIELD_WIDTH / 2;
const HALF_L = FIELD_LENGTH / 2;
const PLAYER_RADIUS = 0.75;
const PLAYER_HEIGHT = 3.4;
const BALL_RADIUS = 0.55;
const GOAL_WIDTH = 13.5;
const GOAL_DEPTH = 4.5;
const MATCH_DURATION = 240;
const GAME_SPEED = 1.55;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const rand = (min: number, max: number) => min + Math.random() * (max - min);

const vectorToField = (x: number, z: number) =>
  new THREE.Vector3(clamp(x, -HALF_W + 2, HALF_W - 2), 0, clamp(z, -HALF_L + 3, HALF_L - 3));

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

app.innerHTML = `
  <main class="game-root">
    <canvas class="game-canvas" tabindex="0" aria-label="Elite Kickoff 3D game canvas"></canvas>
    <output data-render-debug hidden></output>
    <section class="hud">
      <div class="scoreboard">
        <div class="team home"><span>Real Madrid</span><i class="crest real"></i></div>
        <div class="score-core"><div class="score" data-score>0 - 0</div><div class="clock" data-clock>00:00</div></div>
        <div class="team away"><i class="crest city"></i><span>Man City</span></div>
      </div>
      <div class="top-left">
        <div class="chip-row">
          <div class="chip" data-camera-chip>Broadcast Cam</div>
          <div class="chip" data-possession-chip>Kickoff</div>
        </div>
        <div class="feed" data-feed></div>
      </div>
      <div class="minimap" data-minimap></div>
      <div class="player-panel">
        <div class="player-name" data-player-name>Vinicius Junior</div>
        <div class="player-meta">
          <span data-player-role>LW</span>
          <span data-player-status>Ready</span>
        </div>
        <div class="stamina"><span data-stamina style="width:100%"></span></div>
      </div>
      <div class="controls">
        <div class="controls-title">Controls</div>
        <div class="key-grid">
          <div class="key">WASD Move</div>
          <div class="key">Shift Sprint</div>
          <div class="key">J Pass</div>
          <div class="key">K Shoot</div>
          <div class="key">L Tackle</div>
          <div class="key">Tab Switch</div>
          <div class="key">C Camera</div>
          <div class="key">R Reset</div>
        </div>
      </div>
      <div class="mobile-pad">
        <div class="stick" data-stick></div>
        <div class="button-cluster">
          <div class="touch-button" data-action="pass">PASS</div>
          <div class="touch-button" data-action="shoot">SHOOT</div>
          <div class="touch-button" data-action="sprint">SPRINT</div>
          <div class="touch-button" data-action="tackle">TACKLE</div>
        </div>
      </div>
      <div class="match-over" data-match-over>
        <div class="result-box">
          <h1 class="result-title">Full Time</h1>
          <p class="result-score" data-result-score>Real Madrid 0 - 0 Man City</p>
          <button class="restart" data-restart>Restart Match</button>
        </div>
      </div>
    </section>
  </main>
`;

const canvas = document.querySelector<HTMLCanvasElement>(".game-canvas")!;
const scoreEl = document.querySelector<HTMLElement>("[data-score]")!;
const clockEl = document.querySelector<HTMLElement>("[data-clock]")!;
const cameraChip = document.querySelector<HTMLElement>("[data-camera-chip]")!;
const possessionChip = document.querySelector<HTMLElement>("[data-possession-chip]")!;
const feedEl = document.querySelector<HTMLElement>("[data-feed]")!;
const playerNameEl = document.querySelector<HTMLElement>("[data-player-name]")!;
const playerRoleEl = document.querySelector<HTMLElement>("[data-player-role]")!;
const playerStatusEl = document.querySelector<HTMLElement>("[data-player-status]")!;
const staminaEl = document.querySelector<HTMLElement>("[data-stamina]")!;
const minimapEl = document.querySelector<HTMLElement>("[data-minimap]")!;
const matchOverEl = document.querySelector<HTMLElement>("[data-match-over]")!;
const resultScoreEl = document.querySelector<HTMLElement>("[data-result-score]")!;
const restartButton = document.querySelector<HTMLButtonElement>("[data-restart]")!;
const stickEl = document.querySelector<HTMLElement>("[data-stick]")!;
const renderDebugEl = document.querySelector<HTMLOutputElement>("[data-render-debug]")!;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x07100f, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07100f);
scene.fog = new THREE.Fog(0x07100f, 92, 186);

const camera = new THREE.PerspectiveCamera(53, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 92, -38);
camera.lookAt(0, 0, 0);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const keyState = new Set<string>();
const mobileInput = {
  active: false,
  id: -1,
  baseX: 0,
  baseY: 0,
  x: 0,
  y: 0,
  sprint: false,
  pass: false,
  shoot: false,
  tackle: false
};

let players: Player[] = [];
let homePlayers: Player[] = [];
let awayPlayers: Player[] = [];
let activePlayer: Player;
let ballOwner: Player | null = null;
let lastTouch: Player | null = null;
let attackingTeam: TeamId = "home";
const matchState = createInitialMatchState(MATCH_DURATION);
let passLatch = false;
let shootLatch = false;
let tackleLatch = false;
let switchLatch = false;
let cameraLatch = false;
let restartLatch = false;
let lastRenderDebugAt = 0;
let lastFrameCaptureAt = 0;

const ball = {
  mesh: new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 18),
    new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.45, metalness: 0.04 })
  ),
  position: new THREE.Vector3(0, BALL_RADIUS, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  spin: new THREE.Vector3(0, 0, 0)
};

ball.mesh.castShadow = true;
ball.mesh.receiveShadow = true;

function createTextSprite(text: string, color: string) {
  const canvasText = document.createElement("canvas");
  canvasText.width = 256;
  canvasText.height = 96;
  const ctx = canvasText.getContext("2d")!;
  ctx.clearRect(0, 0, canvasText.width, canvasText.height);
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.roundRect(18, 12, 220, 62, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = "800 24px Arial";
  ctx.textAlign = "center";
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 52);
  const texture = new THREE.CanvasTexture(canvasText);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(6.6, 2.45, 1);
  return sprite;
}

function makeKitMaterial(team: TeamData) {
  return {
    shirt: new THREE.MeshStandardMaterial({ color: team.primary, roughness: 0.58, metalness: 0.02 }),
    shorts: new THREE.MeshStandardMaterial({ color: team.secondary, roughness: 0.58, metalness: 0.02 }),
    accent: new THREE.MeshStandardMaterial({ color: team.accent, roughness: 0.52, metalness: 0.03 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc99265, roughness: 0.62 }),
    boot: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5 })
  };
}

function createPlayerMesh(team: TeamData, spec: PlayerData) {
  const materials = makeKitMaterial(team);
  const group = new THREE.Group();
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.05, 8, 16), materials.shorts);
  lower.position.y = 1.05;
  lower.castShadow = true;
  lower.receiveShadow = true;

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.68, 1.28, 8, 18), materials.shirt);
  body.position.y = 2.04;
  body.castShadow = true;
  body.receiveShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 14), materials.skin);
  head.position.y = 3.12;
  head.castShadow = true;

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.72), materials.boot);
  leftBoot.position.set(-0.28, 0.2, 0.12);
  leftBoot.castShadow = true;

  const rightBoot = leftBoot.clone();
  rightBoot.position.x = 0.28;
  rightBoot.castShadow = true;

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.45, 0.08), materials.accent);
  stripe.position.set(0, 2.05, -0.66);

  const marker = new THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>(
    new THREE.RingGeometry(0.95, 1.18, 36),
    new THREE.MeshBasicMaterial({ color: 0xffe15b, transparent: true, opacity: 0 })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.04;

  const label = document.createElement("div");
  label.className = "name-tag";
  label.textContent = spec.short;

  const numberSprite = createTextSprite(String(spec.number), team.id === "home" ? "#fff7cc" : "#e8fbff");
  numberSprite.position.set(0, 4.3, 0);

  group.add(lower, body, head, leftBoot, rightBoot, stripe, marker, numberSprite);
  group.traverse((obj) => {
    if ("castShadow" in obj) {
      obj.castShadow = true;
    }
  });

  return { group, body, marker, label };
}

function createPlayer(team: TeamData, spec: PlayerData): Player {
  const { group, body, marker, label } = createPlayerMesh(team, spec);
  const position = vectorToField(spec.formation.x, spec.formation.z);
  group.position.copy(position);
  scene.add(group);

  return {
    ...spec,
    id: `${team.id}-${spec.number}`,
    team: team.id,
    mesh: group,
    body,
    marker,
    label,
    position,
    velocity: new THREE.Vector3(),
    home: position.clone(),
    target: position.clone(),
    hasBall: false,
    stamina: 1,
    cooldown: 0,
    intent: spec.role === "GK" ? "keeper" : "hold"
  };
}

function addPitch() {
  const ambient = new THREE.HemisphereLight(0xeaf8ff, 0x0d1d13, 1.65);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff1d5, 2.7);
  sun.position.set(-34, 78, -44);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 170;
  scene.add(sun);

  const floodLightPositions = [
    [-48, 42, -68],
    [48, 42, -68],
    [-48, 42, 68],
    [48, 42, 68]
  ];
  floodLightPositions.forEach(([x, y, z]) => {
    const light = new THREE.PointLight(0xdbefff, 92, 150, 1.75);
    light.position.set(x, y, z);
    scene.add(light);
  });

  const fieldTexture = makeGrassTexture();
  fieldTexture.wrapS = THREE.RepeatWrapping;
  fieldTexture.wrapT = THREE.RepeatWrapping;
  fieldTexture.repeat.set(8, 13);
  fieldTexture.colorSpace = THREE.SRGBColorSpace;

  const field = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_LENGTH, 18, 28),
    new THREE.MeshStandardMaterial({ map: fieldTexture, roughness: 0.9 })
  );
  field.rotation.x = -Math.PI / 2;
  field.receiveShadow = true;
  scene.add(field);

  const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
  for (let i = 0; i < 10; i += 1) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_LENGTH / 10), stripeMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.y = 0.012;
    stripe.position.z = -HALF_L + FIELD_LENGTH / 20 + i * (FIELD_LENGTH / 10);
    if (i % 2 === 0) {
      scene.add(stripe);
    }
  }

  const lineMat = new THREE.LineBasicMaterial({ color: 0xf1f5ec, linewidth: 2 });
  const addLine = (points: THREE.Vector3[]) => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, lineMat);
    line.position.y = 0.045;
    scene.add(line);
  };

  const rect = (w: number, l: number, z: number) => {
    const x = w / 2;
    const z0 = z;
    const z1 = z + l * Math.sign(z);
    addLine([
      new THREE.Vector3(-x, 0, z0),
      new THREE.Vector3(x, 0, z0),
      new THREE.Vector3(x, 0, z1),
      new THREE.Vector3(-x, 0, z1),
      new THREE.Vector3(-x, 0, z0)
    ]);
  };

  addLine([
    new THREE.Vector3(-HALF_W, 0, -HALF_L),
    new THREE.Vector3(HALF_W, 0, -HALF_L),
    new THREE.Vector3(HALF_W, 0, HALF_L),
    new THREE.Vector3(-HALF_W, 0, HALF_L),
    new THREE.Vector3(-HALF_W, 0, -HALF_L)
  ]);
  addLine([new THREE.Vector3(-HALF_W, 0, 0), new THREE.Vector3(HALF_W, 0, 0)]);

  const center = new THREE.EllipseCurve(0, 0, 9.15, 9.15, 0, Math.PI * 2, false, 0);
  addLine(center.getPoints(96).map((p) => new THREE.Vector3(p.x, 0, p.y)));
  rect(40.3, 16.5, -HALF_L);
  rect(18.3, 5.5, -HALF_L);
  rect(40.3, 16.5, HALF_L);
  rect(18.3, 5.5, HALF_L);

  const penaltyDots = [
    new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0xf1f5ec })),
    new THREE.Mesh(new THREE.CircleGeometry(0.32, 24), new THREE.MeshBasicMaterial({ color: 0xf1f5ec }))
  ];
  penaltyDots[0].position.set(0, 0.052, -HALF_L + 11);
  penaltyDots[1].position.set(0, 0.052, HALF_L - 11);
  penaltyDots.forEach((dot) => {
    dot.rotation.x = -Math.PI / 2;
    scene.add(dot);
  });

  addGoal(-1);
  addGoal(1);
  addStadium();
}

function makeGrassTexture() {
  const texCanvas = document.createElement("canvas");
  texCanvas.width = 256;
  texCanvas.height = 256;
  const ctx = texCanvas.getContext("2d")!;
  ctx.fillStyle = "#1d6d3b";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2400; i += 1) {
    const shade = Math.floor(rand(36, 98));
    ctx.fillStyle = `rgba(${shade}, ${Math.floor(shade * 1.8)}, ${Math.floor(shade * 0.82)}, ${rand(0.08, 0.2)})`;
    ctx.fillRect(rand(0, 256), rand(0, 256), rand(1, 3), rand(1, 4));
  }
  return new THREE.CanvasTexture(texCanvas);
}

function addGoal(side: -1 | 1) {
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 0.35, metalness: 0.05 });
  const netMat = new THREE.MeshBasicMaterial({ color: 0xeaf4f0, transparent: true, opacity: 0.18, wireframe: true });
  const group = new THREE.Group();
  const z = side * (HALF_L + GOAL_DEPTH / 2);
  const back = side * (HALF_L + GOAL_DEPTH);

  const crossbar = new THREE.Mesh(new THREE.BoxGeometry(GOAL_WIDTH, 0.35, 0.35), postMat);
  crossbar.position.set(0, 4, side * HALF_L);
  const left = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4, 0.35), postMat);
  left.position.set(-GOAL_WIDTH / 2, 2, side * HALF_L);
  const right = left.clone();
  right.position.x = GOAL_WIDTH / 2;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(GOAL_WIDTH, 0.14, GOAL_DEPTH), netMat);
  roof.position.set(0, 4, z);
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_WIDTH, 4), netMat);
  backNet.position.set(0, 2, back);
  const sideNetA = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_DEPTH, 4), netMat);
  sideNetA.position.set(-GOAL_WIDTH / 2, 2, z);
  sideNetA.rotation.y = Math.PI / 2;
  const sideNetB = sideNetA.clone();
  sideNetB.position.x = GOAL_WIDTH / 2;

  group.add(crossbar, left, right, roof, backNet, sideNetA, sideNetB);
  scene.add(group);
}

function addStadium() {
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1b2625, roughness: 0.78, metalness: 0.06 });
  const accentMats = [
    new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x71caed, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0x263a87, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xd0a842, roughness: 0.7 })
  ];

  const addStand = (x: number, z: number, w: number, d: number, rot = 0) => {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(w, 10, d), standMat);
    stand.position.set(x, 4.6, z);
    stand.rotation.y = rot;
    stand.receiveShadow = true;
    stand.castShadow = true;
    scene.add(stand);

    for (let i = 0; i < 42; i += 1) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(w / 44, 0.25, d * 0.72), accentMats[i % accentMats.length]);
      seat.position.set(x - w / 2 + (i + 0.5) * (w / 42), 10 + (i % 4) * 0.25, z - d * 0.05);
      seat.rotation.y = rot;
      scene.add(seat);
    }
  };

  addStand(-50, 0, 12, 120);
  addStand(50, 0, 12, 120);

  const towerMat = new THREE.MeshStandardMaterial({ color: 0x242d2b, roughness: 0.52, metalness: 0.15 });
  [
    [-48, -65],
    [48, -65],
    [-48, 65],
    [48, 65]
  ].forEach(([x, z]) => {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 37, 12), towerMat);
    pole.position.set(x, 18.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const lamps = new THREE.Mesh(
      new THREE.BoxGeometry(9, 2.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xe7f2ff, emissive: 0xaecfff, emissiveIntensity: 0.45 })
    );
    lamps.position.set(x, 37, z);
    scene.add(lamps);
  });
}

function setupPlayers() {
  homePlayers = realMadrid.players.map((spec) => createPlayer(realMadrid, spec));
  awayPlayers = manCity.players.map((spec) => createPlayer(manCity, spec));
  players = [...homePlayers, ...awayPlayers];
  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  activePlayer.marker.material.opacity = 0.92;
  activePlayer.marker.scale.setScalar(1.16);
}

function resetMatch(keepScore = false) {
  if (!keepScore) {
    resetMatchState(matchState);
    matchOverEl.classList.remove("visible");
  } else {
    setMatchStatus(matchState, "playing");
  }

  [...homePlayers, ...awayPlayers].forEach((player) => {
    player.position.copy(player.home);
    player.velocity.set(0, 0, 0);
    player.mesh.position.copy(player.position);
    player.mesh.rotation.y = player.team === "home" ? 0 : Math.PI;
    player.hasBall = false;
    player.cooldown = 0;
    player.stamina = Math.min(1, player.stamina + 0.18);
    player.marker.material.opacity = player === activePlayer ? 0.92 : 0;
  });

  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  setActivePlayer(activePlayer);
  ball.position.set(0, BALL_RADIUS, 0);
  ball.velocity.set(0, 0, 0);
  ball.mesh.position.copy(ball.position);
  ballOwner = null;
  setBallOwnerId(matchState, null);
  lastTouch = null;
  attackingTeam = "home";
  addMatchEvent(matchState, "restart", "Kickoff at the Bernabeu-inspired arena.");
  addFeed("Kickoff at the Bernabeu-inspired arena.");
  updateHud();
}

function setActivePlayer(player: Player) {
  activePlayer.marker.material.opacity = 0;
  activePlayer.marker.scale.setScalar(1);
  activePlayer = player;
  setActivePlayerId(matchState, player.id);
  activePlayer.marker.material.opacity = 0.92;
  activePlayer.marker.scale.setScalar(1.16);
  updateHud();
}

function addFeed(text: string) {
  const item = document.createElement("div");
  item.className = "feed-item";
  item.textContent = text;
  feedEl.prepend(item);
  while (feedEl.children.length > 4) {
    feedEl.lastChild?.remove();
  }
}

function attachBallTo(player: Player) {
  if (ballOwner && ballOwner !== player) {
    ballOwner.hasBall = false;
  }
  ballOwner = player;
  setBallOwnerId(matchState, player.id);
  lastTouch = player;
  player.hasBall = true;
  attackingTeam = player.team;
  ball.velocity.set(0, 0, 0);
  addMatchEvent(matchState, "possession", `${player.short} takes possession.`);
}

function releaseBall() {
  if (ballOwner) {
    ballOwner.hasBall = false;
  }
  ballOwner = null;
  setBallOwnerId(matchState, null);
}

function playerForward(player: SimPlayer) {
  const forward = new THREE.Vector3(0, 0, player.team === "home" ? 1 : -1);
  const speed = player.velocity.length();
  if (speed > 0.15) {
    forward.copy(player.velocity).normalize();
  }
  return forward;
}

function findNearestPlayer(team: TeamId, position: THREE.Vector3, includeKeeper = true) {
  const list = team === "home" ? homePlayers : awayPlayers;
  let closest = list[0];
  let best = Number.POSITIVE_INFINITY;
  for (const p of list) {
    if (!includeKeeper && p.role === "GK") {
      continue;
    }
    const d = p.position.distanceToSquared(position);
    if (d < best) {
      closest = p;
      best = d;
    }
  }
  return closest;
}

function switchToNearestHome() {
  const candidates = homePlayers.filter((p) => p.role !== "GK");
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const player of candidates) {
    const distance = player.position.distanceToSquared(ball.position);
    const penalty = player === activePlayer ? 120 : 0;
    if (distance + penalty < bestScore) {
      best = player;
      bestScore = distance + penalty;
    }
  }
  setActivePlayer(best);
}

function passBall(player: Player) {
  if (ballOwner !== player) {
    return;
  }
  const teammates = (player.team === "home" ? homePlayers : awayPlayers).filter((p) => p !== player);
  const dir = playerForward(player);
  const target =
    teammates
      .map((p) => {
        const to = p.position.clone().sub(player.position);
        const ahead = to.clone().normalize().dot(dir);
        const open = nearestOpponentDistance(p);
        const lane = ahead * 18 + open * 0.5 - to.length() * 0.08 + p.stats.pace * 0.03;
        return { player: p, score: lane };
      })
      .sort((a, b) => b.score - a.score)[0]?.player ?? teammates[0];

  const toTarget = target.position.clone().sub(ball.position);
  const strength = clamp(18 + player.stats.passing * 0.16 + toTarget.length() * 0.18, 18, 32);
  releaseBall();
  ball.velocity.copy(toTarget.normalize().multiplyScalar(strength));
  ball.velocity.y = 0.35;
  addMatchEvent(matchState, "pass", `${player.short} passes toward ${target.short}.`);
  addFeed(`${player.short} threads a pass toward ${target.short}.`);
}

function shootBall(player: Player) {
  if (ballOwner !== player) {
    return;
  }
  const targetZ = player.team === "home" ? HALF_L + 1.4 : -HALF_L - 1.4;
  const lateralAim = clamp(-player.position.x * 0.18 + rand(-2.8, 2.8), -GOAL_WIDTH / 2 + 0.7, GOAL_WIDTH / 2 - 0.7);
  const target = new THREE.Vector3(lateralAim, 1.25 + rand(0, 1.7), targetZ);
  const distance = player.position.distanceTo(target);
  const power = clamp(28 + player.stats.shooting * 0.23 - distance * 0.08, 24, 44);
  releaseBall();
  ball.velocity.copy(target.sub(ball.position).normalize().multiplyScalar(power));
  ball.velocity.y += rand(1.8, 4.1);
  addMatchEvent(matchState, "shot", `${player.short} shoots.`);
  addFeed(`${player.short} hits it with power.`);
}

function tackle(player: Player) {
  const opponents = player.team === "home" ? awayPlayers : homePlayers;
  const owner = ballOwner;
  const target = owner && owner.team !== player.team ? owner : findNearestPlayer(opponents[0].team, player.position, true);
  const dist = target.position.distanceTo(player.position);
  if (dist < 3.2) {
    const success = player.stats.defending + player.stats.physical * 0.4 + rand(0, 35);
    const resistance = target.stats.dribbling + target.stats.physical * 0.28 + rand(0, 35);
    if (success > resistance) {
      attachBallTo(player);
      addMatchEvent(matchState, "tackle", `${player.short} wins the tackle.`);
      addFeed(`${player.short} wins the tackle.`);
    } else if (ballOwner === target) {
      const knock = target.position.clone().sub(player.position).normalize().multiplyScalar(9);
      releaseBall();
      ball.velocity.copy(knock);
      addMatchEvent(matchState, "tackle", `${player.short} pokes it loose.`);
      addFeed(`${player.short} pokes it loose.`);
    }
  }
}

function nearestOpponentDistance(player: Player) {
  const opponents = player.team === "home" ? awayPlayers : homePlayers;
  let best = Number.POSITIVE_INFINITY;
  for (const opponent of opponents) {
    best = Math.min(best, opponent.position.distanceTo(player.position));
  }
  return best;
}

function updatePlayerMovement(player: Player, inputDirection: THREE.Vector3, sprint: boolean, dt: number) {
  updateMovementSystem({
    player,
    inputDirection,
    sprint,
    dt,
    bounds: {
      halfWidth: HALF_W,
      halfLength: HALF_L
    },
    playerRadius: PLAYER_RADIUS,
    isControlled: player === activePlayer,
    hasBall: ballOwner === player
  });
}

function updateAI(dt: number) {
  const homeHasBall = ballOwner?.team === "home";
  const awayHasBall = ballOwner?.team === "away";

  for (const player of players) {
    if (player === activePlayer) {
      continue;
    }

    player.cooldown = Math.max(0, player.cooldown - dt);
    const team = player.team === "home" ? realMadrid : manCity;
    const isTeamInPossession = ballOwner?.team === player.team;
    const isOpponentPossession = ballOwner && ballOwner.team !== player.team;
    const homeShift = player.team === "home" ? (homeHasBall ? 11 : -4) : awayHasBall ? -11 : 4;
    const compactX = ball.position.x * (isOpponentPossession ? 0.18 : 0.1);
    const shapeTarget = player.home.clone();
    shapeTarget.z = clamp(shapeTarget.z + homeShift, -HALF_L + 5, HALF_L - 5);
    shapeTarget.x = clamp(shapeTarget.x + compactX, -HALF_W + 4, HALF_W - 4);

    let target = shapeTarget;
    let sprint = false;

    if (player.role === "GK") {
      const goalZ = player.team === "home" ? -HALF_L + 2.4 : HALF_L - 2.4;
      const ballThreat = Math.abs(ball.position.z - goalZ) < 24;
      target = new THREE.Vector3(clamp(ball.position.x * 0.34, -GOAL_WIDTH / 2, GOAL_WIDTH / 2), 0, goalZ);
      if (ballThreat && player.position.distanceTo(ball.position) < 7.4) {
        target = ball.position.clone();
        sprint = true;
      }
      if (ballOwner === player && player.cooldown <= 0) {
        passBall(player);
        player.cooldown = 1.2;
      }
    } else if (!ballOwner) {
      const nearest = findNearestPlayer(player.team, ball.position, false);
      if (nearest === player) {
        target = ball.position.clone();
        sprint = true;
        player.intent = "chase";
      } else {
        player.intent = "return";
      }
    } else if (ballOwner === player) {
      const dir = new THREE.Vector3(0, 0, team.attackingDirection);
      target = player.position.clone().add(dir.multiplyScalar(16));
      target.x += clamp(-player.position.x * 0.16, -2.4, 2.4);
      target.z = clamp(target.z, -HALF_L + 7, HALF_L - 7);
      sprint = true;
      player.intent = "support";

      const attackingGoalZ = player.team === "home" ? HALF_L : -HALF_L;
      const distanceToGoal = Math.abs(attackingGoalZ - player.position.z);
      const central = Math.abs(player.position.x) < 16;
      const shootChance = distanceToGoal < 24 && central;
      if (player.cooldown <= 0) {
        if (shootChance && player.stats.shooting + rand(0, 40) > 86) {
          shootBall(player);
          player.cooldown = 1.4;
        } else {
          const bestMate = chooseAiPassTarget(player);
          if (bestMate && (nearestOpponentDistance(player) < 5.4 || rand(0, 1) < 0.015)) {
            passBall(player);
            player.cooldown = 1.1;
          }
        }
      }
    } else if (isTeamInPossession) {
      const supportDirection = team.attackingDirection;
      target = shapeTarget.clone();
      if (player.role === "FWD" || player.role === "MID") {
        target.z += supportDirection * rand(3, 8);
        target.x += rand(-4, 4);
      }
      player.intent = "support";
    } else {
      const nearest = findNearestPlayer(player.team, ballOwner.position, true);
      if (nearest === player || player.position.distanceTo(ballOwner.position) < 8.5) {
        target = ballOwner.position.clone();
        sprint = true;
        player.intent = "chase";
        if (player.cooldown <= 0 && player.position.distanceTo(ballOwner.position) < 2.7) {
          tackle(player);
          player.cooldown = 0.9;
        }
      } else {
        player.intent = "return";
      }
    }

    const direction = target.sub(player.position);
    if (direction.length() > 1.1) {
      updatePlayerMovement(player, direction, sprint, dt);
    } else {
      updatePlayerMovement(player, new THREE.Vector3(), false, dt);
    }
  }
}

function chooseAiPassTarget(player: Player) {
  const teammates = (player.team === "home" ? homePlayers : awayPlayers).filter((p) => p !== player);
  const direction = player.team === "home" ? 1 : -1;
  return teammates
    .map((p) => {
      const progress = (p.position.z - player.position.z) * direction;
      const open = nearestOpponentDistance(p);
      const distance = p.position.distanceTo(player.position);
      const score = progress * 0.7 + open * 0.55 - distance * 0.13 + p.stats.shooting * 0.03;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.p;
}

function updateBall(dt: number) {
  updateBallPhysics({
    ball,
    ballOwner,
    dt,
    bounds: {
      halfWidth: HALF_W,
      halfLength: HALF_L
    },
    ballRadius: BALL_RADIUS,
    goalWidth: GOAL_WIDTH,
    playerForward,
    onGoal: scoreGoal
  });
}

function scoreGoal(team: TeamId) {
  addScoreGoal(matchState, team);
  const scorer = lastTouch?.team === team ? lastTouch.short : team === "home" ? "Real Madrid" : "Manchester City";
  const goalText = `GOAL! ${scorer} makes it ${compactScoreText(matchState)}.`;
  addMatchEvent(matchState, "goal", goalText);
  addFeed(goalText);
  updateHud();
  setTimeout(() => resetMatch(true), 900);
}

function resolvePossession() {
  const resolution = resolvePossessionSystem({
    players,
    homePlayers,
    awayPlayers,
    activePlayer,
    ballOwner,
    ballPosition: ball.position,
    random: rand
  });

  if (!resolution) {
    return;
  }

  attachBallTo(resolution.owner as Player);
  if (resolution.feedText) {
    addFeed(resolution.feedText);
  }
  if (resolution.shouldControlOwner) {
    setActivePlayer(resolution.owner as Player);
  }
}

function getInputDirection() {
  const dir = new THREE.Vector3();
  if (keyState.has("KeyW") || keyState.has("ArrowUp")) {
    dir.z += 1;
  }
  if (keyState.has("KeyS") || keyState.has("ArrowDown")) {
    dir.z -= 1;
  }
  if (keyState.has("KeyA") || keyState.has("ArrowLeft")) {
    dir.x -= 1;
  }
  if (keyState.has("KeyD") || keyState.has("ArrowRight")) {
    dir.x += 1;
  }

  if (mobileInput.active) {
    dir.x += mobileInput.x;
    dir.z += mobileInput.y;
  }

  if (matchState.cameraMode === "broadcast") {
    return dir;
  }

  const cameraForward = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  cameraForward.y = 0;
  cameraForward.normalize();
  const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
  const transformed = cameraForward.multiplyScalar(dir.z).add(cameraRight.multiplyScalar(dir.x));
  return transformed;
}

function handleActions() {
  const wantsPass = keyState.has("KeyJ") || mobileInput.pass;
  const wantsShoot = keyState.has("KeyK") || mobileInput.shoot;
  const wantsTackle = keyState.has("KeyL") || mobileInput.tackle;
  const wantsSwitch = keyState.has("Tab");
  const wantsCamera = keyState.has("KeyC");
  const wantsRestart = keyState.has("KeyR");

  if (wantsPass && !passLatch) {
    passBall(activePlayer);
  }
  if (wantsShoot && !shootLatch) {
    shootBall(activePlayer);
  }
  if (wantsTackle && !tackleLatch) {
    tackle(activePlayer);
  }
  if (wantsSwitch && !switchLatch) {
    switchToNearestHome();
  }
  if (wantsCamera && !cameraLatch) {
    const nextCameraMode = switchCameraMode(matchState);
    cameraChip.textContent = nextCameraMode === "broadcast" ? "Broadcast Cam" : "Follow Cam";
    addMatchEvent(matchState, "camera", `Camera switched to ${nextCameraMode}.`);
    addFeed(`Camera switched to ${nextCameraMode}.`);
  }
  if (wantsRestart && !restartLatch) {
    resetMatch(false);
  }

  passLatch = wantsPass;
  shootLatch = wantsShoot;
  tackleLatch = wantsTackle;
  switchLatch = wantsSwitch;
  cameraLatch = wantsCamera;
  restartLatch = wantsRestart;
  mobileInput.pass = false;
  mobileInput.shoot = false;
  mobileInput.tackle = false;
}

function updateCamera(dt: number) {
  if (matchState.cameraMode === "broadcast") {
    const targetX = clamp(ball.position.x * 0.28, -16, 16);
    const targetZ = clamp(ball.position.z * 0.42, -28, 28);
    const desired = new THREE.Vector3(targetX, 92, targetZ - 38);
    camera.position.lerp(desired, clamp(dt * 2.2, 0, 1));
    const look = new THREE.Vector3(ball.position.x * 0.35, 0, ball.position.z * 0.48 + 12);
    camera.lookAt(look);
  } else {
    const forward = playerForward(activePlayer);
    const desired = activePlayer.position
      .clone()
      .add(forward.clone().multiplyScalar(-11))
      .add(new THREE.Vector3(0, 7.2, 0));
    camera.position.lerp(desired, clamp(dt * 7, 0, 1));
    const look = activePlayer.position.clone().add(forward.multiplyScalar(8));
    look.y = 1.8;
    camera.lookAt(look);
  }
}

function updateHud() {
  scoreEl.textContent = scoreText(matchState);
  cameraChip.textContent = matchState.cameraMode === "broadcast" ? "Broadcast Cam" : "Follow Cam";
  clockEl.textContent = clockText(matchState);
  possessionChip.textContent = ballOwner
    ? `${ballOwner.team === "home" ? "RMA" : "MCI"} possession`
    : "Loose ball";
  playerNameEl.textContent = activePlayer.name;
  playerRoleEl.textContent = `${activePlayer.role}  #${activePlayer.number}`;
  playerStatusEl.textContent = ballOwner === activePlayer ? "On ball" : activePlayer.intent;
  staminaEl.style.width = `${Math.round(activePlayer.stamina * 100)}%`;
}

function updateMinimap() {
  minimapEl.innerHTML = "";
  const toMini = (pos: THREE.Vector3) => ({
    x: ((pos.x + HALF_W) / FIELD_WIDTH) * 100,
    y: ((HALF_L - pos.z) / FIELD_LENGTH) * 100
  });

  for (const player of players) {
    const dot = document.createElement("span");
    dot.className = `mini-dot ${player.team}${player === activePlayer ? " active" : ""}`;
    const mini = toMini(player.position);
    dot.style.left = `${mini.x}%`;
    dot.style.top = `${mini.y}%`;
    minimapEl.append(dot);
  }

  const b = document.createElement("span");
  b.className = "mini-ball";
  const miniBall = toMini(ball.position);
  b.style.left = `${miniBall.x}%`;
  b.style.top = `${miniBall.y}%`;
  minimapEl.append(b);
}

function endMatch() {
  setFullTime(matchState);
  addMatchEvent(matchState, "fullTime", "Full time.");
  resultScoreEl.textContent = `Real Madrid ${scoreText(matchState)} Man City`;
  matchOverEl.classList.add("visible");
  addFeed("Full time.");
}

function step() {
  const rawDt = Math.min(clock.getDelta(), 0.04);
  const dt = rawDt * GAME_SPEED;

  if (!isMatchEnded(matchState)) {
    advanceMatchClock(matchState, rawDt);
    startMatchIfNeeded(matchState);
    handleActions();
    const input = getInputDirection();
    const sprint = keyState.has("ShiftLeft") || keyState.has("ShiftRight") || mobileInput.sprint;
    updatePlayerMovement(activePlayer, input, sprint, dt);
    updateAI(dt);
    updateBall(dt);
    resolvePossession();
    separatePlayers();
    updateCamera(rawDt);
    updateHud();
    updateMinimap();

    if (isMatchClockExpired(matchState)) {
      endMatch();
    }
  } else {
    updateCamera(rawDt);
  }

  renderer.render(scene, camera);
  updateRenderDebug();
  requestAnimationFrame(step);
}

function updateRenderDebug() {
  const now = performance.now();
  if (now - lastRenderDebugAt < 500) {
    return;
  }
  lastRenderDebugAt = now;
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const points = [
    [Math.floor(width * 0.22), Math.floor(height * 0.42)],
    [Math.floor(width * 0.5), Math.floor(height * 0.5)],
    [Math.floor(width * 0.78), Math.floor(height * 0.58)],
    [Math.floor(width * 0.5), Math.floor(height * 0.74)],
    [Math.floor(width * 0.5), Math.floor(height * 0.18)]
  ];
  const samples = points.map(([x, y]) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
  });
  renderDebugEl.textContent = JSON.stringify({
    width,
    height,
    samples,
    nonDarkSamples: samples.filter(([r, g, b]) => r + g + b > 54).length,
    players: players.length,
    score: compactScoreText(matchState),
    matchStatus: matchState.status,
    ballOwner: ballOwner?.short ?? "Loose",
    cameraMode: matchState.cameraMode
  });
  if (lastFrameCaptureAt === 0 || now - lastFrameCaptureAt > 2000) {
    lastFrameCaptureAt = now;
    renderDebugEl.dataset.frame = renderer.domElement.toDataURL("image/jpeg", 0.76);
  }
}

function separatePlayers() {
  separatePlayerCollisions({
    players,
    activePlayer,
    playerRadius: PLAYER_RADIUS
  });
}

function setupInput() {
  canvas.focus();
  window.addEventListener("keydown", (event) => {
    if (["Tab", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
    keyState.add(event.code);
  });
  window.addEventListener("keyup", (event) => {
    keyState.delete(event.code);
  });
  canvas.addEventListener("pointerdown", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(homePlayers.map((p) => p.body));
    if (hits[0]) {
      const found = homePlayers.find((p) => p.body === hits[0].object);
      if (found) {
        setActivePlayer(found);
      }
    }
  });

  stickEl.addEventListener("pointerdown", (event) => {
    mobileInput.active = true;
    mobileInput.id = event.pointerId;
    mobileInput.baseX = event.clientX;
    mobileInput.baseY = event.clientY;
    stickEl.setPointerCapture(event.pointerId);
  });
  stickEl.addEventListener("pointermove", (event) => {
    if (!mobileInput.active || mobileInput.id !== event.pointerId) {
      return;
    }
    const dx = clamp((event.clientX - mobileInput.baseX) / 42, -1, 1);
    const dy = clamp((mobileInput.baseY - event.clientY) / 42, -1, 1);
    mobileInput.x = dx;
    mobileInput.y = dy;
  });
  const endStick = (event: PointerEvent) => {
    if (mobileInput.id === event.pointerId) {
      mobileInput.active = false;
      mobileInput.id = -1;
      mobileInput.x = 0;
      mobileInput.y = 0;
    }
  };
  stickEl.addEventListener("pointerup", endStick);
  stickEl.addEventListener("pointercancel", endStick);

  document.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const action = button.dataset.action;
      if (action === "pass") {
        mobileInput.pass = true;
      } else if (action === "shoot") {
        mobileInput.shoot = true;
      } else if (action === "tackle") {
        mobileInput.tackle = true;
      } else if (action === "sprint") {
        mobileInput.sprint = true;
      }
    });
    button.addEventListener("pointerup", () => {
      if (button.dataset.action === "sprint") {
        mobileInput.sprint = false;
      }
    });
    button.addEventListener("pointercancel", () => {
      if (button.dataset.action === "sprint") {
        mobileInput.sprint = false;
      }
    });
  });

  restartButton.addEventListener("click", () => resetMatch(false));
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", onResize);

addPitch();
setupPlayers();
scene.add(ball.mesh);
setupInput();
resetMatch(false);
step();
