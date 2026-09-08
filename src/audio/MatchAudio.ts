export const MATCH_AUDIO_CUES = ["kick", "pass", "shot", "tackle", "whistle", "goal", "ui", "save", "fulltime"] as const;
export type MatchAudioCue = typeof MATCH_AUDIO_CUES[number];

type CueShape = { duration: number; level: number; frequency: number; endFrequency: number; wave: OscillatorType | "noise"; notes?: number[] };
const CUES: Record<MatchAudioCue, CueShape> = {
  kick: { duration: 0.11, level: 0.28, frequency: 145, endFrequency: 45, wave: "sine" },
  pass: { duration: 0.075, level: 0.16, frequency: 330, endFrequency: 105, wave: "triangle" },
  shot: { duration: 0.22, level: 0.18, frequency: 180, endFrequency: 38, wave: "sawtooth" },
  tackle: { duration: 0.17, level: 0.24, frequency: 0, endFrequency: 0, wave: "noise" },
  whistle: { duration: 0.55, level: 0.11, frequency: 2200, endFrequency: 1900, wave: "sine", notes: [2200, 2050, 2250] },
  goal: { duration: 1.25, level: 0.15, frequency: 392, endFrequency: 784, wave: "triangle", notes: [392, 494, 587, 784] },
  ui: { duration: 0.13, level: 0.09, frequency: 650, endFrequency: 950, wave: "sine", notes: [650, 950] },
  save: { duration: 0.24, level: 0.14, frequency: 260, endFrequency: 620, wave: "triangle" },
  fulltime: { duration: 1.1, level: 0.10, frequency: 1900, endFrequency: 1700, wave: "sine", notes: [2100, 1750, 2100, 1750] },
};

export interface MatchAudioOptions {
  contextFactory?: () => AudioContext;
  maxVoices?: number;
}

export type MatchAudioEventOptions = {
  /** Event intensity; 1 is the authored cue level. */
  strength?: number;
  /** Approximate pitch-to-listener distance in gameplay units. */
  distance?: number;
};

/** Semantic contact actions used by the simulation/presentation boundary. */
export type MatchAudioContactAction =
  | "kick" | "pass" | "cross" | "shot" | "header" | "volley" | "clearance" | "tackle" | "save";

type Voice = { source: AudioScheduledSourceNode; gain: GainNode };

/** Small, asset-free Web Audio mixer. Only enable() is allowed to create/unlock audio. */
export class MatchAudio {
  private readonly contextFactory: () => AudioContext;
  private readonly maxVoices: number;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private ambience: AudioBufferSourceNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;
  private ambienceGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private pendingEnable: Promise<boolean> | null = null;
  private voices = new Set<Voice>();
  private lastPlayed = new Map<MatchAudioCue, number>();
  private enabled = false;
  private muted = true;
  private active = true;
  private volume = 0.55;
  private disposed = false;
  private error: string | null = null;
  private played = 0;
  private dropped = 0;

  constructor(options: MatchAudioOptions = {}) {
    this.contextFactory = options.contextFactory ?? (() => {
      if (typeof globalThis.AudioContext !== "function") throw new Error("Web Audio is unavailable in this browser.");
      return new AudioContext();
    });
    const requested = options.maxVoices ?? 8;
    this.maxVoices = Number.isFinite(requested) ? Math.max(1, Math.min(16, Math.floor(requested))) : 8;
  }

  enable(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.pendingEnable) return this.pendingEnable;
    this.pendingEnable = this.unlock().finally(() => { this.pendingEnable = null; });
    return this.pendingEnable;
  }

  private async unlock(): Promise<boolean> {
    try {
      const context = this.context ?? this.contextFactory();
      this.context = context;
      // Call resume synchronously within the enable() gesture, before the first await.
      if (context.state !== "running") {
        this.stopVoices();
        await context.resume();
      }
      if (this.disposed || this.context !== context) return false;
      if (context.state !== "running") throw new Error("Audio remains suspended. Try Enable sound again.");
      if (!this.master) this.buildMixer(context);
      this.enabled = true;
      this.muted = false;
      this.error = null;
      this.updateGain();
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Unable to enable audio.";
      this.enabled = false;
      this.muted = true;
      this.releaseMixer();
      return false;
    }
  }

  private buildMixer(context: AudioContext): void {
    this.master = context.createGain();
    this.master.gain.setValueAtTime(0, context.currentTime);
    this.limiter = context.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-12, context.currentTime);
    this.limiter.knee.setValueAtTime(6, context.currentTime);
    this.limiter.ratio.setValueAtTime(12, context.currentTime);
    this.limiter.attack.setValueAtTime(0.003, context.currentTime);
    this.limiter.release.setValueAtTime(0.15, context.currentTime);
    this.master.connect(this.limiter);
    this.limiter.connect(context.destination);

    this.noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const samples = this.noise.getChannelData(0);
    // Local deterministic PRNG: audio must never consume the match simulation RNG.
    let seed = 0x159a55e;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      samples[i] = (seed / 4294967296 * 2 - 1) * (0.75 + 0.25 * Math.sin(i / context.sampleRate * Math.PI));
    }
    this.ambience = context.createBufferSource();
    this.ambience.buffer = this.noise;
    this.ambience.loop = true;
    this.ambienceFilter = context.createBiquadFilter();
    this.ambienceFilter.type = "lowpass";
    this.ambienceFilter.frequency.setValueAtTime(900, context.currentTime);
    this.ambienceGain = context.createGain();
    this.ambienceGain.gain.setValueAtTime(0.09, context.currentTime);
    this.ambience.connect(this.ambienceFilter);
    this.ambienceFilter.connect(this.ambienceGain);
    this.ambienceGain.connect(this.master);
    this.ambience.start();
  }

  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted) this.stopVoices();
    this.updateGain();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const clamped = Math.max(0, Math.min(1, volume));
    if (this.volume === clamped) return;
    this.volume = clamped;
    if (this.volume === 0) this.stopVoices();
    this.updateGain();
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.stopVoices();
    this.updateGain();
  }

  private updateGain(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    const audible = this.enabled && !this.muted && this.active && this.volume > 0;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    // Silence is immediate; fade in only. Muted events are never queued.
    if (audible) this.master.gain.linearRampToValueAtTime(this.volume * 0.65, now + 0.04);
  }

  play(cue: MatchAudioCue): boolean {
    return this.playEvent(cue);
  }

  /**
   * Map a physical contact to one authored cue. Callers invoke this from the
   * simulation contact event, so a cross/header/volley never sounds during its
   * wind-up and presentation/audio cannot drift to different phases.
   */
  playActionContact(action: MatchAudioContactAction, options: MatchAudioEventOptions = {}): boolean {
    let cue: MatchAudioCue;
    switch (action) {
      case "pass": case "cross": cue = "pass"; break;
      case "tackle": cue = "tackle"; break;
      case "save": cue = "save"; break;
      case "kick": case "clearance": cue = "kick"; break;
      case "shot": case "header": case "volley": cue = "shot"; break;
    }
    return this.playEvent(cue, options);
  }

  /**
   * Plays an event with bounded intensity and distance attenuation. The
   * simulation may provide these values, but this method never reads or
   * mutates simulation state and remains opt-in behind enable().
   */
  playEvent(cue: MatchAudioCue, options: MatchAudioEventOptions = {}): boolean {
    const context = this.context;
    if (!this.enabled || this.muted || !this.active || this.volume === 0 || this.disposed || !context || !this.master || context.state !== "running") return false;
    const now = context.currentTime;
    if (this.voices.size >= this.maxVoices || now - (this.lastPlayed.get(cue) ?? -Infinity) < 0.06) {
      this.dropped++;
      return false;
    }
    const shape = CUES[cue];
    if (!shape) return false;
    const strength = Number.isFinite(options.strength) ? Math.max(0, Math.min(1.5, options.strength!)) : 1;
    const distance = Number.isFinite(options.distance) ? Math.max(0, Math.min(90, options.distance!)) : 0;
    const attenuation = 1 / (1 + distance * 0.055);
    if (strength <= 0) return false;
    const eventLevel = Math.max(0.002, shape.level * strength * attenuation);
    const gain = context.createGain();
    let source: AudioBufferSourceNode | OscillatorNode;
    if (shape.wave === "noise") {
      source = context.createBufferSource();
      source.buffer = this.noise;
    } else {
      source = context.createOscillator();
      source.type = shape.wave;
      const pitch = 1 + (strength - 1) * 0.045;
      source.frequency.setValueAtTime(shape.frequency * pitch, now);
      if (shape.notes) {
        const oscillator = source;
        const notes = shape.notes;
        notes.forEach((frequency, index) => oscillator.frequency.setValueAtTime(frequency * pitch, now + index * shape.duration / notes.length));
      } else {
        source.frequency.exponentialRampToValueAtTime(shape.endFrequency * pitch, now + shape.duration);
      }
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(eventLevel, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + shape.duration);
    source.connect(gain);
    gain.connect(this.master);
    const voice = { source, gain };
    this.voices.add(voice);
    source.onended = () => this.releaseVoice(voice);
    source.start(now);
    source.stop(now + shape.duration + 0.015);
    this.lastPlayed.set(cue, now);
    this.played++;
    return true;
  }

  private releaseVoice(voice: Voice): void {
    if (!this.voices.delete(voice)) return;
    voice.source.onended = null;
    voice.source.disconnect();
    voice.gain.disconnect();
  }

  private stopVoices(): void {
    for (const voice of this.voices) {
      try { voice.source.stop(); } catch { /* The source may already have ended. */ }
      this.releaseVoice(voice);
    }
    this.lastPlayed.clear();
  }

  /** Reset match-local cue counters without changing the user's sound preferences. */
  reset(): void {
    this.stopVoices();
    this.played = 0;
    this.dropped = 0;
  }

  private releaseMixer(): void {
    this.stopVoices();
    if (this.ambience) {
      try { this.ambience.stop(); } catch { /* Already stopped. */ }
      this.ambience.disconnect();
    }
    this.ambienceFilter?.disconnect();
    this.ambienceGain?.disconnect();
    this.master?.disconnect();
    this.limiter?.disconnect();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.limiter = null;
    this.ambience = null;
    this.ambienceFilter = null;
    this.ambienceGain = null;
    this.noise = null;
    if (context && context.state !== "closed") void context.close().catch(() => { /* Best-effort cleanup must not reject globally. */ });
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.muted = true;
    this.releaseMixer();
  }

  debugSnapshot() {
    return {
      enabled: this.enabled, muted: this.muted, active: this.active, volume: this.volume,
      contextState: this.context?.state ?? (this.disposed ? "disposed" : "not-created"),
      voices: this.voices.size, maxVoices: this.maxVoices, played: this.played, dropped: this.dropped,
      ambience: this.ambience !== null, error: this.error, cues: [...MATCH_AUDIO_CUES],
    };
  }
}
