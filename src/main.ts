import * as THREE from "three";
import {
  addMatchEvent,
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
import { kickBall, updateBallPhysics } from "./core/systems/BallSystem";
import { separatePlayers as separatePlayerCollisions } from "./core/systems/CollisionSystem";
import { DEFAULT_MOVEMENT_CONFIG, updatePlayerMovement as updateMovementSystem } from "./core/systems/MovementSystem";
import type { MovementResult } from "./core/systems/MovementSystem";
import { resolvePossession as resolvePossessionSystem } from "./core/systems/PossessionSystem";
import type { SimPlayer } from "./core/systems/types";
import { SeededRandom } from "./core/random";
import { stateHash } from "./core/debug/stateHash";
import { FixedTimestep } from "./core/simulation/FixedTimestep";
import { MatchRuleSystem } from "./core/systems/MatchRuleSystem";
import { CameraSystem } from "./core/systems/CameraSystem";
import { FootballAISystem } from "./core/systems/AISystem";
import { getAIDifficulty } from "./core/systems/AIDifficulty";
import type { AIDifficultyLevel } from "./core/systems/AIDifficulty";
import { DribblingSystem } from "./core/systems/DribblingSystem";
import type { DribblingResult } from "./core/systems/DribblingSystem";
import { FirstTouchSystem } from "./core/systems/FirstTouchSystem";
import type { FirstTouchResult } from "./core/systems/FirstTouchSystem";
import { executePass } from "./core/systems/PassingSystem";
import type { PassFeedbackEvent, PassPlan } from "./core/systems/PassingSystem";
import { executeShot } from "./core/systems/ShootingSystem";
import type { ShotFeedbackEvent, ShotPlan } from "./core/systems/ShootingSystem";
import { GoalkeeperSystem, isBallApproachingGoal } from "./core/systems/GoalkeeperSystem";
import type { KeeperBrainSnapshot, KeeperDistributionChoice, KeeperReactionAction, KeeperSaveResult } from "./core/systems/GoalkeeperSystem";
import { KeyboardInput } from "./core/input/KeyboardInput";
import { TouchInput } from "./core/input/TouchInput";
import { MatchController } from "./core/input/MatchController";
import { HudController } from "./rendering/HudController";
import { MinimapController } from "./rendering/MinimapController";
import { addPitch as addWorldPitch, createBallVisual, createPlayerVisual } from "./rendering/WorldFactory";
import { createGameScene } from "./rendering/SceneFactory";
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
        phase3: ReturnType<typeof phase3DebugState>;
        phase2: {
          movement: { speed: number; maxSpeed: number; sprinting: boolean; stamina: number } | null;
          dribbling: { touchQuality: number; looseTouchRisk: number; looseTouch: boolean } | null;
          firstTouch: { touchQuality: number; retained: boolean; incomingSpeed: number } | null;
          pass: { targetId: string; strength: number; distance: number; interceptionRisk: number } | null;
          shot: { shotType: string; power: number; accuracy: number; pressure: number; targetSide: string } | null;
          keeper: { action: KeeperReactionAction; outcome: string; probability: number } | null;
          camera: { emphasis: number };
          feedback: { type: string; kind: string; effect: string } | null;
        };
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

const randomSource = new SeededRandom(0xdecafbad);
const rand = (min: number, max: number) => randomSource.range(min, max);

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
          <div class="chip" data-action-chip>Ready</div>
        </div>
        <div class="feed" data-feed></div>
      </div>
      <div class="minimap" data-minimap></div>
      <div class="ai-settings" data-ai-settings>
        <label>Difficulty <select data-ai-difficulty aria-label="AI difficulty"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label><input type="checkbox" data-ai-debug> AI debug</label>
        <label><input type="checkbox" data-ai-spectator> Watch AI vs AI</label>
        <button type="button" data-ai-restart>Restart</button>
      </div>
      <pre class="ai-debug-panel" data-ai-debug-panel hidden aria-label="AI decision details"></pre>
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
          <div class="key">K Power • Shift+K Finesse</div>
          <div class="key">L Tackle</div>
          <div class="key">Tab Switch</div>
          <div class="key">C Camera</div>
          <div class="key">R Reset</div>
          <div class="key">Space Pause</div>
        </div>
      </div>
      <div class="mobile-pad">
        <div class="stick" data-stick></div>
        <div class="button-cluster" aria-label="Touch actions. Hold sprint while shooting for finesse.">
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
const actionChip = document.querySelector<HTMLElement>("[data-action-chip]")!;
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
const aiSettings = document.querySelector<HTMLDivElement>("[data-ai-settings]")!;
const difficultySelect = document.querySelector<HTMLSelectElement>("[data-ai-difficulty]")!;
const aiDebugToggle = document.querySelector<HTMLInputElement>("[data-ai-debug]")!;
const spectatorToggle = document.querySelector<HTMLInputElement>("[data-ai-spectator]")!;
const aiDebugPanel = document.querySelector<HTMLPreElement>("[data-ai-debug-panel]")!;
const hudController = new HudController({ score: scoreEl, clock: clockEl, camera: cameraChip, possession: possessionChip, playerName: playerNameEl, playerRole: playerRoleEl, playerStatus: playerStatusEl, stamina: staminaEl });
const minimapController = new MinimapController(minimapEl, { halfWidth: HALF_W, halfLength: HALF_L });

const { renderer, scene, camera } = createGameScene(canvas);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let players: Player[] = [];
let homePlayers: Player[] = [];
let awayPlayers: Player[] = [];
let activePlayer: Player;
let ballOwner: Player | null = null;
let lastTouch: Player | null = null;
let attackingTeam: TeamId = "home";
const matchState = createInitialMatchState(MATCH_DURATION);
const matchRules = new MatchRuleSystem(matchState);
const fixedTimestep = new FixedTimestep({ step: 1 / 60, maxSteps: 8 });
const movementConfig = DEFAULT_MOVEMENT_CONFIG;
const dribblingSystem = new DribblingSystem();
const firstTouchSystem = new FirstTouchSystem();
let goalkeeperSystem = new GoalkeeperSystem();
const footballAI = new FootballAISystem();
let aiDifficulty: AIDifficultyLevel = "normal";
let spectatorMode = false;
const keeperBrains = new Map<string, KeeperBrainSnapshot>();
const keeperDistributions = new Map<string, { choice: KeeperDistributionChoice; remaining: number }>();
type TeamMatchTelemetry = { passes: number; completedPasses: number; shots: number; goals: number; clearances: number };
const emptyTeamTelemetry = (): TeamMatchTelemetry => ({ passes: 0, completedPasses: 0, shots: 0, goals: 0, clearances: 0 });
let matchTelemetry = { home: emptyTeamTelemetry(), away: emptyTeamTelemetry() };
let pendingPass: { passerId: string; team: TeamId; targetId: string } | null = null;
let releaseLock: { playerId: string; remaining: number } | null = null;
const cameraSystem = new CameraSystem();

let lastMovementResult: MovementResult | null = null;
let lastDribblingResult: DribblingResult | null = null;
let lastFirstTouchResult: FirstTouchResult | null = null;
let lastPassPlan: PassPlan | null = null;
let lastShotPlan: ShotPlan | null = null;
let lastKeeperResult: KeeperSaveResult | null = null;
let lastFeedback: PassFeedbackEvent | ShotFeedbackEvent | null = null;
let pendingShot: { plan: ShotPlan; defendingTeam: TeamId; keeperAttempted?: boolean } | null = null;
let lastCameraEmphasis = 0;
let lastRenderDebugAt = 0;
let lastFrameCaptureAt = 0;
let goalResetTimer: ReturnType<typeof setTimeout> | null = null;
let keyboardInput = new KeyboardInput();
let touchInput: TouchInput | undefined;
const matchController = new MatchController({
  pass: () => passBall(activePlayer),
  shoot: () => shootBall(activePlayer, isFinesseShotRequested() ? "finesse" : "power"),
  tackle: () => tackle(activePlayer),
  switchPlayer: () => switchToNearestHome(),
  switchCamera: () => {
    const nextCameraMode = switchCameraMode(matchState);
    cameraChip.textContent = nextCameraMode === "broadcast" ? "Broadcast Cam" : "Follow Cam";
    addMatchEvent(matchState, "camera", `Camera switched to ${nextCameraMode}.`);
    addFeed(`Camera switched to ${nextCameraMode}.`);
  },
  restart: () => resetMatch(false),
  pause: () => setMatchStatus(matchState, matchState.status === "paused" ? "playing" : "paused")
});

const ball = {
  mesh: createBallVisual(BALL_RADIUS),
  position: new THREE.Vector3(0, BALL_RADIUS, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  spin: new THREE.Vector3(0, 0, 0)
};

function createPlayer(team: TeamData, spec: PlayerData): Player {
  const { group, body, marker, label } = createPlayerVisual(team, spec);
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

function setupPlayers() {
  homePlayers = realMadrid.players.map((spec) => createPlayer(realMadrid, spec));
  awayPlayers = manCity.players.map((spec) => createPlayer(manCity, spec));
  players = [...homePlayers, ...awayPlayers];
  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  activePlayer.marker.material.opacity = spectatorMode ? 0 : 0.92;
  activePlayer.marker.scale.setScalar(1.16);
}

function resetMatch(keepScore = false) {
  if (goalResetTimer) { clearTimeout(goalResetTimer); goalResetTimer = null; }
  cameraSystem.clearGoalEmphasis();
  if (!keepScore) {
    resetMatchState(matchState);
    matchTelemetry = { home: emptyTeamTelemetry(), away: emptyTeamTelemetry() };
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
    player.stamina = keepScore ? Math.min(1, player.stamina + 0.18) : 1;
    player.marker.material.opacity = player === activePlayer ? 0.92 : 0;
  });

  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  setActivePlayer(activePlayer);
  ball.position.set(0, BALL_RADIUS, 0);
  ball.velocity.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
  ball.mesh.position.copy(ball.position);
  ballOwner = null;
  setBallOwnerId(matchState, null);
  lastTouch = null;
  attackingTeam = "home";
  pendingShot = null;
  pendingPass = null;
  releaseLock = null;
  footballAI.reset();
  keeperBrains.clear();
  keeperDistributions.clear();
  lastMovementResult = null;
  lastDribblingResult = null;
  lastFirstTouchResult = null;
  lastPassPlan = null;
  lastShotPlan = null;
  lastKeeperResult = null;
  lastFeedback = null;
  lastCameraEmphasis = 0;
  actionChip.textContent = "Ready";
  matchRules.resetGoalLock();
  addMatchEvent(matchState, "restart", "Kickoff at the Bernabeu-inspired arena.");
  addFeed("Kickoff at the Bernabeu-inspired arena.");
  updateHud();
}

function setActivePlayer(player: Player) {
  activePlayer.marker.material.opacity = 0;
  activePlayer.marker.scale.setScalar(1);
  activePlayer = player;
  setActivePlayerId(matchState, player.id);
  activePlayer.marker.material.opacity = spectatorMode ? 0 : 0.92;
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
  pendingShot = null;
  if (pendingPass) {
    if (player.team === pendingPass.team && player.id !== pendingPass.passerId) {
      matchTelemetry[player.team].completedPasses += 1;
    }
    pendingPass = null;
  }
  releaseLock = null;
  if (ballOwner && ballOwner !== player) {
    ballOwner.hasBall = false;
  }
  ballOwner = player;
  setBallOwnerId(matchState, player.id);
  lastTouch = player;
  player.hasBall = true;
  attackingTeam = player.team;
  ball.velocity.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
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

function passBall(player: Player, intendedTarget?: Player) {
  if (ballOwner !== player) {
    return;
  }
  const teammates = (player.team === "home" ? homePlayers : awayPlayers).filter((p) => p !== player);
  const opponents = player.team === "home" ? awayPlayers : homePlayers;
  const plan = executePass({
    passer: player,
    teammates,
    opponents,
    ball,
    intendedTarget,
    desiredDirection: playerForward(player),
    random: rand
  });
  if (!plan) {
    return;
  }
  releaseBall();
  releaseLock = { playerId: player.id, remaining: 0.22 };
  pendingPass = { passerId: player.id, team: player.team, targetId: plan.target.id };
  matchTelemetry[player.team].passes += 1;
  pendingShot = null;
  lastPassPlan = plan;
  lastFeedback = plan.feedback;
  actionChip.textContent = plan.interception.interceptable
    ? `Pass risk ${Math.round(plan.feedback.interceptionRisk * 100)}%`
    : `Pass to ${plan.target.short}`;
  addMatchEvent(matchState, "pass", `${player.short} passes toward ${plan.target.short}.`);
  addFeed(`${player.short} threads a ${plan.interception.interceptable ? "risky " : "clean "}pass toward ${plan.target.short}.`);
}

function shootBall(player: Player, shotType: "power" | "finesse" = "power") {
  if (ballOwner !== player) {
    return;
  }
  const defendingTeam: TeamId = player.team === "home" ? "away" : "home";
  const opponents = player.team === "home" ? awayPlayers : homePlayers;
  const goalkeeper = opponents.find((candidate) => candidate.role === "GK") ?? null;
  const targetZ = player.team === "home" ? HALF_L + 1.4 : -HALF_L - 1.4;
  const plan = executeShot({
    shooter: player,
    opponents,
    goalkeeper,
    ball,
    goal: {
      center: new THREE.Vector3(0, 2, targetZ),
      width: GOAL_WIDTH,
      height: 4
    },
    shotType,
    random: rand
  });
  if (!plan) {
    return;
  }
  releaseBall();
  releaseLock = { playerId: player.id, remaining: 0.22 };
  pendingPass = null;
  matchTelemetry[player.team].shots += 1;
  lastShotPlan = plan;
  pendingShot = { plan, defendingTeam };
  lastFeedback = plan.feedback;
  actionChip.textContent = `${shotType === "power" ? "Power" : "Finesse"} ${Math.round(plan.accuracy * 100)}%`;
  addMatchEvent(matchState, "shot", `${player.short} takes a ${shotType} shot.`);
  addFeed(`${player.short} hits a ${shotType} shot toward the ${plan.selectedTarget.side} side.`);
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
      pendingShot = null;
      ball.velocity.copy(knock);
      ball.spin.set(0, 0, 0);
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
  const result = updateMovementSystem({
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
    hasBall: ballOwner === player,
    config: movementConfig
  });
  if (player === activePlayer) {
    lastMovementResult = result;
  }
  return result;
}

function updateAI(dt: number) {
  footballAI.update({
    players,
    goalkeepersManagedExternally: true,
    ball,
    ballOwner,
    activePlayer: spectatorMode ? null : activePlayer,
    teams: { home: realMadrid, away: manCity },
    bounds: { halfWidth: HALF_W, halfLength: HALF_L },
    playerRadius: PLAYER_RADIUS,
    dt,
    random: rand,
    onPass: (player, target) => passBall(player as Player, target as Player | undefined),
    onShoot: (player) => shootBall(player as Player),
    onClear: (player) => clearBall(player as Player),
    onTackle: (player) => tackle(player as Player)
  });
  updateGoalkeepers(dt);
}

function clearBall(player: Player) {
  if (ballOwner !== player) return;
  const direction = player.team === "home" ? 1 : -1;
  const target = player.position.clone().add(new THREE.Vector3(rand(-14, 14), 2.5, direction * 34));
  releaseBall();
  releaseLock = { playerId: player.id, remaining: 0.22 };
  pendingPass = null;
  pendingShot = null;
  kickBall(ball, target, 30, 2.8);
  lastFeedback = null;
  matchTelemetry[player.team].clearances += 1;
  actionChip.textContent = "Clearance into space";
  addMatchEvent(matchState, "pass", `${player.short} clears under pressure.`);
  addFeed(`${player.short} clears into space.`);
}

function updateGoalkeepers(dt: number) {
  for (const keeper of [...homePlayers, ...awayPlayers].filter((player) => player.role === "GK")) {
    const positioning = goalkeeperSystem.getPositioning({ keeper, ball, bounds: { halfWidth: HALF_W, halfLength: HALF_L } });
    goalkeeperSystem.updateMovement({
      keeper,
      ball,
      bounds: { halfWidth: HALF_W, halfLength: HALF_L },
      dt,
      playerRadius: PLAYER_RADIUS
    });
    if (ballOwner !== keeper) {
      keeperDistributions.delete(keeper.id);
      const previousReaction = keeperBrains.get(keeper.id)?.reaction;
      keeperBrains.set(keeper.id, { ...goalkeeperSystem.createDebugSnapshot(keeper, { positioning }), reaction: previousReaction });
      keeper.cooldown = Math.max(0, keeper.cooldown - dt);
      continue;
    }

    const teammates = keeper.team === "home" ? homePlayers : awayPlayers;
    const opponents = keeper.team === "home" ? awayPlayers : homePlayers;
    let distributionState = keeperDistributions.get(keeper.id);
    if (!distributionState) {
      const choice = goalkeeperSystem.chooseDistribution(keeper, teammates, opponents);
      distributionState = { choice, remaining: choice.releaseDelay };
      keeperDistributions.set(keeper.id, distributionState);
    }
    distributionState.remaining -= dt;
    keeperBrains.set(keeper.id, goalkeeperSystem.createDebugSnapshot(keeper, { positioning, distribution: distributionState.choice }));
    if (distributionState.remaining > 0) continue;
    // Re-scan once the scan delay expires, because opponents may have closed a lane.
    const distribution = goalkeeperSystem.chooseDistribution(keeper, teammates, opponents);
    keeperBrains.set(keeper.id, goalkeeperSystem.createDebugSnapshot(keeper, { positioning, distribution }));
    keeperDistributions.delete(keeper.id);
    if (distribution.target) {
      passBall(keeper, distribution.target as Player);
    } else {
      clearBall(keeper);
    }
    keeper.cooldown = 1.2;
  }
}

function updateBall(dt: number) {
  const owner = ballOwner;
  if (owner) {
    lastDribblingResult = dribblingSystem.update({
      player: owner,
      ball,
      dt,
      sprint: owner === activePlayer && !spectatorMode
        ? keyboardInput.getState().sprint || Boolean(touchInput?.getState().sprint)
        : owner.velocity.length() > 8.8,
      playerForward,
      random: () => rand(0, 1)
    });
    if (lastDribblingResult.shouldReleaseBall) {
      releaseBall();
      pendingShot = null;
      actionChip.textContent = "Heavy touch";
      addMatchEvent(matchState, "possession", `${owner.short} takes a heavy touch.`);
      addFeed(`${owner.short} loses a little control at speed.`);
    }
  }

  // Dribbling owns the attached-ball position. Running BallSystem's owner
  // branch afterwards would overwrite its stat-scaled touch point, so physics
  // is only advanced once the ball is loose.
  if (!ballOwner) {
    updateBallPhysics({
      ball,
      ballOwner: null,
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
}

function scoreGoal(team: TeamId) {
  if (pendingShot && pendingShot.plan.shooter.team !== team) {
    pendingShot = null;
  }
  if (pendingShot && resolveGoalkeeperSave(team)) {
    return;
  }
  const scorer = lastTouch?.team === team ? lastTouch.short : team === "home" ? "Real Madrid" : "Manchester City";
  if (!matchRules.scoreGoal(team, () => `GOAL! ${scorer} makes it ${compactScoreText(matchState)}.`)) return;
  matchTelemetry[team].goals += 1;
  pendingPass = null;
  const goalText = matchState.events[0]?.description ?? `GOAL! ${scorer} makes it ${compactScoreText(matchState)}.`;
  pendingShot = null;
  cameraSystem.goalEmphasis(ball.position.clone());
  addFeed(goalText);
  updateHud();
  goalResetTimer = setTimeout(() => { goalResetTimer = null; resetMatch(true); }, 900);
}

function resolveGoalkeeperSave(scoringTeam: TeamId) {
  const pending = pendingShot;
  if (!pending || pending.keeperAttempted || pending.plan.shooter.team !== scoringTeam) {
    return false;
  }
  const keeper = (pending.defendingTeam === "home" ? homePlayers : awayPlayers)
    .find((player) => player.role === "GK");
  if (!keeper) {
    pendingShot = null;
    return false;
  }

  const plan = pending.plan;
  const quality = clamp(
    plan.power / 54 * 0.58 + plan.accuracy * 0.42,
    0,
    1
  );
  lastKeeperResult = goalkeeperSystem.resolveShot(keeper, {
    origin: plan.origin,
    target: plan.target,
    velocity: plan.trajectory.velocity,
    power: plan.power,
    quality,
    shooter: plan.shooter
  }, rand);
  keeperBrains.set(keeper.id, goalkeeperSystem.createDebugSnapshot(keeper, { reaction: lastKeeperResult.plan }));
  pending.keeperAttempted = true;

  if (lastKeeperResult.outcome === "goal") {
    return false;
  }
  pendingShot = null;

  const awayFromGoal = pending.defendingTeam === "home" ? 1 : -1;
  ball.position.copy(keeper.position).add(new THREE.Vector3(0, BALL_RADIUS, awayFromGoal * 0.8));
  ball.mesh.position.copy(ball.position);
  if (lastKeeperResult.outcome === "save") {
    attachBallTo(keeper);
    actionChip.textContent = "Keeper save";
    addMatchEvent(matchState, "shot", `${keeper.short} claims the shot.`);
    addFeed(`${keeper.short} makes the save.`);
  } else {
    releaseBall();
    ball.velocity.set(rand(-3.5, 3.5), 3.2, awayFromGoal * 8.5);
    ball.spin.set(0, 0, 0);
    actionChip.textContent = "Keeper parry";
    addMatchEvent(matchState, "shot", `${keeper.short} parries the shot.`);
    addFeed(`${keeper.short} parries it away.`);
  }
  return true;
}

function resolvePossession() {
  if (pendingShot && !isBallApproachingGoal(ball, pendingShot.defendingTeam)) pendingShot = null;
  // Incoming shots use the keeper's reaction/save model once, never the
  // generic loose-ball claim. A beaten keeper cannot re-roll at the goal line.
  if (pendingShot) {
    const keeper = players.find((player) => player.role === "GK" && player.team === pendingShot?.defendingTeam);
    if (keeper && ball.position.y < 4.8 && keeper.position.distanceTo(ball.position) < 3.8) {
      if (resolveGoalkeeperSave(pendingShot.plan.shooter.team)) return;
    }
  }
  const resolution = resolvePossessionSystem({
    players,
    homePlayers,
    awayPlayers,
    activePlayer,
    ballOwner,
    ballPosition: ball.position,
    random: rand,
    excludedPlayerIds: [
      ...(releaseLock ? [releaseLock.playerId] : []),
      ...(pendingShot ? players.filter((player) => player.role === "GK").map((player) => player.id) : [])
    ]
  });

  if (!resolution) {
    return;
  }

  const owner = resolution.owner as Player;
  if (!ballOwner) {
    lastFirstTouchResult = firstTouchSystem.update({
      player: owner,
      ball,
      incomingVelocity: ball.velocity,
      controlDirection: playerForward(owner),
      random: () => rand(0, 1)
    });
    if (lastFirstTouchResult.shouldReleaseBall) {
      pendingShot = null;
      actionChip.textContent = "Heavy first touch";
      addMatchEvent(matchState, "possession", `${owner.short} cannot settle the ball.`);
      addFeed(`${owner.short} cannot settle the ball cleanly.`);
      return;
    }
  }

  pendingShot = null;
  attachBallTo(owner);
  if (resolution.feedText) {
    addFeed(resolution.feedText);
  }
  if (resolution.shouldControlOwner && !spectatorMode) {
    setActivePlayer(owner);
  }
}

function getInputDirection() {
  const dir = keyboardInput.getState().direction;
  const touchDirection = touchInput?.getState().direction;
  if (touchDirection) dir.add(touchDirection);

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
  const actions = [...keyboardInput.consumeActions(), ...(touchInput?.consumeActions() ?? [])];
  matchController.dispatch(spectatorMode ? actions.filter((action) => ["switchCamera", "restart", "pause"].includes(action.type)) : actions);
}

function updateCamera(dt: number) {
  const result = cameraSystem.update(camera, matchState.cameraMode, ball, activePlayer, playerForward, dt);
  lastCameraEmphasis = result.emphasis;
}

function isFinesseShotRequested() {
  return keyboardInput.getState().sprint || Boolean(touchInput?.getState().sprint);
}

function updateHud() {
  hudController.update(matchState, activePlayer, ballOwner);
}

function updateMinimap() {
  minimapController.update(players, ball, activePlayer);
}

function endMatch() {
  setFullTime(matchState);
  addMatchEvent(matchState, "fullTime", "Full time.");
  resultScoreEl.textContent = `Real Madrid ${scoreText(matchState)} Man City`;
  matchOverEl.classList.add("visible");
  addFeed("Full time.");
}

function phase2DebugState() {
  return {
    movement: lastMovementResult ? {
      speed: lastMovementResult.speed,
      maxSpeed: lastMovementResult.maxSpeed,
      sprinting: lastMovementResult.sprinting,
      stamina: lastMovementResult.staminaAfter
    } : null,
    dribbling: lastDribblingResult ? {
      touchQuality: lastDribblingResult.touchQuality,
      looseTouchRisk: lastDribblingResult.looseTouchRisk,
      looseTouch: lastDribblingResult.looseTouch
    } : null,
    firstTouch: lastFirstTouchResult ? {
      touchQuality: lastFirstTouchResult.touchQuality,
      retained: lastFirstTouchResult.retained,
      incomingSpeed: lastFirstTouchResult.incomingSpeed
    } : null,
    pass: lastPassPlan ? {
      targetId: lastPassPlan.target.id,
      strength: lastPassPlan.strength,
      distance: lastPassPlan.distance,
      interceptionRisk: lastPassPlan.feedback.interceptionRisk
    } : null,
    shot: lastShotPlan ? {
      shotType: lastShotPlan.shotType,
      power: lastShotPlan.power,
      accuracy: lastShotPlan.accuracy,
      pressure: lastShotPlan.pressure,
      targetSide: lastShotPlan.selectedTarget.side
    } : null,
    keeper: lastKeeperResult ? {
      action: lastKeeperResult.plan.action,
      outcome: lastKeeperResult.outcome,
      probability: lastKeeperResult.probability
    } : null,
    camera: { emphasis: lastCameraEmphasis },
    feedback: lastFeedback ? {
      type: lastFeedback.type,
      kind: lastFeedback.kind,
      effect: lastFeedback.effect
    } : null
  };
}

function phase3DebugState() {
  return {
    ...footballAI.getDebugState(),
    elapsed: matchState.elapsed,
    spectator: spectatorMode,
    debugEnabled: aiDebugToggle.checked,
    difficultyConfig: getAIDifficulty(aiDifficulty),
    keepers: [...keeperBrains.values()],
    telemetry: matchTelemetry
  };
}

function updateAIDebugPanel() {
  aiDebugPanel.hidden = !aiDebugToggle.checked;
  if (aiDebugPanel.hidden) return;
  const debug = phase3DebugState();
  const decisions = debug.decisions;
  const focused = decisions.find((decision) => decision.playerId === ballOwner?.id) ?? decisions.find((decision) => decision.possession === "opponent") ?? decisions[0];
  const teamLine = (team: TeamId) => {
    const t = matchTelemetry[team];
    return `${team.toUpperCase()}: passes ${t.completedPasses}/${t.passes} | shots ${t.shots} | goals ${t.goals}`;
  };
  const spatial = debug.spatial;
  aiDebugPanel.textContent = [
    `${aiDifficulty.toUpperCase()} · ${spectatorMode ? "AI vs AI" : "Player vs AI"} · possession ${ballOwner?.team ?? "loose"}`,
    teamLine("home"), teamLine("away"),
    spatial ? `Pressers H/A: ${spatial.home.presserCount}/${spatial.away.presserCount} · Shape H/A: ${spatial.home.shapeScore.toFixed(2)}/${spatial.away.shapeScore.toFixed(2)}` : "Waiting for AI decisions…",
    focused ? `${focused.playerId} → ${focused.action.toUpperCase()} (${focused.status})\n${focused.reason}` : "",
    ...decisions.filter((decision) => decision !== focused).slice(0, 4).map((decision) => `${decision.playerId}: ${decision.action} — ${decision.reason}`),
    ...debug.keepers.map((keeper) => `${keeper.keeperId}: ${keeper.intentLabel}`)
  ].join("\n");
}

function step() {
  const rawDt = Math.min(clock.getDelta(), 0.04);
  fixedTimestep.advance(rawDt, (fixedDt) => {
    const dt = fixedDt * GAME_SPEED;
    if (isMatchEnded(matchState)) return;
    matchRules.updateClock(fixedDt);
    startMatchIfNeeded(matchState);
    handleActions();
    if (matchState.status === "paused" || matchState.status === "goal") return;
    if (releaseLock) {
      releaseLock.remaining -= dt;
      if (releaseLock.remaining <= 0) releaseLock = null;
    }
    const input = getInputDirection();
    const sprint = keyboardInput.getState().sprint || Boolean(touchInput?.getState().sprint);
    if (!spectatorMode) updatePlayerMovement(activePlayer, input, sprint, dt);
    updateAI(dt);
    updateBall(dt);
    resolvePossession();
    separatePlayers();
    if (isMatchClockExpired(matchState)) endMatch();
  });
  updateCamera(rawDt);
  if (!isMatchEnded(matchState)) { updateHud(); updateMinimap(); }

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
  const canvasSample = sampleCanvas();
  updateAIDebugPanel();
  renderDebugEl.textContent = JSON.stringify({
    ...canvasSample,
    players: players.length,
    score: compactScoreText(matchState),
    matchStatus: matchState.status,
    ballOwner: ballOwner?.short ?? "Loose",
    cameraMode: matchState.cameraMode,
    phase2: phase2DebugState(),
    phase3: phase3DebugState(),
    stateHash: stateHash({ elapsed: matchState.elapsed, score: matchState.score, owner: matchState.ballOwnerId, active: matchState.activePlayerId, ball: ball.position.toArray(), velocity: ball.velocity.toArray() })
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
  keyboardInput.attach();
  // Settings use native keyboard semantics. Detach gameplay listeners and
  // discard held keys while a form control owns focus, preventing Space/Tab/R
  // from pausing, switching player, or resetting while selecting difficulty.
  aiSettings.addEventListener("focusin", () => {
    keyboardInput.detach();
    keyboardInput = new KeyboardInput();
  });
  aiSettings.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!aiSettings.contains(document.activeElement)) keyboardInput.attach();
    });
  });
  difficultySelect.addEventListener("change", () => {
    aiDifficulty = difficultySelect.value as AIDifficultyLevel;
    footballAI.setDifficulty(aiDifficulty);
    goalkeeperSystem = new GoalkeeperSystem({
      reactionBase: aiDifficulty === "easy" ? 0.57 : aiDifficulty === "hard" ? 0.32 : 0.42,
      distributionHoldMin: aiDifficulty === "easy" ? 0.65 : aiDifficulty === "hard" ? 0.3 : 0.45,
      distributionHoldMax: aiDifficulty === "easy" ? 1.65 : aiDifficulty === "hard" ? 0.95 : 1.35
    });
    keeperDistributions.clear();
    addFeed(`AI difficulty: ${aiDifficulty}. Movement speed is unchanged.`);
  });
  aiDebugToggle.addEventListener("change", updateAIDebugPanel);
  spectatorToggle.addEventListener("change", () => {
    spectatorMode = spectatorToggle.checked;
    footballAI.reset();
    activePlayer.marker.material.opacity = spectatorMode ? 0 : 0.92;
    addFeed(spectatorMode ? "Watching AI vs AI. Restart for a fresh comparison." : "Player control restored.");
  });
  aiSettings.querySelector<HTMLButtonElement>("[data-ai-restart]")!.addEventListener("click", () => resetMatch(false));
  canvas.addEventListener("pointerdown", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const found = homePlayers.find((player) => raycaster.intersectObject(player.body)[0]);
    if (found && !spectatorMode) setActivePlayer(found);
    canvas.focus();
  });
  touchInput = new TouchInput(stickEl, document.querySelectorAll<HTMLElement>("[data-action]"));
  touchInput.attach();
  restartButton.addEventListener("click", () => resetMatch(false));
}

function sampleCanvas() {
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
  return {
    width,
    height,
    samples,
    nonDarkSamples: samples.filter(([r, g, b]) => r + g + b > 54).length
  };
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", onResize);

addWorldPitch(scene);
setupPlayers();
scene.add(ball.mesh);
setupInput();
window.__eliteKickoffDebug = {
  sampleCanvas,
  state: () => ({
    players: players.length,
    score: compactScoreText(matchState),
    clock: clockEl.textContent ?? "",
    ballOwner: ballOwner?.short ?? "Loose",
    cameraMode: matchState.cameraMode,
    phase2: phase2DebugState(),
    phase3: phase3DebugState()
  })
};
resetMatch(false);
step();
