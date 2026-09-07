import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FootballAISystem, type AIContext } from "./AISystem";
import type { SimPlayer } from "./types";
import type { TeamData } from "../../data/types";

function player(id: string, team: "home" | "away", x: number, z: number, role: SimPlayer["role"] = "FWD"): SimPlayer {
  return { id, team, role, short: id, number: 7, position: new THREE.Vector3(x, 0, z), home: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3(), mesh: new THREE.Group(), body: new THREE.Mesh(), hasBall: false, stamina: 1, cooldown: 0, intent: "hold", stats: { pace: 75, shooting: 90, passing: 85, dribbling: 75, defending: 75, physical: 75 } };
}
function context(players: SimPlayer[], owner: SimPlayer | null, tactics?: AIContext["tactics"]): AIContext {
  const team = (id: "home" | "away"): TeamData => ({ id, attackingDirection: id === "home" ? 1 : -1, name: id, short: id, primary: 0, secondary: 0, accent: 0, players: [] });
  return { players, ballOwner: owner, activePlayer: null, ball: { position: owner?.position.clone() ?? new THREE.Vector3(), velocity: new THREE.Vector3(), mesh: new THREE.Mesh() }, teams: { home: team("home"), away: team("away") }, bounds: { halfWidth: 36, halfLength: 56 }, playerRadius: 0.75, dt: 0.05, random: () => 0.5, tactics, onPass: vi.fn(), onShoot: vi.fn(), onTackle: vi.fn(), onClear: vi.fn() };
}
const step = (system: FootballAISystem, ctx: AIContext, count: number) => { for (let i = 0; i < count; i++) system.update(ctx); };

describe("FootballAISystem runtime", () => {
  it("does not mutate a stopped match or continue moving stale players after a referee restart", () => {
    const defender = player("defender", "home", 0, -1, "DEF");
    const carrier = player("carrier", "away", 0, 0);
    const cover = player("cover", "home", 10, -15, "DEF");
    const ctx = context([defender, carrier, cover], carrier);
    ctx.activePlayer = carrier;
    const system = new FootballAISystem("hard");
    let playing = true;
    ctx.shouldContinue = () => playing;
    const resetPositions = [new THREE.Vector3(-20, 0, -20), new THREE.Vector3(5, 0, 5), new THREE.Vector3(20, 0, -20)];
    ctx.onTackle = vi.fn(() => {
      playing = false;
      ctx.players.forEach((p, index) => { p.position.copy(resetPositions[index]); p.velocity.set(0, 0, 0); p.cooldown = 0; });
      system.reset();
    });
    step(system, ctx, 12);
    expect(ctx.onTackle).toHaveBeenCalledTimes(1);
    ctx.players.forEach((p, index) => {
      expect(p.position.equals(resetPositions[index])).toBe(true);
      expect(p.velocity.length()).toBe(0);
      expect(p.cooldown).toBe(0);
    });
    expect(system.getDebugState()).toMatchObject({ nowMs: 0, decisions: [], actionCounts: { press: 0 } });
  });

  it("aborts immediately after goalkeeper callback changes eligibility", () => {
    const keeper = player("keeper", "home", 0, -48, "GK");
    const teammate = player("teammate", "home", 12, -20);
    const ctx = context([keeper, teammate], keeper);
    let eligible = true;
    ctx.shouldContinue = () => eligible;
    ctx.onPass = vi.fn(() => { eligible = false; });
    const positions = ctx.players.map(p => p.position.clone());
    const system = new FootballAISystem();
    system.update(ctx);
    expect(ctx.onPass).toHaveBeenCalledOnce();
    expect(keeper.cooldown).toBe(0);
    ctx.players.forEach((p, index) => expect(p.position.equals(positions[index])).toBe(true));
  });

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
  it("lets runtime pressing intensity change coordinated slots without exceeding two", () => {
    const carrier = player("carrier", "away", 0, 0);
    const defenders = [0, 1, 2, 3].map((i) => player(`defender${i}`, "home", i * 2, -3, "DEF"));
    const profile = (pressingIntensity: number) => ({
      home: { defensiveLine: 50, pressingIntensity, buildUpSpeed: 50, passingStyle: "balanced" as const, attackWidth: 50, instructions: {} },
      away: { defensiveLine: 50, pressingIntensity: 50, buildUpSpeed: 50, passingStyle: "balanced" as const, attackWidth: 50, instructions: {} }
    });
    const lowContext = context([carrier, ...defenders.map((p) => ({ ...p, position: p.position.clone(), home: p.home.clone() }))], carrier, profile(0));
    const lowSystem = new FootballAISystem();
    lowSystem.update(lowContext);
    expect(lowSystem.getDebugState().spatial?.home.presserCount).toBe(0);

    const highCarrier = player("carrier", "away", 0, 0);
    const highDefenders = [0, 1, 2, 3].map((i) => player(`defender${i}`, "home", i * 2, -3, "DEF"));
    const highContext = context([highCarrier, ...highDefenders], highCarrier, profile(100));
    const highSystem = new FootballAISystem();
    highSystem.update(highContext);
    expect(highSystem.getDebugState().spatial?.home.presserCount).toBe(2);
    expect(highSystem.getDebugState().spatial?.home.presserCount).toBeLessThanOrEqual(2);
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
