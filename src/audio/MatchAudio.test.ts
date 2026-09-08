import { describe, expect, it, vi } from "vitest";
import { MATCH_AUDIO_CUES, MatchAudio } from "./MatchAudio";

function parameter() {
  return {
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
  };
}

function audioNode() { return { connect: vi.fn(), disconnect: vi.fn() }; }
function sourceNode() {
  return { ...audioNode(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null, buffer: null as unknown, loop: false, type: "sine", frequency: parameter() };
}

function fakeContext() {
  const gains: ReturnType<typeof gainNode>[] = [];
  const oscillators: ReturnType<typeof sourceNode>[] = [];
  const buffers: ReturnType<typeof sourceNode>[] = [];
  const filters: ReturnType<typeof filterNode>[] = [];
  function gainNode() { return { ...audioNode(), gain: parameter() }; }
  function filterNode() { return { ...audioNode(), type: "lowpass", frequency: parameter() }; }
  const compressor = { ...audioNode(), threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter() };
  const context = {
    state: "suspended", currentTime: 0, sampleRate: 100, destination: audioNode(),
    resume: vi.fn(async () => { context.state = "running"; }),
    close: vi.fn(async () => { context.state = "closed"; }),
    createGain: vi.fn(() => { const node = gainNode(); gains.push(node); return node; }),
    createOscillator: vi.fn(() => { const node = sourceNode(); oscillators.push(node); return node; }),
    createBufferSource: vi.fn(() => { const node = sourceNode(); buffers.push(node); return node; }),
    createBiquadFilter: vi.fn(() => { const node = filterNode(); filters.push(node); return node; }),
    createDynamicsCompressor: vi.fn(() => compressor),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
  };
  const factory = vi.fn(() => context as unknown as AudioContext);
  return { context, factory, gains, oscillators, buffers, filters, compressor };
}

describe("MatchAudio", () => {
  it("does not create AudioContext or queue cues before explicit enable", () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    for (const cue of MATCH_AUDIO_CUES) expect(audio.play(cue)).toBe(false);
    audio.setMuted(false);
    audio.setVolume(0.8);
    audio.setActive(true);
    expect(mock.factory).not.toHaveBeenCalled();
    expect(audio.debugSnapshot()).toMatchObject({ enabled: false, contextState: "not-created", played: 0 });
  });

  it("unlocks once, starts one crowd loop, and connects a protective compressor", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    const first = audio.enable();
    const second = audio.enable();
    expect(mock.context.resume).toHaveBeenCalledTimes(1);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await audio.enable()).toBe(true);
    expect(mock.factory).toHaveBeenCalledTimes(1);
    expect(mock.buffers).toHaveLength(1);
    expect(mock.buffers[0].loop).toBe(true);
    expect(mock.buffers[0].start).toHaveBeenCalledTimes(1);
    expect(mock.gains[0].connect).toHaveBeenCalledWith(mock.compressor);
    expect(audio.debugSnapshot()).toMatchObject({ enabled: true, muted: false, ambience: true, contextState: "running" });
  });

  it("reports unavailable audio and unlock rejection without throwing", async () => {
    const absent = new MatchAudio({ contextFactory: () => { throw new Error("Not supported"); } });
    await expect(absent.enable()).resolves.toBe(false);
    expect(absent.debugSnapshot().error).toBe("Not supported");
    const mock = fakeContext();
    mock.context.resume.mockRejectedValueOnce(new Error("Gesture required"));
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await expect(audio.enable()).resolves.toBe(false);
    expect(audio.debugSnapshot()).toMatchObject({ enabled: false, muted: true, error: "Gesture required", ambience: false });
    expect(mock.context.close).toHaveBeenCalledTimes(1);
    await expect(audio.enable()).resolves.toBe(true);
  });

  it("rejects a resume that leaves the context suspended", async () => {
    const mock = fakeContext();
    mock.context.resume.mockImplementationOnce(async () => {});
    const audio = new MatchAudio({ contextFactory: mock.factory });
    expect(await audio.enable()).toBe(false);
    expect(audio.debugSnapshot().error).toContain("remains suspended");
  });

  it("synthesizes nine distinct cues with envelopes and disconnects ended voices", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    for (const cue of MATCH_AUDIO_CUES) {
      mock.context.currentTime += 2;
      expect(audio.play(cue)).toBe(true);
      const source = cue === "tackle" ? mock.buffers[mock.buffers.length - 1] : mock.oscillators[mock.oscillators.length - 1];
      expect(source.start).toHaveBeenCalledWith(mock.context.currentTime);
      expect(source.stop).toHaveBeenCalledTimes(1);
      const gain = mock.gains[mock.gains.length - 1];
      expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
      expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledTimes(1);
      source.onended!();
      expect(source.disconnect).toHaveBeenCalledTimes(1);
      expect(gain.disconnect).toHaveBeenCalledTimes(1);
      expect(audio.debugSnapshot().voices).toBe(0);
    }
    expect(MATCH_AUDIO_CUES).toHaveLength(9);
    expect(audio.debugSnapshot().played).toBe(9);
    expect(new Set(mock.oscillators.map(node => node.frequency.setValueAtTime.mock.calls[0][0])).size).toBe(8);
  });

  it("silences and clears live voices on mute or pause without queued bursts", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    audio.play("goal");
    audio.setMuted(true);
    expect(mock.oscillators[0].disconnect).toHaveBeenCalled();
    expect(mock.gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0, 0);
    expect(audio.play("shot")).toBe(false);
    audio.setMuted(false);
    expect(audio.debugSnapshot().voices).toBe(0);
    expect(audio.play("pass")).toBe(true);
    audio.setActive(false);
    expect(audio.play("whistle")).toBe(false);
    expect(audio.debugSnapshot().voices).toBe(0);
    audio.setActive(true);
    expect(audio.debugSnapshot().voices).toBe(0);
    expect(mock.buffers).toHaveLength(1);
    mock.context.state = "suspended";
    expect(audio.play("ui")).toBe(false);
  });

  it("clamps volume and blocks silent playback", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    audio.setVolume(2);
    expect(audio.debugSnapshot().volume).toBe(1);
    audio.setVolume(NaN);
    expect(audio.debugSnapshot().volume).toBe(1);
    audio.setVolume(-1);
    expect(audio.debugSnapshot().volume).toBe(0);
    expect(audio.play("kick")).toBe(false);
  });

  it("varies event strength and distance without affecting the opt-in mixer contract", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    expect(audio.playEvent("kick", { strength: 1.5, distance: 0 })).toBe(true);
    const near = mock.gains[mock.gains.length - 1].gain.linearRampToValueAtTime.mock.calls[0][0];
    mock.context.currentTime += 1;
    expect(audio.playEvent("kick", { strength: 0.5, distance: 70 })).toBe(true);
    const far = mock.gains[mock.gains.length - 1].gain.linearRampToValueAtTime.mock.calls[0][0];
    expect(near).toBeGreaterThan(far);
    expect(audio.debugSnapshot().played).toBe(2);
  });

  it("does not retrigger envelopes when frame updates repeat the same state", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    audio.play("goal");
    const fadeCount = mock.gains[0].gain.linearRampToValueAtTime.mock.calls.length;
    for (let frame = 0; frame < 120; frame++) {
      audio.setActive(true);
      audio.setMuted(false);
      audio.setVolume(0.55);
    }
    expect(mock.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledTimes(fadeCount);
    expect(audio.debugSnapshot().voices).toBe(1);
    expect(mock.buffers).toHaveLength(1);
  });

  it("enables while paused without audible cues and resumes an interrupted context only on enable", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    audio.setActive(false);
    expect(await audio.enable()).toBe(true);
    expect(audio.play("ui")).toBe(false);
    expect(mock.gains[0].gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    audio.setActive(true);
    expect(audio.play("ui")).toBe(true);
    mock.context.state = "suspended";
    expect(audio.play("goal")).toBe(false);
    expect(mock.context.resume).toHaveBeenCalledTimes(1);
    expect(await audio.enable()).toBe(true);
    expect(mock.context.resume).toHaveBeenCalledTimes(2);
    expect(mock.oscillators[0].disconnect).toHaveBeenCalled();
    expect(audio.debugSnapshot().voices).toBe(0);
    expect(mock.factory).toHaveBeenCalledTimes(1);
    expect(mock.buffers).toHaveLength(1);
  });

  it("keeps cleanup rejections contained", async () => {
    const mock = fakeContext();
    mock.context.close.mockRejectedValueOnce(new Error("Already closing"));
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    audio.dispose();
    await Promise.resolve();
    expect(audio.debugSnapshot()).toMatchObject({ enabled: false, contextState: "disposed", voices: 0, ambience: false });
  });

  it("caps polyphony, throttles rapid AI cues, and resets without rebuilding ambience", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory, maxVoices: 2 });
    await audio.enable();
    expect(audio.play("pass")).toBe(true);
    expect(audio.play("pass")).toBe(false);
    expect(audio.play("shot")).toBe(true);
    expect(audio.play("goal")).toBe(false);
    expect(audio.debugSnapshot()).toMatchObject({ voices: 2, dropped: 2 });
    audio.reset();
    expect(audio.debugSnapshot()).toMatchObject({ voices: 0, dropped: 0, played: 0, ambience: true, muted: false });
    expect(audio.play("pass")).toBe(true);
    expect(mock.buffers).toHaveLength(1);
  });

  it("disconnects every mixer resource and cannot reopen after disposal", async () => {
    const mock = fakeContext();
    const audio = new MatchAudio({ contextFactory: mock.factory });
    await audio.enable();
    audio.play("kick");
    audio.dispose();
    expect(mock.buffers[0].stop).toHaveBeenCalled();
    expect(mock.buffers[0].disconnect).toHaveBeenCalled();
    expect(mock.filters[0].disconnect).toHaveBeenCalled();
    for (const gain of mock.gains) expect(gain.disconnect).toHaveBeenCalled();
    expect(mock.compressor.disconnect).toHaveBeenCalled();
    expect(mock.context.close).toHaveBeenCalledTimes(1);
    expect(await audio.enable()).toBe(false);
    expect(audio.play("ui")).toBe(false);
    audio.dispose();
    expect(mock.context.close).toHaveBeenCalledTimes(1);
  });

  it("does not initialize nodes when disposed while unlock is pending", async () => {
    const mock = fakeContext();
    let finish!: () => void;
    mock.context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const audio = new MatchAudio({ contextFactory: mock.factory });
    const result = audio.enable();
    audio.dispose();
    finish();
    expect(await result).toBe(false);
    expect(mock.context.createGain).not.toHaveBeenCalled();
    expect(audio.debugSnapshot().contextState).toBe("disposed");
  });
});
