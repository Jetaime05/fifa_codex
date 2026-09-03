export type ReplayInput = {
  time: number;
  actions: string[];
  stateHash?: string;
};

/** Phase 1 replay contract. It records inputs only; playback is intentionally future work. */
export class ReplayRecorder {
  private recording = false;
  private frames: ReplayInput[] = [];

  start() { this.frames = []; this.recording = true; }
  stop() { this.recording = false; }
  record(frame: ReplayInput) { if (this.recording) this.frames.push({ ...frame, actions: [...frame.actions] }); }
  isRecording() { return this.recording; }
  getFrames() { return this.frames.map((frame) => ({ ...frame, actions: [...frame.actions] })); }
  clear() { this.frames = []; }
}
