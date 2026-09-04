import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FootballAISystem, type AIContext } from "./AISystem";
import type { SimPlayer } from "./types";
import type { TeamData } from "../../data/types";

function player(id: string, team: "home" | "away", x: number, z: number, role: SimPlayer["role"] = "FWD"): SimPlayer {
  return { id, team, role, short: id, number: 7, position: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), mesh: new THREE.Group(), body: new THREE.Mesh(), hasBall: false, stamina: 1, cooldown: 0, intent: "hold", stats: { pace: 75, shooting: 90, passing: 85, dribbling: 75, defending: 75, physical: 75 } };
}
function context(players: SimPlayer[], owner: SimPlayer | null): AIContext {
  const team = (id: "home" | "away"): TeamData => ({ id, attackingDirection: id === "home" ? 1 : -1, name: id, short: id, primary: 0, secondary: 0, accent: 0, players: [] });
  return { players, ballOwner: owner, activePlayer: null, ball: { position: owner?.position.clone() ?? new THREE.Vector3(), velocity: new THREE.Vector3(), mesh: new THREE.Mesh() }, teams: { home: team("home"), away: team("away") }, bounds: { halfWidth: 36, halfLength: 56 }, playerRadius: 0.75, dt: 0.05, random: () => 0.5, onPass: vi.fn(), onShoot: vi.fn(), onTackle: vi.fn(), onClear: vi.fn() };
}
const step = (system: FootballAISystem, ctx: AIContext, count: number) => { for (let i = 0; i < count; i++) system.update(ctx); };

describe("FootballAISystem runtime", () => {
  it("reacts before making a contextual shot and executes only once per decision", () => {
    const striker = player("striker", "home", 0, 47);
    const ctx = context([striker, player("defender", "away", 20, 15)], striker);
    const system = new FootballAISystem("normal");
    system.update(ctx);
    expect(system.getDebugState().decisions.find((d) => d.playerId === striker.id)?.action).toBe("shoot");
    expect(ctx.onShoot).not.toHaveBeenCalled();
    step(system, ctx, 5);
    expect(ctx.onShoot).not.toHaveBeenCalled();
    step(system, ctx, 3);
    expect(ctx.onShoot).toHaveBeenCalledTimes(1);
    expect(system.getDebugState().actionCounts.shoot).toBe(1);
  });
  it("passes to the chosen open progressive teammate", () => {
    const carrier = player("carrier", "home", 0, -10);
    const receiver = player("receiver", "home", 9, 8);
    const ctx = context([carrier, receiver, player("opponent", "away", -7, -10)], carrier);
    const system = new FootballAISystem("hard");
    step(system, ctx, 5);
    expect(ctx.onPass).toHaveBeenCalledWith(carrier, receiver);
  });
  it("never shoots from its own half and uses a clearance under danger", () => {
    const carrier = player("carrier", "home", 0, -51, "DEF");
    const ctx = context([carrier, player("pressing", "away", 1, -51)], carrier);
    const system = new FootballAISystem("hard");
    step(system, ctx, 5);
    expect(ctx.onClear).toHaveBeenCalledWith(carrier);
    expect(ctx.onShoot).not.toHaveBeenCalled();
  });
  it("invalidates an unexecuted shot when possession changes", () => {
    const striker = player("striker", "home", 0, 47);
    const defender = player("defender", "away", 12, 35);
    const ctx = context([striker, defender], striker);
    const system = new FootballAISystem();
    system.update(ctx);
    ctx.ballOwner = defender;
    step(system, ctx, 10);
    expect(ctx.onShoot).not.toHaveBeenCalled();
    expect(system.getDebugState().decisions.find((d) => d.playerId === striker.id)?.possession).toBe("opponent");
  });
  it("excludes the controlled player and caps coordinated pressing at two", () => {
    const carrier = player("carrier", "away", 0, 0);
    const defenders = [0, 1, 2, 3, 4].map((i) => player(`defender${i}`, "home", i * 2, -3, "DEF"));
    const ctx = context([carrier, ...defenders], carrier);
    ctx.activePlayer = defenders[0];
    const original = defenders[0].position.clone();
    const system = new FootballAISystem();
    step(system, ctx, 12);
    expect(defenders[0].position.equals(original)).toBe(true);
    expect(system.getDebugState().decisions.some((d) => d.playerId === defenders[0].id)).toBe(false);
    expect(system.getDebugState().spatial?.home.presserCount).toBe(2);
    expect(defenders.filter((p) => p.intent === "chase")).toHaveLength(2);
    expect(ctx.onTackle).toHaveBeenCalled();
  });
  it("sends a loose-ball recovery player outside the ordinary pressing radius", () => {
    const chaser = player("chaser", "home", 0, -45);
    const ctx = context([chaser, player("cover", "home", 25, -45, "DEF")], null);
    ctx.ball.position.z = 30;
    const system = new FootballAISystem();
    step(system, ctx, 10);
    expect(chaser.intent).toBe("chase");
    expect(chaser.position.z).toBeGreaterThan(-45);
    expect(system.getDebugState().spatial?.home.presserCount).toBe(1);
  });
  it("changes reaction behavior with difficulty, and reset removes old match state", () => {
    const carrier = player("carrier", "home", 0, 47);
    const ctx = context([carrier], carrier);
    const system = new FootballAISystem("easy");
    system.update(ctx);
    const easyDelay = system.getDebugState().decisions[0].reactionDelayMs;
    system.setDifficulty("hard");
    system.update(ctx);
    expect(system.getDebugState().decisions[0].reactionDelayMs).toBeLessThan(easyDelay);
    expect(() => JSON.stringify(system.getDebugState())).not.toThrow();
    step(system, ctx, 5);
    system.reset();
    expect(system.getDebugState()).toMatchObject({ nowMs: 0, possession: null, decisions: [], spatial: null, actionCounts: { shoot: 0, pass: 0 } });
  });
});
