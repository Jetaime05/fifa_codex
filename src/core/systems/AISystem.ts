import * as THREE from "three";
import type { TeamData } from "../../data/types";
import type { FieldBounds, SimBall, SimPlayer } from "./types";
import { updatePlayerMovement } from "./MovementSystem";
import { getGoalkeeperTargetPosition, getGoalLineZ, type GoalkeeperConfig } from "./GoalkeeperSystem";

export type AIContext = {
  players: SimPlayer[];
  ball: SimBall;
  ballOwner: SimPlayer | null;
  activePlayer: SimPlayer;
  teams: Record<"home" | "away", TeamData>;
  bounds: FieldBounds;
  playerRadius: number;
  dt: number;
  random: (min: number, max: number) => number;
  /** Optional Phase 2E tuning; defaults keep the Phase 1 behavior playable. */
  goalkeeperConfig?: Partial<GoalkeeperConfig>;
  onPass?: (player: SimPlayer) => void;
  onShoot?: (player: SimPlayer) => void;
  onTackle?: (player: SimPlayer) => void;
};

const nearest = (players: SimPlayer[], position: THREE.Vector3) => players.reduce((best, p) => p.position.distanceToSquared(position) < best.position.distanceToSquared(position) ? p : best, players[0]);

/** Lightweight team-shape AI extracted from the runtime. Actions remain injected by the orchestrator. */
export function updateAI(context: AIContext) {
  const { players, ball, ballOwner, activePlayer, teams, bounds, playerRadius, dt, random, goalkeeperConfig } = context;
  for (const player of players) {
    if (player === activePlayer) continue;
    player.cooldown = Math.max(0, player.cooldown - dt);
    const team = teams[player.team];
    const teammates = players.filter((p) => p.team === player.team);
    const opponents = players.filter((p) => p.team !== player.team);
    let target = player.home.clone();
    target.z = THREE.MathUtils.clamp(target.z + (ballOwner?.team === player.team ? team.attackingDirection * 8 : -team.attackingDirection * 3), -bounds.halfLength + 5, bounds.halfLength - 5);
    target.x = THREE.MathUtils.clamp(target.x + ball.position.x * 0.12, -bounds.halfWidth + 4, bounds.halfWidth - 4);
    let sprint = false;
    if (player.role === "GK") {
      // Keepers now align to the ball/goal angle and step out as danger
      // approaches.  The old close-ball interception remains below so this
      // upgrade does not remove the existing claim behavior.
      target = getGoalkeeperTargetPosition({ keeper: player, ball, bounds, config: goalkeeperConfig });
      const goalZ = getGoalLineZ(player.team, bounds);
      if (Math.abs(ball.position.z - goalZ) < 24 && player.position.distanceTo(ball.position) < 7.4) { target = ball.position.clone(); sprint = true; }
      player.intent = "keeper";
      if (ballOwner === player && player.cooldown <= 0) { context.onPass?.(player); player.cooldown = 1.2; }
    } else if (!ballOwner) {
      if (nearest(teammates, ball.position) === player) { target = ball.position.clone(); sprint = true; player.intent = "chase"; }
      else player.intent = "return";
    } else if (ballOwner === player) {
      target.z += team.attackingDirection * 12; sprint = true; player.intent = "support";
      if (player.cooldown <= 0) {
        if (Math.abs(target.z) > bounds.halfLength - 22 && Math.abs(player.position.x) < 18 && random(0, 1) > 0.55) context.onShoot?.(player);
        else if (random(0, 1) < 0.04) context.onPass?.(player);
        player.cooldown = 1;
      }
    } else if (ballOwner.team !== player.team) {
      const marker = nearest(teammates, ballOwner.position);
      if (marker === player || player.position.distanceTo(ballOwner.position) < 8) { target = ballOwner.position.clone(); sprint = true; player.intent = "chase"; if (player.cooldown <= 0 && player.position.distanceTo(ballOwner.position) < 2.7) { context.onTackle?.(player); player.cooldown = 0.9; } }
      else player.intent = "return";
    } else {
      player.intent = "support";
      if (player.role === "FWD" || player.role === "MID") { target.z += team.attackingDirection * random(3, 8); target.x += random(-4, 4); }
    }
    const direction = target.sub(player.position);
    updatePlayerMovement({ player, inputDirection: direction.length() > 1.1 ? direction : new THREE.Vector3(), sprint, dt, bounds, playerRadius, isControlled: false, hasBall: ballOwner === player });
    void opponents;
  }
}
