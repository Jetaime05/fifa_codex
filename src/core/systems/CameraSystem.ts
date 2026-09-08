import * as THREE from "three";
import type { CameraMode } from "../match/MatchState";
import type { SimBall, SimPlayer } from "./types";

export type CameraFramingLimits = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type CameraBroadcastPreset = {
  /** Legacy scale terms remain in the contract for saved overrides. */
  height: number;
  xScale: number;
  zScale: number;
  zOffset: number;
  ballWeight: number;
  activeWeight: number;
  lookAheadZ: number;
  smoothing: number;
  /** Sideline broadcast placement and anticipatory framing. */
  sidelineX: number;
  sidelineHeight: number;
  sidelineDistance: number;
  anticipation: number;
};

export type CameraFollowPreset = {
  distance: number;
  height: number;
  lookAhead: number;
  ballWeight: number;
  smoothing: number;
};

export type CameraFeelConfig = {
  broadcast: CameraBroadcastPreset;
  follow: CameraFollowPreset;
  framing: CameraFramingLimits;
  goalEmphasis: {
    duration: number;
    strength: number;
    zoom: number;
  };
};

export type CameraFeelConfigOverrides = {
  broadcast?: Partial<CameraBroadcastPreset>;
  follow?: Partial<CameraFollowPreset>;
  framing?: Partial<CameraFramingLimits>;
  goalEmphasis?: Partial<CameraFeelConfig["goalEmphasis"]>;
};

export const DEFAULT_CAMERA_CONFIG: Readonly<CameraFeelConfig> = Object.freeze({
  broadcast: Object.freeze({
    // A high sideline position keeps the pitch length running across the
    // screen while retaining a readable ball and passing lanes.
    height: 44,
    xScale: 0.28,
    zScale: 0.42,
    zOffset: -38,
    ballWeight: 0.72,
    activeWeight: 0.28,
    lookAheadZ: 8,
    smoothing: 3.8,
    sidelineX: 58,
    sidelineHeight: 31,
    sidelineDistance: 10,
    anticipation: 0.42
  }),
  follow: Object.freeze({
    distance: 11,
    height: 7.2,
    lookAhead: 8,
    ballWeight: 0.35,
    smoothing: 7
  }),
  // The limits cover the whole pitch while keeping the camera above the
  // stadium floor. They are configurable for smaller mobile layouts and
  // future indoor venues.
  framing: Object.freeze({
    minX: -84,
    maxX: 84,
    minY: 5,
    maxY: 120,
    minZ: -82,
    maxZ: 82
  }),
  goalEmphasis: Object.freeze({
    duration: 0.9,
    strength: 0.28,
    zoom: 0.16
  })
});

export function resolveCameraConfig(overrides?: CameraFeelConfigOverrides): CameraFeelConfig {
  return {
    broadcast: { ...DEFAULT_CAMERA_CONFIG.broadcast, ...(overrides?.broadcast ?? {}) },
    follow: { ...DEFAULT_CAMERA_CONFIG.follow, ...(overrides?.follow ?? {}) },
    framing: { ...DEFAULT_CAMERA_CONFIG.framing, ...(overrides?.framing ?? {}) },
    goalEmphasis: { ...DEFAULT_CAMERA_CONFIG.goalEmphasis, ...(overrides?.goalEmphasis ?? {}) }
  };
}

export type CameraEmphasisState = {
  remaining: number;
  duration: number;
  strength: number;
  target: THREE.Vector3 | null;
  smoothedLookAt: THREE.Vector3 | null;
};

export function createCameraState(): CameraEmphasisState {
  return {
    remaining: 0,
    duration: 0,
    strength: 0,
    target: null,
    smoothedLookAt: null
  };
}

export function triggerGoalEmphasis(
  state: CameraEmphasisState,
  options: { duration?: number; strength?: number; target?: THREE.Vector3 } = {}
) {
  state.duration = Math.max(0.01, options.duration ?? DEFAULT_CAMERA_CONFIG.goalEmphasis.duration);
  state.remaining = state.duration;
  state.strength = Math.max(0, options.strength ?? DEFAULT_CAMERA_CONFIG.goalEmphasis.strength);
  state.target = options.target?.clone() ?? null;
  return state;
}

export function clearGoalEmphasis(state: CameraEmphasisState) {
  state.remaining = 0;
  state.duration = 0;
  state.strength = 0;
  state.target = null;
}

export function clampCameraPosition(position: THREE.Vector3, limits: CameraFramingLimits = DEFAULT_CAMERA_CONFIG.framing) {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(position.x, limits.minX, limits.maxX),
    THREE.MathUtils.clamp(position.y, limits.minY, limits.maxY),
    THREE.MathUtils.clamp(position.z, limits.minZ, limits.maxZ)
  );
}

export type CameraTargets = {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  smoothing: number;
};

function getSafeForward(player: SimPlayer, playerForward: (player: SimPlayer) => THREE.Vector3) {
  const forward = playerForward(player).clone();
  forward.y = 0;
  if (forward.lengthSq() < 0.0001) {
    forward.set(0, 0, player.team === "home" ? 1 : -1);
  }
  return forward.normalize();
}

export function getCameraTargets(
  mode: CameraMode,
  ball: SimBall,
  activePlayer: SimPlayer,
  playerForward: (player: SimPlayer) => THREE.Vector3,
  config: CameraFeelConfigOverrides | CameraFeelConfig = {}
): CameraTargets {
  // Accept a fully resolved config as well as the ergonomic partial form.
  const resolved = "goalEmphasis" in config && "framing" in config
    ? config as CameraFeelConfig
    : resolveCameraConfig(config as CameraFeelConfigOverrides);

  if (mode === "broadcast") {
    const preset = resolved.broadcast;
    const ballWeight = THREE.MathUtils.clamp(preset.ballWeight, 0, 1);
    const activeWeight = THREE.MathUtils.clamp(preset.activeWeight, 0, 1);
    const focusZ = ball.position.z * ballWeight + activePlayer.position.z * activeWeight;
    const velocityLead = Number.isFinite(ball.velocity.z)
      ? THREE.MathUtils.clamp(ball.velocity.z * 0.22, -6, 6)
      : 0;
    const anticipation = THREE.MathUtils.clamp(preset.anticipation, 0, 1);
    const lookAhead = preset.lookAheadZ + velocityLead * anticipation;
    const position = new THREE.Vector3(
      preset.sidelineX,
      preset.sidelineHeight,
      // The camera stays on the same sideline when possession changes. Only
      // the bounded tracking focus moves along the pitch length.
      focusZ - preset.sidelineDistance
    );
    const lookAt = new THREE.Vector3(
      ball.position.x * ballWeight + activePlayer.position.x * activeWeight,
      2.2,
      focusZ + lookAhead
    );
    return { position: clampCameraPosition(position, resolved.framing), lookAt, smoothing: preset.smoothing };
  }

  const preset = resolved.follow;
  const forward = getSafeForward(activePlayer, playerForward);
  const position = activePlayer.position.clone().addScaledVector(forward, -preset.distance);
  position.y = preset.height;
  const lookAt = activePlayer.position.clone().addScaledVector(forward, preset.lookAhead);
  lookAt.lerp(ball.position, THREE.MathUtils.clamp(preset.ballWeight, 0, 1));
  lookAt.y = 1.8;
  return { position: clampCameraPosition(position, resolved.framing), lookAt, smoothing: preset.smoothing };
}

function updateEmphasis(state: CameraEmphasisState | undefined, dt: number) {
  if (!state || state.remaining <= 0) return 0;
  state.remaining = Math.max(0, state.remaining - Math.max(0, dt));
  const progress = state.duration > 0 ? state.remaining / state.duration : 0;
  // Ease out, so the shot/restart has a clear first beat without a hard snap
  // at the end of the moment.
  return state.strength * progress * progress;
}

export type CameraUpdateOptions = {
  config?: CameraFeelConfigOverrides | CameraFeelConfig;
  state?: CameraEmphasisState;
};

/**
 * Updates either the broadcast or follow camera with frame-rate independent
 * smoothing. The original six-argument call remains valid for Phase 1.
 */
export function updateCamera(
  camera: THREE.PerspectiveCamera,
  mode: CameraMode,
  ball: SimBall,
  activePlayer: SimPlayer,
  playerForward: (player: SimPlayer) => THREE.Vector3,
  dt: number,
  options: CameraUpdateOptions = {}
) {
  const config = options.config ?? DEFAULT_CAMERA_CONFIG;
  const targets = getCameraTargets(mode, ball, activePlayer, playerForward, config);
  const emphasis = updateEmphasis(options.state, dt);

  let desiredPosition = targets.position;
  let desiredLookAt = targets.lookAt;
  if (emphasis > 0) {
    const focus = options.state?.target?.clone() ?? ball.position.clone();
    focus.y = 1.8;
    desiredLookAt = desiredLookAt.clone().lerp(focus, THREE.MathUtils.clamp(emphasis, 0, 1));
    const offset = desiredPosition.clone().sub(focus);
    desiredPosition = focus.clone().add(offset.multiplyScalar(1 - Math.min(resolveCameraConfig(config as CameraFeelConfigOverrides).goalEmphasis.zoom, 0.8) * emphasis));
  }
  const resolved = "goalEmphasis" in config && "framing" in config
    ? config as CameraFeelConfig
    : resolveCameraConfig(config as CameraFeelConfigOverrides);
  desiredPosition = clampCameraPosition(desiredPosition, resolved.framing);

  const alpha = 1 - Math.exp(-Math.max(0, targets.smoothing) * Math.max(0, dt));
  camera.position.lerp(desiredPosition, THREE.MathUtils.clamp(alpha, 0, 1));
  if (options.state) {
    if (!options.state.smoothedLookAt) options.state.smoothedLookAt = desiredLookAt.clone();
    options.state.smoothedLookAt.lerp(desiredLookAt, THREE.MathUtils.clamp(alpha, 0, 1));
    camera.lookAt(options.state.smoothedLookAt);
  } else {
    camera.lookAt(desiredLookAt);
  }
  return { position: desiredPosition, lookAt: desiredLookAt, emphasis };
}

/** Configured facade for callers that want persistent goal emphasis state. */
export class CameraSystem {
  readonly config: CameraFeelConfig;
  readonly state: CameraEmphasisState;

  constructor(config?: CameraFeelConfigOverrides) {
    this.config = resolveCameraConfig(config);
    this.state = createCameraState();
  }

  goalEmphasis(target?: THREE.Vector3, options: { duration?: number; strength?: number } = {}) {
    return triggerGoalEmphasis(this.state, { ...options, target });
  }

  clearGoalEmphasis() {
    clearGoalEmphasis(this.state);
  }

  update(
    camera: THREE.PerspectiveCamera,
    mode: CameraMode,
    ball: SimBall,
    activePlayer: SimPlayer,
    playerForward: (player: SimPlayer) => THREE.Vector3,
    dt: number
  ) {
    return updateCamera(camera, mode, ball, activePlayer, playerForward, dt, { config: this.config, state: this.state });
  }
}

export { CameraSystem as CameraController };
