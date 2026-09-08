import * as THREE from "three";
import {
  addMatchEvent,
  compactScoreText,
  createInitialMatchState,
  isMatchEnded,
  scoreText,
  setActivePlayerId,
  setBallOwnerId,
  switchCameraMode
} from "./core/match/MatchState";
import type { CameraMode } from "./core/match/MatchState";
import { applyBallTrajectory, kickBall, updateBallPhysics } from "./core/systems/BallSystem";
import { separatePlayers as separatePlayerCollisions } from "./core/systems/CollisionSystem";
import { DEFAULT_MOVEMENT_CONFIG, updatePlayerMovement as updateMovementSystem } from "./core/systems/MovementSystem";
import type { MovementResult } from "./core/systems/MovementSystem";
import { resolvePossession as resolvePossessionSystem } from "./core/systems/PossessionSystem";
import type { SimPlayer } from "./core/systems/types";
import { SeededRandom } from "./core/random";
import { stateHash } from "./core/debug/stateHash";
import { FixedTimestep } from "./core/simulation/FixedTimestep";
import { MatchRuleSystem } from "./core/systems/MatchRuleSystem";
import { MatchFlowSystem } from "./core/systems/MatchFlowSystem";
import { MatchStatsSystem } from "./core/systems/MatchStatsSystem";
import { createRestartPlan, positionRestart, resolveOutOfPlay, type RestartPlan } from "./core/systems/RestartSystem";
import { RefereeSystem } from "./core/systems/RefereeSystem";
import { CameraSystem } from "./core/systems/CameraSystem";
import { FootballAISystem } from "./core/systems/AISystem";
import type { RuntimeTeamTactics } from "./core/systems/TacticsSystem";
import { getAIDifficulty } from "./core/systems/AIDifficulty";
import type { AIDifficultyLevel } from "./core/systems/AIDifficulty";
import { DribblingSystem } from "./core/systems/DribblingSystem";
import type { DribblingResult } from "./core/systems/DribblingSystem";
import { FirstTouchSystem } from "./core/systems/FirstTouchSystem";
import type { FirstTouchResult } from "./core/systems/FirstTouchSystem";
import { applyPassPlan, createPassPlan } from "./core/systems/PassingSystem";
import type { PassFeedbackEvent, PassPlan, PassStyle } from "./core/systems/PassingSystem";
import { applyShotPlan, createShotPlan } from "./core/systems/ShootingSystem";
import type { ShotFeedbackEvent, ShotPlan } from "./core/systems/ShootingSystem";
import { DEFAULT_BALL_PHYSICS_CONFIG, DEFAULT_SHOOTING_CONFIG } from "./core/systems/GameplayConfig";
import type { ShootingConfig } from "./core/systems/GameplayConfig";
import { BallActionSystem } from "./core/systems/BallActionSystem";
import type { BallAction, BallActionEvent, BallActionKind } from "./core/systems/BallActionSystem";
import { DuelSystem } from "./core/systems/DuelSystem";
import { GoalkeeperSystem, isBallApproachingGoal } from "./core/systems/GoalkeeperSystem";
import type { KeeperBrainSnapshot, KeeperDistributionChoice, KeeperReactionAction, KeeperSaveResult } from "./core/systems/GoalkeeperSystem";
import { KeyboardInput } from "./core/input/KeyboardInput";
import { TouchInput } from "./core/input/TouchInput";
import { cameraRelativeDirection, MatchController } from "./core/input/MatchController";
import { HudController } from "./rendering/HudController";
import { MinimapController } from "./rendering/MinimapController";
import { addPitch as addWorldPitch, createBallVisual, createPlayerVisual } from "./rendering/WorldFactory";
import { createGameScene } from "./rendering/SceneFactory";
import { PlayerAnimationSystem } from "./rendering/PlayerPresentation";
import { MatchAudio, type MatchAudioCue } from "./audio/MatchAudio";
import { manCity, realMadrid } from "./data/teams";
import type { PlayerData, TeamData, TeamId } from "./data/types";
import { buildMatchTeamData, chemistry, createSquadStore, homeSquadCards, teamOverall, validateSquad } from "./management/SquadSystem";
import { SquadUI } from "./management/SquadUI";
import "./styles.css";
import "./management/SquadUI.css";

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
        phase4: ReturnType<typeof phase4DebugState>;
        phase5: ReturnType<typeof phase5DebugState>;
        phase6: ReturnType<typeof phase6DebugState>;
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
const BALL_RADIUS = DEFAULT_BALL_PHYSICS_CONFIG.radius;
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
      <div class="goal-moment" data-goal-moment hidden aria-live="polite"><small>ELITE KICKOFF · GOAL</small><strong data-goal-scorer></strong><span data-goal-score></span></div>
      <button class="hud-toggle" data-hud-toggle type="button" aria-pressed="false">Clean view</button>
      <div class="ai-settings" data-ai-settings>
        <details class="rules-options presentation-options" data-presentation-options>
          <summary>Picture & sound</summary>
          <label>Weather <select data-weather aria-label="Weather"><option value="clear">Clear evening</option><option value="rain">Rain</option></select></label>
          <label><input type="checkbox" data-reduced-motion> Reduce motion / effects</label>
          <button type="button" data-sound-enable>Enable sound</button>
          <label>Volume <input type="range" data-volume aria-label="Sound volume" min="0" max="100" value="40"></label>
          <label>Sound check <select data-sound-cue aria-label="Sound check"><option>pass</option><option>shot</option><option>tackle</option><option>whistle</option><option>goal</option><option>kick</option><option>save</option><option>ui</option></select></label>
          <button type="button" data-sound-test>Play cue</button>
          <small data-audio-status role="status">Sound off · enable when ready.</small>
        </details>
        <label>Difficulty <select data-ai-difficulty aria-label="AI difficulty"><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label>
        <label><input type="checkbox" data-ai-debug> AI debug</label>
        <label><input type="checkbox" data-ai-spectator> Watch AI vs AI</label>
        <button type="button" data-ai-restart>Restart</button>
        <button type="button" data-match-pause>Pause / Resume</button>
        <button type="button" data-squad-open>Squad Hub</button>
        <label>Next match <select data-match-length aria-label="Next match length"><option value="240" selected>4 min</option><option value="30">30s demo</option></select></label>
        <details class="rules-options" data-rules-options>
          <summary>Advanced rules</summary>
          <label><input type="checkbox" data-rule="offside"> Offside</label>
          <label><input type="checkbox" data-rule="advantage"> Advantage</label>
          <label><input type="checkbox" data-rule="injuryTime"> Added time</label>
          <label><input type="checkbox" data-rule="substitutions"> Substitution windows</label>
          <small data-substitution-status>Advanced rules are optional.</small>
        </details>
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
          <div class="key">J Pass · U Through · I Lob · O Cross</div>
          <div class="key">K Power · Shift+K Finesse · P Chip</div>
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
          <div class="touch-button" data-action="throughPass">THROUGH</div>
          <div class="touch-button" data-action="lobPass">LOB</div>
          <div class="touch-button" data-action="cross">CROSS</div>
          <div class="touch-button" data-action="shoot">SHOOT</div>
          <div class="touch-button" data-action="chipShot">CHIP</div>
          <div class="touch-button" data-action="sprint">SPRINT</div>
          <div class="touch-button" data-action="tackle">TACKLE</div>
        </div>
      </div>
      <div class="match-over" data-match-over>
        <div class="result-box">
          <h1 class="result-title">Full Time</h1>
          <p class="result-score" data-result-score>Real Madrid 0 - 0 Man City</p>
          <div data-result-stats aria-label="Match statistics"></div>
          <button class="restart" data-restart>Restart Match</button>
        </div>
      </div>
      <div data-squad-ui-host></div>
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
const matchLengthSelect = document.querySelector<HTMLSelectElement>("[data-match-length]")!;
const resultStatsEl = document.querySelector<HTMLDivElement>("[data-result-stats]")!;
const soundEnableButton = document.querySelector<HTMLButtonElement>("[data-sound-enable]")!;
const audioStatusEl = document.querySelector<HTMLElement>("[data-audio-status]")!;
const goalMomentEl = document.querySelector<HTMLElement>("[data-goal-moment]")!;
const motionToggle = document.querySelector<HTMLInputElement>("[data-reduced-motion]")!;
const squadOpenButton = document.querySelector<HTMLButtonElement>("[data-squad-open]")!;
const squadUIHost = document.querySelector<HTMLDivElement>("[data-squad-ui-host]")!;
let reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
motionToggle.checked = reducedMotion;
const playerAnimations = new PlayerAnimationSystem();
const matchAudio = new MatchAudio();
matchAudio.setVolume(0.4);
let soundEnabled = false;
let soundBusy = false;
let goalMomentRemaining = 0;
let dribbleSoundRemaining = 0;
const frameTimes: number[] = [];
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
const matchFlow = new MatchFlowSystem(matchState);
const matchStats = new MatchStatsSystem();
const referee = new RefereeSystem({ bounds: { halfWidth: HALF_W, halfLength: HALF_L }, random: () => rand(0, 1) });
let pendingRestart: RestartPlan | null = null;
let restartPlacement: ReturnType<typeof positionRestart> | null = null;
let nextKickoffTeam: TeamId = "home";
const fixedTimestep = new FixedTimestep({ step: 1 / 60, maxSteps: 8 });
const movementConfig = DEFAULT_MOVEMENT_CONFIG;
const dribblingSystem = new DribblingSystem({ mode: "impulse", attachmentHeight: BALL_RADIUS });
const firstTouchSystem = new FirstTouchSystem({ ballHeight: BALL_RADIUS });
let goalkeeperSystem = new GoalkeeperSystem();
const footballAI = new FootballAISystem();
let aiDifficulty: AIDifficultyLevel = "normal";
let spectatorMode = false;
const keeperBrains = new Map<string, KeeperBrainSnapshot>();
const keeperDistributions = new Map<string, { choice: KeeperDistributionChoice; remaining: number }>();
let pendingPass: { passerId: string; team: TeamId; targetId: string } | null = null;
let pendingPassExpiresAt = 0;
let releaseLock: { playerId: string; remaining: number } | null = null;
/** Physics/action time uses the same GAME_SPEED-scaled fixed-step clock. */
let actionClockSeconds = 0;
const ballActions = new BallActionSystem();
const duelSystem = new DuelSystem();
let actionGeneration = 0;
const queuedBallActions = new Map<number, {
  action: BallAction;
  generation: number;
  playerId: string;
  kind: BallActionKind;
  passPlan?: PassPlan;
  passStyle?: PassStyle;
  shotPlan?: ShotPlan;
  shotConfig?: Partial<ShootingConfig>;
  restartKind?: string;
  clearance?: { target: THREE.Vector3; strength: number; lift: number };
}>();
const recentBallActionEvents: BallActionEvent[] = [];
const cameraSystem = new CameraSystem();
const squadStore = createSquadStore();
let currentHomeTeam: TeamData = {
  ...realMadrid,
  players: buildMatchTeamData(squadStore.snapshot).map(({ id: _cardId, ...player }) => player)
};
let squadUI: SquadUI;
let squadPausedMatch = false;

let lastMovementResult: MovementResult | null = null;
let lastDribblingResult: DribblingResult | null = null;
let lastFirstTouchResult: FirstTouchResult | null = null;
let lastPassPlan: PassPlan | null = null;
let lastShotPlan: ShotPlan | null = null;
let lastKeeperResult: KeeperSaveResult | null = null;
let lastFeedback: PassFeedbackEvent | ShotFeedbackEvent | null = null;
let pendingShot: { plan: ShotPlan; defendingTeam: TeamId; keeperAttempted?: boolean } | null = null;
let lastBallPositionBeforePhysics = new THREE.Vector3();
let goalMouthEntryPosition: THREE.Vector3 | null = null;
let lastCameraEmphasis = 0;
let lastRenderDebugAt = 0;
let lastFrameCaptureAt = 0;
let keyboardInput = new KeyboardInput();
let touchInput: TouchInput | undefined;
const matchController = new MatchController({
  pass: () => passBall(activePlayer),
  throughPass: () => passBall(activePlayer, undefined, undefined, "through"),
  lobPass: () => passBall(activePlayer, undefined, undefined, "lob"),
  cross: () => passBall(activePlayer, undefined, undefined, "cross"),
  shoot: () => shootBall(activePlayer, isFinesseShotRequested() ? "finesse" : "power"),
  chipShot: () => shootBall(activePlayer, "finesse", { shotLift: DEFAULT_SHOOTING_CONFIG.chipLift }),
  tackle: () => tackle(activePlayer),
  switchPlayer: () => switchToNearestHome(),
  switchCamera: () => {
    const nextCameraMode = switchCameraMode(matchState);
    cameraChip.textContent = nextCameraMode === "broadcast" ? "Broadcast Cam" : "Follow Cam";
    addMatchEvent(matchState, "camera", `Camera switched to ${nextCameraMode}.`);
    addFeed(`Camera switched to ${nextCameraMode}.`);
  },
  restart: () => resetMatch(),
  pause: () => togglePause()
});

const ball = {
  mesh: createBallVisual(BALL_RADIUS),
  position: new THREE.Vector3(0, BALL_RADIUS, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  spin: new THREE.Vector3(0, 0, 0)
};

function createPlayer(team: TeamData, spec: PlayerData): Player {
  const { group, body, marker, label } = createPlayerVisual(team, spec);
  // Body variation is presentation-only; gameplay keeps one collision radius
  // so the shared movement/duel rules remain deterministic across rosters.
  const heightScale = Number.isFinite(spec.heightScale) ? clamp(spec.heightScale!, 0.94, 1.06) : 1;
  const weightScale = Number.isFinite(spec.weightScale) ? clamp(spec.weightScale!, 0.94, 1.06) : 1;
  group.scale.set(weightScale, heightScale, weightScale);
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
  homePlayers = currentHomeTeam.players.map((spec) => createPlayer(currentHomeTeam, spec));
  awayPlayers = manCity.players.map((spec) => createPlayer(manCity, spec));
  players = [...homePlayers, ...awayPlayers];
  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  activePlayer.marker.material.opacity = spectatorMode ? 0 : 0.92;
  activePlayer.marker.scale.setScalar(1.16);
}

function removePlayerVisuals(teamPlayersToRemove: readonly Player[]) {
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();
  for (const player of teamPlayersToRemove) {
    scene.remove(player.mesh);
    player.mesh.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      // Player rig geometries are module-level buffers shared with the away
      // team and the replacement XI, so only per-player materials/textures
      // are released here.
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!material || disposedMaterials.has(material)) continue;
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose();
          }
        }
        disposedMaterials.add(material);
        material.dispose();
      }
    });
  }
}

function rebuildHomeSquad() {
  releaseBall();
  playerAnimations.reset();
  removePlayerVisuals(homePlayers);
  currentHomeTeam = {
    ...realMadrid,
    players: buildMatchTeamData(squadStore.snapshot).map(({ id: _cardId, ...player }) => player)
  };
  homePlayers = currentHomeTeam.players.map((spec) => createPlayer(currentHomeTeam, spec));
  players = [...homePlayers, ...awayPlayers];
  activePlayer = homePlayers.find((player) => player.role !== "GK") ?? homePlayers[0];
  activePlayer.marker.material.opacity = spectatorMode ? 0 : 0.92;
  activePlayer.marker.scale.setScalar(1.16);
  resetMatch();
  addFeed(`Squad confirmed: ${squadStore.snapshot.formationId}.`);
}

function resetMatch() {
  invalidateBallActions("cancelled");
  dribblingSystem.reset();
  duelSystem.reset();
  actionClockSeconds = 0;
  playerAnimations.reset();
  stadium.reset();
  matchAudio.reset();
  goalMomentRemaining = 0;
  dribbleSoundRemaining = 0;
  goalMomentEl.hidden = true;
  cameraSystem.clearGoalEmphasis();
  matchState.duration = Number(matchLengthSelect.value);
  matchFlow.reset();
  matchAudio.setActive(!document.hidden);
  audioStatusEl.textContent = soundEnabled ? "Sound on · pauses with the match." : "Sound off · enable when ready.";
  matchStats.reset();
  referee.reset();
  feedEl.replaceChildren();
  matchOverEl.classList.remove("visible");

  [...homePlayers, ...awayPlayers].forEach((player) => {
    player.position.copy(player.home);
    player.velocity.set(0, 0, 0);
    player.mesh.position.copy(player.position);
    player.mesh.rotation.y = player.team === "home" ? 0 : Math.PI;
    player.hasBall = false;
    player.cooldown = 0;
    player.stamina = 1;
    player.intent = player.role === "GK" ? "keeper" : "hold";
    player.mesh.visible = true;
    player.marker.material.opacity = 0;
    player.marker.scale.setScalar(1);
  });

  activePlayer = homePlayers.find((p) => p.short === "Vini Jr.") ?? homePlayers[8];
  setActivePlayer(activePlayer);
  ball.position.set(0, BALL_RADIUS, 0);
  lastBallPositionBeforePhysics.copy(ball.position);
  goalMouthEntryPosition = null;
  ball.velocity.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
  ball.mesh.position.copy(ball.position);
  ballOwner = null;
  setBallOwnerId(matchState, null);
  lastTouch = null;
  attackingTeam = "home";
  pendingShot = null;
  pendingPass = null;
  pendingPassExpiresAt = 0;
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
  nextKickoffTeam = "home";
  prepareRestart(createRestartPlan({ kind: "kickoff", team: nextKickoffTeam, bounds: { halfWidth: HALF_W, halfLength: HALF_L }, ballRadius: BALL_RADIUS }), false);
  addMatchEvent(matchState, "restart", "Kickoff at the Bernabeu-inspired arena.");
  addFeed("Kickoff at the Bernabeu-inspired arena.");
  updateHud();
}

function eligiblePlayers() {
  return players.filter((player) => !referee.dismissedIds.has(player.id));
}

function teamPlayers(team: TeamId) {
  return eligiblePlayers().filter((player) => player.team === team);
}

function preferredRestartTakerId(plan: RestartPlan): string | undefined {
  if (plan.team !== "home" || !["penalty", "freeKick", "corner"].includes(plan.kind)) return undefined;
  const cardId = squadStore.snapshot.setPieces[plan.kind as "penalty" | "freeKick" | "corner"];
  const card = homeSquadCards.find((candidate) => candidate.id === cardId);
  return card ? `home-${card.number}` : undefined;
}

function prepareRestart(plan: RestartPlan, startCountdown = true) {
  invalidateBallActions("cancelled");
  dribblingSystem.reset();
  duelSystem.reset();
  releaseBall();
  pendingPass = null;
  pendingPassExpiresAt = 0;
  pendingShot = null;
  goalMouthEntryPosition = null;
  releaseLock = null;
  referee.clearPending();
  footballAI.reset();
  keeperDistributions.clear();
  pendingRestart = plan;
  restartPlacement = positionRestart({
    restart: plan,
    players: eligiblePlayers(),
    bounds: { halfWidth: HALF_W, halfLength: HALF_L },
    ballRadius: BALL_RADIUS,
    preferredTakerId: preferredRestartTakerId(plan)
  });
  ball.position.copy(restartPlacement.ballPosition);
  ball.mesh.position.copy(ball.position);
  ball.velocity.set(0, 0, 0);
  ball.spin.set(0, 0, 0);
  lastTouch = null;
  if (restartPlacement.taker?.team === "home") setActivePlayer(restartPlacement.taker as Player);
  if (startCountdown) {
    matchAudio.play("whistle");
    matchFlow.beginRestart();
    const stat = plan.kind === "corner" ? "corners" : plan.kind === "throwIn" ? "throwIns" : plan.kind === "goalKick" ? "goalKicks" : null;
    if (stat) matchStats.record(plan.team, stat);
    if (!reducedMotion) cameraSystem.goalEmphasis(ball.position.clone());
  } else matchRules.resetGoalLock();
  addFeed(`${plan.kind}: ${plan.team === "home" ? "Real Madrid" : "Man City"}. ${plan.reason}`);
}

function executeRestart() {
  const plan = pendingRestart;
  const placement = restartPlacement;
  pendingRestart = null;
  restartPlacement = null;
  if (!plan || !placement?.taker) return;
  if (plan.kind === "kickoff") matchAudio.play("whistle");
  const taker = placement.taker as Player;
  if (!attachBallTo(taker)) return;
  if (plan.kind === "penalty" || (plan.kind === "freeKick" && !plan.reason.toLowerCase().includes("offside") && ball.position.z * (plan.team === "home" ? 1 : -1) > HALF_L - 26)) shootBall(taker);
  else if (placement.receiver) passBall(taker, placement.receiver as Player, plan.kind);
  else clearBall(taker);
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

function attachBallTo(player: Player, options: { preserveVelocity?: boolean; preserveSpin?: boolean } = {}) {
  if (referee.dismissedIds.has(player.id)) return false;
  const offside = referee.onTouch(player);
  if (offside) { prepareRestart(offside); return false; }
  pendingShot = null;
  if (ballOwner && ballOwner !== player) cancelBallActionsFor(ballOwner.id, "ownership-lost");
  if (pendingPass) {
    if (player.team === pendingPass.team && player.id !== pendingPass.passerId) {
      matchStats.record(player.team, "completedPasses");
    }
    pendingPass = null;
    pendingPassExpiresAt = 0;
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
  if (!options.preserveVelocity) ball.velocity.set(0, 0, 0);
  if (!options.preserveSpin) ball.spin.set(0, 0, 0);
  addMatchEvent(matchState, "possession", `${player.short} takes possession.`);
  return true;
}

type QueueBallActionOptions = {
  passPlan?: PassPlan;
  passStyle?: PassStyle;
  shotPlan?: ShotPlan;
  shotConfig?: Partial<ShootingConfig>;
  defendingTeam?: TeamId;
  restartKind?: string;
  clearance?: { target: THREE.Vector3; strength: number; lift: number };
};

function recordBallActionEvent(event: BallActionEvent) {
  recentBallActionEvents.push(event);
  while (recentBallActionEvents.length > 24) recentBallActionEvents.shift();
}

function cancelBallActionsFor(ownerId: string, reason: BallActionEvent["reason"] = "ownership-lost", exceptId?: number) {
  for (const [id, entry] of queuedBallActions) {
    if (entry.playerId !== ownerId || id === exceptId) continue;
    const event = ballActions.cancel(id, reason, actionClockSeconds);
    if (event) recordBallActionEvent(event);
    playerAnimations.cancelAction(entry.playerId);
    queuedBallActions.delete(id);
  }
}

function invalidateBallActions(reason: BallActionEvent["reason"] = "cancelled") {
  actionGeneration += 1;
  for (const [id, entry] of queuedBallActions) {
    const event = ballActions.cancel(id, reason, actionClockSeconds);
    if (event) recordBallActionEvent(event);
    playerAnimations.cancelAction(entry.playerId);
  }
  queuedBallActions.clear();
  ballActions.reset();
}

function queueBallAction(player: Player, kind: BallActionKind, options: QueueBallActionOptions = {}) {
  if (matchState.status !== "playing" || ballOwner !== player || referee.dismissedIds.has(player.id)) return null;
  // A single player cannot wind up two contacts at once. Explicitly canceling
  // here also keeps the sidecar map in sync with BallActionSystem's cap.
  cancelBallActionsFor(player.id, "replaced");
  const action = ballActions.queue({
    ownerId: player.id,
    kind,
    now: actionClockSeconds,
    payload: {
      targetId: options.passPlan?.target.id ?? "",
      restartKind: options.restartKind ?? ""
    }
  });
  queuedBallActions.set(action.id, {
    action,
    generation: actionGeneration,
    playerId: player.id,
    kind,
    passPlan: options.passPlan,
    passStyle: options.passStyle,
    shotPlan: options.shotPlan,
    shotConfig: options.shotConfig,
    restartKind: options.restartKind,
    clearance: options.clearance
  });
  const presentationAction = kind === "shot" || kind === "volley" || kind === "header" ? "shot"
    : kind === "clearance" ? "kick" : "pass";
  const duration = Math.max(action.timing.recovery, 0.08);
  playerAnimations.startAction(player.id, presentationAction, {
    clock: "simulation",
    duration,
    contactAt: action.timing.contact / duration,
    preferredFoot: player.preferredFoot === "left" ? "left" : "right",
    contactTarget: ball.position.clone()
  });
  if (options.passPlan) {
    lastPassPlan = options.passPlan;
    lastFeedback = options.passPlan.feedback;
    actionChip.textContent = options.passPlan.interception.interceptable
      ? `Preparing pass · risk ${Math.round(options.passPlan.feedback.interceptionRisk * 100)}%`
      : `Preparing pass to ${options.passPlan.target.short}`;
    addMatchEvent(matchState, "pass", `${player.short} prepares a pass toward ${options.passPlan.target.short}.`);
    addFeed(`${player.short} shapes to pass toward ${options.passPlan.target.short}.`);
  }
  if (options.shotPlan) {
    lastShotPlan = options.shotPlan;
    lastFeedback = options.shotPlan.feedback;
    actionChip.textContent = `Preparing ${options.shotPlan.shotType}`;
    addMatchEvent(matchState, "shot", `${player.short} prepares a ${options.shotPlan.shotType} shot.`);
    addFeed(`${player.short} sets up a ${options.shotPlan.shotType} shot.`);
  }
  return action;
}

function triggerContactPresentation(player: Player, kind: BallActionKind) {
  if (reducedMotion) return;
  const action = kind === "shot" || kind === "volley" || kind === "header" ? "shot"
    : kind === "clearance" ? "kick" : kind === "cross" ? "pass" : "pass";
  playerAnimations.syncActionContact(player.id, { contactTarget: ball.position.clone() });
  void action;
}

function syncBallActionPresentation() {
  for (const queued of queuedBallActions.values()) {
    const elapsed = actionClockSeconds - queued.action.queuedAt;
    playerAnimations.syncActionContact(queued.playerId, {
      elapsed,
      // Keep the moving ball as the foot target during wind-up. At contact
      // triggerContactPresentation stores the actual release point; after
      // that point the follow-through must not chase the kicked ball.
      ...(elapsed <= queued.action.timing.contact + 0.0001 ? { contactTarget: ball.position.clone() } : {})
    });
  }
}

function processBallActionEvents() {
  if (matchState.status !== "playing") return;
  for (const event of ballActions.advance(actionClockSeconds)) {
    recordBallActionEvent(event);
    const queued = queuedBallActions.get(event.action.id);
    if (!queued) continue;
    if (event.phase === "cancel") {
      playerAnimations.cancelAction(queued.playerId);
      queuedBallActions.delete(event.action.id);
      continue;
    }
    if (event.phase === "prepare") {
      actionChip.textContent = `${queued.kind} wind-up`;
      continue;
    }
    if (event.phase === "recovery") {
      playerAnimations.syncActionContact(queued.playerId, { elapsed: queued.action.timing.recovery });
      queuedBallActions.delete(event.action.id);
      continue;
    }
    const player = players.find((candidate) => candidate.id === queued.playerId);
    const horizontalBallDistance = player
      ? Math.hypot(player.position.x - ball.position.x, player.position.z - ball.position.z)
      : Number.POSITIVE_INFINITY;
    const ballHeightReachable = player
      ? Math.abs(ball.position.y - BALL_RADIUS) <= 1.65
      : false;
    const valid = queued.generation === actionGeneration && player &&
      ballOwner === player && !referee.dismissedIds.has(player.id);
    if (!valid || horizontalBallDistance > 1.7 || !ballHeightReachable) {
      const cancelled = ballActions.cancel(event.action.id, "ownership-lost", actionClockSeconds);
      if (cancelled) recordBallActionEvent(cancelled);
      playerAnimations.cancelAction(queued.playerId);
      queuedBallActions.delete(event.action.id);
      continue;
    }
    if (queued.passPlan) {
      const receiver = teamPlayers(player.team).find((candidate) => candidate.id === queued.passPlan!.target.id && candidate !== player);
      if (!receiver) {
        playerAnimations.cancelAction(player.id);
        queuedBallActions.delete(event.action.id);
        continue;
      }
      const currentPlan = createPassPlan({
        passer: player,
        teammates: teamPlayers(player.team).filter((candidate) => candidate !== player),
        opponents: teamPlayers(player.team === "home" ? "away" : "home"),
        ball,
        intendedTarget: receiver,
        style: queued.passStyle,
        desiredDirection: playerForward(player),
        random: rand
      });
      if (!currentPlan) {
        playerAnimations.cancelAction(player.id);
        queuedBallActions.delete(event.action.id);
        continue;
      }
      queued.passPlan = currentPlan;
      lastPassPlan = currentPlan;
      referee.snapshotPass({ passer: player, players: eligiblePlayers(), ballPosition: currentPlan.origin, restartKind: queued.restartKind });
      applyPassPlan(ball, currentPlan);
      pendingPass = { passerId: player.id, team: player.team, targetId: currentPlan.target.id };
      pendingPassExpiresAt = actionClockSeconds + Math.max(0.8, currentPlan.trajectory.travelTime + 0.55);
      pendingShot = null;
      releaseLock = { playerId: player.id, remaining: 0.22 };
      matchStats.record(player.team, "passes");
      releaseBall(event.action.id);
      triggerContactPresentation(player, queued.kind);
      matchAudio.play("pass");
      actionChip.textContent = currentPlan.interception.interceptable
        ? `Pass risk ${Math.round(currentPlan.feedback.interceptionRisk * 100)}%`
        : `Pass to ${currentPlan.target.short}`;
      addMatchEvent(matchState, "pass", `${player.short} passes toward ${currentPlan.target.short}.`);
      addFeed(`${player.short} releases a ${currentPlan.interception.interceptable ? "risky " : "clean "}pass toward ${currentPlan.target.short}.`);
    } else if (queued.shotPlan) {
      const defendingTeam = player.team === "home" ? "away" : "home";
      const currentPlan = createShotPlan({
        shooter: player,
        opponents: teamPlayers(defendingTeam),
        goalkeeper: teamPlayers(defendingTeam).find((candidate) => candidate.role === "GK") ?? null,
        ball,
        goal: { center: new THREE.Vector3(0, 2, player.team === "home" ? HALF_L + 1.4 : -HALF_L - 1.4), width: GOAL_WIDTH, height: 4 },
        shotType: queued.shotPlan.shotType,
        config: queued.shotConfig,
        random: rand
      });
      if (!currentPlan) {
        playerAnimations.cancelAction(player.id);
        queuedBallActions.delete(event.action.id);
        continue;
      }
      queued.shotPlan = currentPlan;
      lastShotPlan = currentPlan;
      applyShotPlan(ball, currentPlan);
      pendingPass = null;
      pendingPassExpiresAt = 0;
      releaseLock = { playerId: player.id, remaining: 0.22 };
      matchStats.record(player.team, "shots");
      pendingShot = { plan: currentPlan, defendingTeam };
      releaseBall(event.action.id);
      triggerContactPresentation(player, queued.kind);
      stadium.shot(ball.position);
      matchAudio.play("shot");
      actionChip.textContent = `${currentPlan.shotType === "power" ? "Power" : "Finesse"} ${Math.round(currentPlan.accuracy * 100)}%`;
      addMatchEvent(matchState, "shot", `${player.short} takes a ${currentPlan.shotType} shot.`);
      addFeed(`${player.short} hits a ${currentPlan.shotType} shot toward the ${currentPlan.selectedTarget.side} side.`);
    } else if (queued.clearance) {
      releaseLock = { playerId: player.id, remaining: 0.22 };
      releaseBall(event.action.id);
      kickBall(ball, queued.clearance.target, queued.clearance.strength, queued.clearance.lift);
      triggerContactPresentation(player, queued.kind);
      matchAudio.play("kick");
      matchStats.record(player.team, "clearances");
      actionChip.textContent = "Clearance into space";
      addMatchEvent(matchState, "pass", `${player.short} clears under pressure.`);
      addFeed(`${player.short} clears into space.`);
    }
  }
}

function releaseBall(exceptActionId?: number) {
  if (ballOwner) {
    cancelBallActionsFor(ballOwner.id, "ownership-lost", exceptActionId);
    ballOwner.hasBall = false;
  }
  ballOwner = null;
  setBallOwnerId(matchState, null);
}

function playerForward(player: SimPlayer) {
  const forward = new THREE.Vector3(0, 0, player.team === "home" ? 1 : -1);
  const velocity = new THREE.Vector3(player.velocity.x, 0, player.velocity.z);
  if (velocity.lengthSq() > 0.0225) {
    forward.copy(velocity.normalize());
  } else if (player.mesh && Number.isFinite(player.mesh.rotation.y)) {
    // Preserve the last root facing when stationary so a sideways stop does
    // not snap pass/dribble contact back to the team's attack axis.
    forward.set(Math.sin(player.mesh.rotation.y), 0, Math.cos(player.mesh.rotation.y));
  }
  return forward;
}

function switchToNearestHome() {
  const candidates = teamPlayers("home").filter((p) => p.role !== "GK");
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
  if (best) setActivePlayer(best);
}

function passBall(player: Player, intendedTarget?: Player, restartKind?: string, style: PassStyle = "ground") {
  if (matchState.status !== "playing" || ballOwner !== player) {
    return;
  }
  const teammates = teamPlayers(player.team).filter((p) => p !== player);
  const opponents = teamPlayers(player.team === "home" ? "away" : "home");
  const plan = createPassPlan({
    passer: player,
    teammates,
    opponents,
    ball,
    intendedTarget,
    style,
    desiredDirection: playerForward(player),
    random: rand
  });
  if (!plan) {
    return;
  }
  queueBallAction(player, style === "cross" ? "cross" : "pass", { passPlan: plan, passStyle: style, restartKind });
}

function togglePause() {
  if (matchState.status === "paused") matchFlow.resume(); else matchFlow.pause();
  matchAudio.setActive(!document.hidden && matchState.status !== "paused");
  audioStatusEl.textContent = soundEnabled ? (matchState.status === "paused" ? "Paused · sound is silent." : "Sound on · pauses with the match.") : "Sound off · enable when ready.";
}

function shootBall(player: Player, shotType: "power" | "finesse" = "power", shotConfig: Partial<ShootingConfig> = {}) {
  if (matchState.status !== "playing" || ballOwner !== player) {
    return;
  }
  const defendingTeam: TeamId = player.team === "home" ? "away" : "home";
  const opponents = teamPlayers(defendingTeam);
  const goalkeeper = opponents.find((candidate) => candidate.role === "GK") ?? null;
  const targetZ = player.team === "home" ? HALF_L + 1.4 : -HALF_L - 1.4;
  const plan = createShotPlan({
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
    config: shotConfig,
    random: rand
  });
  if (!plan) {
    return;
  }
  queueBallAction(player, "shot", { shotPlan: plan, shotConfig, defendingTeam });
}

function tackle(player: Player) {
  if (matchState.status !== "playing" || referee.dismissedIds.has(player.id)) return;
  const target = ballOwner;
  if (!target || target.team === player.team || player.cooldown > 0) return;
  const now = actionClockSeconds;
  const input = {
    challenger: player,
    owner: target,
    ballPosition: ball.position,
    now,
    action: "poke" as const
  };
  const eligibility = duelSystem.eligibility(input);
  if (!eligibility.eligible) {
    if (eligibility.reason === "ball-protected") {
      actionChip.textContent = "Shielded";
      addFeed(`${target.short} shields the ball.`);
    }
    return;
  }
  const result = duelSystem.resolve({ ...input, random: rand(0, 1) });
  if (!reducedMotion) playerAnimations.trigger(player.id, "tackle");
  matchAudio.play("tackle");
  player.cooldown = Math.max(player.cooldown, result.cooldownUntil - now);
  const assessment = referee.assessTackle({ offender: player, victim: target, wonBall: result.status === "won",
    fromBehind: result.eligibility.shielding.approachDot < -0.3,
    relativeSpeed: player.velocity.clone().sub(target.velocity).length(), possessionTeam: target.team });
  if (assessment.foul) {
    matchStats.record(player.team, "fouls");
    if (assessment.card === "yellow" || assessment.card === "secondYellow") matchStats.record(player.team, "yellowCards");
    if (assessment.card === "red" || assessment.card === "secondYellow") matchStats.record(player.team, "redCards");
    if (referee.dismissedIds.has(player.id)) {
      player.mesh.visible = false;
      player.velocity.set(0, 0, 0);
      invalidateBallActions("cancelled");
      if (player === activePlayer) switchToNearestHome();
    }
    addFeed(`${player.short}: ${assessment.reason}${assessment.card ? ` (${assessment.card})` : ""}`);
    if (assessment.restart) prepareRestart(assessment.restart);
    else if (assessment.advantage) actionChip.textContent = "Advantage — play on";
    return;
  }
  if (result.status === "won") {
    if (!attachBallTo(player)) return;
    matchStats.record(player.team, "tackles");
    addMatchEvent(matchState, "tackle", `${player.short} wins the tackle.`);
    addFeed(`${player.short} wins the tackle.`);
  } else if (result.status === "lost" && ballOwner === target) {
    // A failed challenge is a recovery beat for the challenger. It does not
    // magically detach the ball from the owner; only a won duel or an
    // explicit deflection can change possession.
    player.velocity.multiplyScalar(0.62);
    addMatchEvent(matchState, "tackle", `${player.short} misses the poke.`);
    addFeed(`${player.short} cannot get around ${target.short}.`);
  } else if (result.status === "protected") {
    actionChip.textContent = "Shielded";
    addFeed(`${target.short} shields the ball.`);
  }
}

function nearestOpponentDistance(player: Player) {
  const opponents = teamPlayers(player.team === "home" ? "away" : "home");
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

function homeRuntimeTactics(): RuntimeTeamTactics {
  const state = squadStore.snapshot;
  const cardById = new Map(homeSquadCards.map((card) => [card.id, card]));
  const instructions: RuntimeTeamTactics["instructions"] = {};
  for (const [cardId, instruction] of Object.entries(state.tactics.instructions)) {
    const card = cardById.get(cardId);
    if (card) instructions[`home-${card.number}`] = instruction.role;
  }
  return {
    defensiveLine: state.tactics.defensiveLine,
    pressingIntensity: state.tactics.pressingIntensity,
    buildUpSpeed: state.tactics.buildUpSpeed,
    passingStyle: state.tactics.passingStyle,
    attackWidth: state.tactics.attackWidth,
    instructions
  };
}

function updateAI(dt: number) {
  const dismissedCount = referee.dismissedIds.size;
  footballAI.update({
    players: eligiblePlayers(),
    shouldContinue: () => matchState.status === "playing" && referee.dismissedIds.size === dismissedCount,
    goalkeepersManagedExternally: true,
    ball,
    ballOwner,
    activePlayer: spectatorMode ? null : activePlayer,
    teams: { home: currentHomeTeam, away: manCity },
    tactics: { home: homeRuntimeTactics() },
    bounds: { halfWidth: HALF_W, halfLength: HALF_L },
    playerRadius: PLAYER_RADIUS,
    dt,
    random: rand,
    passIntent: pendingPass && actionClockSeconds <= pendingPassExpiresAt ? {
      passerId: pendingPass.passerId,
      receiverId: pendingPass.targetId,
      team: pendingPass.team,
      expiresAtMs: pendingPassExpiresAt * 1000
    } : null,
    onPass: (player, target) => passBall(player as Player, target as Player | undefined),
    onShoot: (player) => shootBall(player as Player),
    onClear: (player) => clearBall(player as Player),
    onTackle: (player) => tackle(player as Player)
  });
  if (matchState.status === "playing") updateGoalkeepers(dt);
}

function clearBall(player: Player) {
  if (matchState.status !== "playing" || ballOwner !== player) return;
  const direction = player.team === "home" ? 1 : -1;
  const target = player.position.clone().add(new THREE.Vector3(rand(-14, 14), 2.5, direction * 34));
  pendingPass = null;
  pendingPassExpiresAt = 0;
  pendingShot = null;
  lastFeedback = null;
  queueBallAction(player, "clearance", { clearance: { target, strength: 30, lift: 2.8 } });
}

function updateGoalkeepers(dt: number) {
  for (const keeper of eligiblePlayers().filter((player) => player.role === "GK")) {
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

    const teammates = teamPlayers(keeper.team);
    const opponents = teamPlayers(keeper.team === "home" ? "away" : "home");
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
  const previousPosition = ball.position.clone();
  lastBallPositionBeforePhysics.copy(previousPosition);
  const owner = ballOwner;
  const recordGoalMouthEntry = () => {
    const direction = ball.velocity.z >= 0 ? 1 : -1;
    const edge = HALF_L + BALL_RADIUS;
    const before = previousPosition.z * direction;
    const after = ball.position.z * direction;
    if (before >= edge || after < edge || Math.abs(ball.velocity.z) < 0.0001) return;
    const t = (direction * edge - previousPosition.z) / (ball.position.z - previousPosition.z);
    const entry = previousPosition.clone().lerp(ball.position, clamp(t, 0, 1));
    if (Math.abs(entry.x) + BALL_RADIUS < GOAL_WIDTH / 2 && entry.y + BALL_RADIUS < 4.8) {
      goalMouthEntryPosition = entry;
    }
  };
  if (owner) {
    lastDribblingResult = dribblingSystem.update({
      player: owner,
      ball,
      dt,
      now: actionClockSeconds,
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

  if (owner) {
    recordGoalMouthEntry();
    const crossing = resolveOutOfPlay({ previousPosition, position: ball.position, bounds: { halfWidth: HALF_W, halfLength: HALF_L }, ballRadius: BALL_RADIUS, goalWidth: GOAL_WIDTH, lastTouchTeam: owner.team });
    if (crossing) {
      if (crossing.kind === "goal") scoreGoal(crossing.team);
      else prepareRestart(crossing.restart);
      return;
    }
  }
  // Dribbling owns the attached-ball position. Running BallSystem's owner
  // branch afterwards would overwrite its stat-scaled touch point, so physics
  // is only advanced once the ball is loose.
  if (!ballOwner || lastDribblingResult?.mode === "impulse") {
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
      onGoal: scoreGoal,
      onOutOfPlay: prepareRestart,
      lastTouchTeam: lastTouch?.team
    });
    recordGoalMouthEntry();
  }
}

function firstSegmentSphereContact(start: THREE.Vector3, end: THREE.Vector3, center: THREE.Vector3, radius: number) {
  const segment = end.clone().sub(start);
  const offset = start.clone().sub(center);
  const a = segment.lengthSq();
  const radiusSq = radius * radius;
  if (offset.lengthSq() <= radiusSq) return { t: 0, point: start.clone() };
  if (a <= 0.000001) return null;
  const b = 2 * offset.dot(segment);
  const c = offset.lengthSq() - radiusSq;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const t = (-b - root) / (2 * a);
  if (t < 0 || t > 1) return null;
  return { t, point: start.clone().lerp(end, t) };
}

function keeperContactBeforeGoalPlane(team: TeamId) {
  const pending = pendingShot;
  if (!pending || pending.plan.shooter.team !== team) return null;
  const direction = team === "home" ? 1 : -1;
  const plane = HALF_L + 0.8;
  const start = goalMouthEntryPosition?.clone() ?? lastBallPositionBeforePhysics.clone();
  const end = ball.position.clone();
  const startAlong = start.z * direction;
  const endAlong = end.z * direction;
  if (startAlong >= plane || endAlong < plane) return null;
  const planeDelta = end.z - start.z;
  const planeT = planeDelta === 0 ? 1 : clamp((direction * plane - start.z) / planeDelta, 0, 1);
  const keeper = teamPlayers(pending.defendingTeam).find((player) => player.role === "GK");
  if (!keeper) return null;
  const reach = goalkeeperSystem.config.baseReach + clamp(keeper.stats.physical / 100, 0, 1) * goalkeeperSystem.config.reachStatScale + BALL_RADIUS;
  const contact = firstSegmentSphereContact(start, end, keeper.position.clone().setY(1.25), reach);
  if (!contact || contact.t > planeT + 0.0001 || contact.point.y > 4.8) return null;
  return { keeper, point: contact.point, t: contact.t };
}

function scoreGoal(team: TeamId) {
  if (matchState.status !== "playing") return;
  if (pendingShot && pendingShot.plan.shooter.team !== team) {
    pendingShot = null;
  }
  const keeperContact = keeperContactBeforeGoalPlane(team);
  const goalPlanePosition = ball.position.clone();
  if (keeperContact) ball.position.copy(keeperContact.point);
  if (keeperContact && resolveGoalkeeperSave(team)) {
    // The save is adjudicated at the first swept contact, before the goal
    // plane. This prevents a late callback from rescuing a ball already over
    // the line while keeping the physical contact point inspectable.
    return;
  }
  ball.position.copy(goalPlanePosition);
  ball.mesh.position.copy(ball.position);
  const scorer = lastTouch?.team === team ? lastTouch.short : team === "home" ? "Real Madrid" : "Manchester City";
  if (!matchRules.scoreGoal(team, () => `GOAL! ${scorer} makes it ${compactScoreText(matchState)}.`)) return;
  matchStats.record(team, "goals");
  referee.onGoal();
  nextKickoffTeam = team === "home" ? "away" : "home";
  matchFlow.beginGoal();
  matchAudio.play("goal");
  stadium.goal(team, ball.position);
  if (!reducedMotion && lastTouch?.team === team) playerAnimations.trigger(lastTouch.id, "celebrate");
  goalMomentRemaining = 2.4;
  goalMomentEl.querySelector<HTMLElement>("[data-goal-scorer]")!.textContent = scorer;
  goalMomentEl.querySelector<HTMLElement>("[data-goal-score]")!.textContent = scoreText(matchState);
  goalMomentEl.hidden = false;
  pendingPass = null;
  pendingPassExpiresAt = 0;
  const goalText = matchState.events[0]?.description ?? `GOAL! ${scorer} makes it ${compactScoreText(matchState)}.`;
  pendingShot = null;
  goalMouthEntryPosition = null;
  if (!reducedMotion) cameraSystem.goalEmphasis(ball.position.clone(), { duration: 2.3, strength: 0.9 });
  addFeed(goalText);
  updateHud();
}

function resolveGoalkeeperSave(scoringTeam: TeamId) {
  const pending = pendingShot;
  if (!pending || pending.keeperAttempted || pending.plan.shooter.team !== scoringTeam) {
    return false;
  }
  const keeper = teamPlayers(pending.defendingTeam)
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
  if (!reducedMotion && lastKeeperResult.plan.action === "dive") {
    const localTarget = lastKeeperResult.plan.targetPosition.clone().sub(keeper.position).applyQuaternion(keeper.mesh.quaternion.clone().invert());
    playerAnimations.trigger(keeper.id, "dive", localTarget.x > 0 ? -1 : 1);
  }

  if (lastKeeperResult.outcome === "goal") {
    return false;
  }
  pendingShot = null;

  matchStats.record(keeper.team, "saves");
  matchAudio.play("save");
  lastTouch = keeper;
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

function resolvePassiveDuel() {
  if (!ballOwner) return false;
  const opponents = teamPlayers(ballOwner.team === "home" ? "away" : "home");
  const challenger = opponents
    .filter((candidate) => candidate.role !== "GK")
    .sort((a, b) => a.position.distanceToSquared(ball.position) - b.position.distanceToSquared(ball.position) || a.id.localeCompare(b.id))[0];
  if (!challenger) return false;
  const input = {
    challenger,
    owner: ballOwner,
    ballPosition: ball.position,
    now: actionClockSeconds,
    action: "poke" as const
  };
  const eligibility = duelSystem.eligibility(input);
  if (!eligibility.eligible) return false;
  const result = duelSystem.resolve({ ...input, random: rand(0, 1) });
  if (result.status === "won") {
    if (!attachBallTo(challenger as Player)) return true;
    matchStats.record(challenger.team, "tackles");
    addMatchEvent(matchState, "tackle", `${challenger.short} wins a shoulder-to-shoulder duel.`);
    addFeed(`${challenger.short} wins the duel.`);
    return true;
  }
  if (result.status === "lost") {
    challenger.velocity.multiplyScalar(0.62);
    addMatchEvent(matchState, "tackle", `${challenger.short} fails to dislodge the ball.`);
    addFeed(`${ballOwner.short} keeps the ball under pressure.`);
    return true;
  }
  return false;
}

function resolvePossession() {
  if (pendingShot && !isBallApproachingGoal(ball, pendingShot.defendingTeam)) pendingShot = null;
  // Incoming shots use the keeper's reaction/save model once, never the
  // generic loose-ball claim. A beaten keeper cannot re-roll at the goal line.
  if (pendingShot) {
    const keeper = eligiblePlayers().find((player) => player.role === "GK" && player.team === pendingShot?.defendingTeam);
    if (keeper && ball.position.y < 4.8 && keeper.position.distanceTo(ball.position) < 3.8) {
      if (resolveGoalkeeperSave(pendingShot.plan.shooter.team)) return;
    }
  }
  if (ballOwner) {
    resolvePassiveDuel();
    return;
  }
  const resolution = resolvePossessionSystem({
    players: eligiblePlayers(),
    homePlayers: teamPlayers("home"),
    awayPlayers: teamPlayers("away"),
    activePlayer,
    ballOwner: null,
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
  const offside = referee.onTouch(owner);
  if (offside) { prepareRestart(offside); return; }
  lastTouch = owner;
  if (pendingPass && owner.team !== pendingPass.team) pendingPass = null;
  if (pendingPass === null) pendingPassExpiresAt = 0;
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
  if (!attachBallTo(owner, { preserveVelocity: lastFirstTouchResult?.retained === true, preserveSpin: lastFirstTouchResult?.retained === true })) return;
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
  const cameraForward = new THREE.Vector3();
  camera.getWorldDirection(cameraForward);
  return cameraRelativeDirection(dir, cameraForward);
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
  const countdown = Math.ceil(matchFlow.debugSnapshot.countdownSeconds);
  if (matchState.status !== "playing") possessionChip.textContent = matchState.status === "kickoff" ? `Kickoff in ${countdown}`
    : matchState.status === "restart" ? `${pendingRestart?.kind ?? "Restart"} in ${countdown}`
    : matchState.status === "halftime" ? `Half time · ${countdown}s` : matchState.status === "paused" ? "Paused" : matchState.status === "goal" ? "GOAL!" : "Full time";
  const phase = matchState.status === "restart" || matchState.status === "goal" || matchState.status === "kickoff" ? "deadBall" : matchState.status;
  aiSettings.querySelector<HTMLElement>("[data-substitution-status]")!.textContent = referee.options.substitutions
    ? `Substitution window: ${referee.canSubstitute(phase) ? "OPEN (placeholder)" : "closed"}` : "Advanced rules are optional.";
}

function updateMinimap() {
  minimapController.update(eligiblePlayers(), ball, activePlayer);
}

function endMatch() {
  matchAudio.play("fulltime");
  addMatchEvent(matchState, "fullTime", "Full time.");
  resultScoreEl.textContent = `Real Madrid ${scoreText(matchState)} Man City`;
  const stats = matchStats.snapshot;
  const rows = [
    ["Shots", stats.home.shots, stats.away.shots],
    ["Passes completed", `${stats.home.completedPasses}/${stats.home.passes}`, `${stats.away.completedPasses}/${stats.away.passes}`],
    ["Possession", `${Math.round(stats.home.possessionPercent)}%`, `${Math.round(stats.away.possessionPercent)}%`],
    ["Tackles won", stats.home.tackles, stats.away.tackles],
    ["Saves", stats.home.saves, stats.away.saves],
    ["Fouls", stats.home.fouls, stats.away.fouls],
    ["Yellow / red", `${stats.home.yellowCards} / ${stats.home.redCards}`, `${stats.away.yellowCards} / ${stats.away.redCards}`],
    ["Corners", stats.home.corners, stats.away.corners],
    ["Throw-ins", stats.home.throwIns, stats.away.throwIns],
    ["Goal kicks", stats.home.goalKicks, stats.away.goalKicks]
  ];
  resultStatsEl.innerHTML = `<table><thead><tr><th>Match stats</th><th>Real</th><th>City</th></tr></thead><tbody>${rows.map(([label, home, away]) => `<tr><th>${label}</th><td>${home}</td><td>${away}</td></tr>`).join("")}</tbody></table>`;
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
    telemetry: matchStats.snapshot
  };
}

function phase4DebugState() {
  return { flow: matchFlow.debugSnapshot, referee: referee.debugSnapshot(),
    restart: pendingRestart ? { ...pendingRestart, position: pendingRestart.position.toArray(), taker: restartPlacement?.taker?.id } : null,
    stats: matchStats.snapshot, eligiblePlayers: { home: teamPlayers("home").length, away: teamPlayers("away").length },
    ballPosition: ball.position.toArray(), lastTouch: lastTouch?.id ?? null };
}

function phase5DebugState() {
  const sorted = [...frameTimes].sort((a, b) => a - b);
  return { animations: playerAnimations.debugSnapshot(), stadium: stadium.debugSnapshot(), audio: matchAudio.debugSnapshot(), reducedMotion,
    renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, pixelRatio: renderer.getPixelRatio() },
    frames: { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0 } };
}

function phase6DebugState() {
  const squad = squadStore.snapshot;
  return {
    revision: squadStore.revision,
    formation: squad.formationId,
    starters: Object.values(squad.starters),
    overall: teamOverall(squad),
    chemistry: chemistry(squad),
    validation: validateSquad(squad),
    tactics: homeRuntimeTactics(),
    setPieces: { ...squad.setPieces },
    ui: squadUI?.debugSnapshot() ?? null
  };
}

function updatePresentation(dt: number) {
  if (matchState.status === "paused" || document.hidden) return;
  if (!reducedMotion) playerAnimations.update(players, dt * GAME_SPEED, matchState.status === "playing");
  stadium.update(dt, ball.position, ballOwner ? 0 : ball.velocity.length());
  if (goalMomentRemaining > 0) {
    goalMomentRemaining = Math.max(0, goalMomentRemaining - dt);
    goalMomentEl.hidden = goalMomentRemaining === 0;
  }
  dribbleSoundRemaining -= dt;
  if (matchState.status === "playing" && ballOwner && ballOwner.velocity.length() > 2 && dribbleSoundRemaining <= 0) {
    matchAudio.play("kick");
    dribbleSoundRemaining = 0.55;
  }
}

function updateAIDebugPanel() {
  const playerTop = document.querySelector<HTMLElement>(".player-panel")!.getBoundingClientRect().top;
  document.querySelector<HTMLElement>(".game-root")!.style.setProperty("--hud-clean-top", `${playerTop - 38}px`);
  const panelBoundary = playerTop - (window.innerWidth <= 760 ? 42 : 0);
  const settingsTop = aiSettings.getBoundingClientRect().top;
  aiSettings.style.maxHeight = `${Math.max(64, panelBoundary - settingsTop - (aiDebugToggle.checked ? 80 : 12))}px`;
  aiDebugPanel.hidden = !aiDebugToggle.checked;
  if (aiDebugPanel.hidden) return;
  const panelTop = aiSettings.getBoundingClientRect().bottom + 10;
  aiDebugPanel.style.top = `${panelTop}px`;
  aiDebugPanel.style.maxHeight = `${Math.max(20, panelBoundary - panelTop - 10)}px`;
  const debug = phase3DebugState();
  const decisions = debug.decisions;
  const focused = decisions.find((decision) => decision.playerId === ballOwner?.id) ?? decisions.find((decision) => decision.possession === "opponent") ?? decisions[0];
  const teamLine = (team: TeamId) => {
    const t = matchStats.snapshot[team];
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
  const frameDt = clock.getDelta();
  if (!document.hidden && frameDt > 0) { frameTimes.push(frameDt * 1000); if (frameTimes.length > 120) frameTimes.shift(); }
  const rawDt = Math.min(frameDt, 0.04);
  matchAudio.setActive(!document.hidden && matchState.status !== "paused");
  fixedTimestep.advance(rawDt, (fixedDt) => {
    const dt = fixedDt * GAME_SPEED;
    handleActions();
    if (matchState.status === "restart" || matchState.status === "goal" || (matchState.status === "kickoff" && matchFlow.debugSnapshot.kickoffReason === "goal")) {
      referee.recordStoppage(fixedDt);
      matchFlow.addStoppageTime(referee.consumeStoppageSeconds());
    }
    for (const event of matchFlow.update(fixedDt)) {
      if (event.type === "halftime") { nextKickoffTeam = "away"; referee.clearPending(); matchAudio.play("whistle"); addFeed("Half time. Ends remain unchanged in this prototype."); }
      if (event.type === "kickoffSetup") prepareRestart(createRestartPlan({ kind: "kickoff", team: nextKickoffTeam, bounds: { halfWidth: HALF_W, halfLength: HALF_L }, ballRadius: BALL_RADIUS }), false);
      if (event.type === "kickoffReady" || event.type === "restartReady") executeRestart();
      if (event.type === "fullTime") endMatch();
    }
    if (matchState.status !== "playing") return;
    actionClockSeconds += dt;
    const recalled = referee.update(fixedDt, ballOwner?.team ?? null);
    if (recalled) { prepareRestart(recalled); return; }
    if (releaseLock) {
      releaseLock.remaining -= dt;
      if (releaseLock.remaining <= 0) releaseLock = null;
    }
    const input = getInputDirection();
    const sprint = keyboardInput.getState().sprint || Boolean(touchInput?.getState().sprint);
    if (!spectatorMode && !referee.dismissedIds.has(activePlayer.id)) {
      activePlayer.cooldown = Math.max(0, activePlayer.cooldown - dt);
      updatePlayerMovement(activePlayer, input, sprint, dt);
    }
    updateAI(dt);
    processBallActionEvents();
    syncBallActionPresentation();
    if (matchState.status !== "playing") return;
    updateBall(dt);
    if (matchState.status !== "playing") return;
    resolvePossession();
    if (matchState.status !== "playing") return;
    separatePlayers();
    matchStats.addPossession(ballOwner?.team ?? null, fixedDt);
  });
  updateCamera(rawDt);
  updatePresentation(rawDt);
  updateHud();
  if (!isMatchEnded(matchState)) updateMinimap();

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
    phase4: phase4DebugState(),
    phase5: phase5DebugState(),
    phase6: phase6DebugState(),
    stateHash: stateHash({ elapsed: matchState.elapsed, score: matchState.score, owner: matchState.ballOwnerId, active: matchState.activePlayerId, ball: ball.position.toArray(), velocity: ball.velocity.toArray() })
  });
  if (aiDebugToggle.checked && (lastFrameCaptureAt === 0 || now - lastFrameCaptureAt > 2000)) {
    lastFrameCaptureAt = now;
    renderDebugEl.dataset.frame = renderer.domElement.toDataURL("image/jpeg", 0.76);
  }
}

function separatePlayers() {
  separatePlayerCollisions({
    players: eligiblePlayers(),
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
  document.addEventListener("focusin", (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.closest("button, input, select, summary")) return;
    keyboardInput.detach();
    keyboardInput = new KeyboardInput();
  });
  document.addEventListener("focusout", () => {
    queueMicrotask(() => {
      if (!(document.activeElement instanceof HTMLElement) || !document.activeElement.closest("button, input, select, summary")) keyboardInput.attach();
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
  aiSettings.querySelector<HTMLButtonElement>("[data-ai-restart]")!.addEventListener("click", () => resetMatch());
  aiSettings.querySelector<HTMLButtonElement>("[data-match-pause]")!.addEventListener("click", () => {
    togglePause();
  });
  squadOpenButton.addEventListener("click", () => {
    squadPausedMatch = matchFlow.pause();
    matchAudio.setActive(false);
    squadUI.open();
  });
  aiSettings.querySelectorAll<HTMLInputElement>("[data-rule]").forEach((input) => input.addEventListener("change", () => {
    referee.setOptions({ [input.dataset.rule!]: input.checked });
    matchFlow.setStoppageTimeEnabled(referee.options.injuryTime);
  }));
  aiSettings.querySelectorAll("details").forEach((details) => details.addEventListener("toggle", updateAIDebugPanel));
  aiSettings.querySelector<HTMLSelectElement>("[data-weather]")!.addEventListener("change", (event) => {
    stadium.setWeather((event.target as HTMLSelectElement).value as "clear" | "rain");
  });
  motionToggle.addEventListener("change", () => {
    reducedMotion = motionToggle.checked;
    playerAnimations.reset();
    cameraSystem.clearGoalEmphasis();
    stadium.setReducedMotion(reducedMotion);
    document.querySelector(".game-root")!.classList.toggle("reduced-motion", reducedMotion);
  });
  soundEnableButton.addEventListener("click", async () => {
    if (soundBusy) return;
    if (soundEnabled && matchAudio.debugSnapshot().contextState === "running") {
      soundEnabled = false; matchAudio.setMuted(true);
    } else {
      soundBusy = true;
      soundEnableButton.disabled = true;
      soundEnabled = await matchAudio.enable();
      soundBusy = false;
      soundEnableButton.disabled = false;
    }
    soundEnableButton.textContent = soundEnabled ? "Mute sound" : "Enable sound";
    audioStatusEl.textContent = soundEnabled ? "Sound on · pauses with the match." : matchAudio.debugSnapshot().error ?? "Sound off · enable to retry or unmute.";
    if (soundEnabled) matchAudio.play("ui");
  });
  aiSettings.querySelector<HTMLInputElement>("[data-volume]")!.addEventListener("input", (event) => {
    matchAudio.setVolume(Number((event.target as HTMLInputElement).value) / 100);
  });
  aiSettings.querySelector<HTMLButtonElement>("[data-sound-test]")!.addEventListener("click", () => {
    const cue = aiSettings.querySelector<HTMLSelectElement>("[data-sound-cue]")!.value as MatchAudioCue;
    audioStatusEl.textContent = matchAudio.play(cue) ? `Playing ${cue}.` : "Enable sound and resume the match to audition.";
  });
  document.querySelector<HTMLButtonElement>("[data-hud-toggle]")!.addEventListener("click", (event) => {
    const clean = document.querySelector(".game-root")!.classList.toggle("cinematic");
    const button = event.currentTarget as HTMLButtonElement;
    button.textContent = clean ? "Show controls" : "Clean view";
    button.setAttribute("aria-pressed", String(clean));
    matchAudio.play("ui");
    updateAIDebugPanel();
  });
  aiSettings.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button") && !(event.target as HTMLElement).closest("[data-sound-test],[data-sound-enable]")) matchAudio.play("ui");
  });
  document.addEventListener("visibilitychange", () => matchAudio.setActive(!document.hidden && matchState.status !== "paused"));
  window.addEventListener("pagehide", () => matchAudio.setActive(false));
  canvas.addEventListener("pointerdown", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const found = teamPlayers("home").find((player) => raycaster.intersectObject(player.body)[0]);
    if (found && !spectatorMode) setActivePlayer(found);
    canvas.focus();
  });
  touchInput = new TouchInput(stickEl, document.querySelectorAll<HTMLElement>("[data-action]"));
  touchInput.attach();
  restartButton.addEventListener("click", () => resetMatch());
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

window.addEventListener("resize", onResize);

const stadium = addWorldPitch(scene);
stadium.setReducedMotion(reducedMotion);
document.querySelector(".game-root")!.classList.toggle("reduced-motion", reducedMotion);
setupPlayers();
scene.add(ball.mesh);
squadUI = new SquadUI({
  root: squadUIHost,
  store: squadStore,
  onPlay: () => {
    squadPausedMatch = false;
    rebuildHomeSquad();
  },
  onClose: (reason) => {
    if (reason === "close" && squadPausedMatch) matchFlow.resume();
    squadPausedMatch = false;
    matchAudio.setActive(!document.hidden && matchState.status !== "paused");
  }
});
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
    phase3: phase3DebugState(),
    phase4: phase4DebugState(),
    phase5: phase5DebugState(),
    phase6: phase6DebugState()
  })
};
resetMatch();
step();
