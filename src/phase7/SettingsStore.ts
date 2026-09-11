export type PersistedGameSettings = {
  version: 1;
  difficulty: "easy" | "normal" | "hard";
  matchLength: 30 | 240;
  weather: "clear" | "rain";
  reducedMotion: boolean;
  volume: number;
  rules: {
    offside: boolean;
    advantage: boolean;
    injuryTime: boolean;
    substitutions: boolean;
  };
};

export type SettingsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type SettingsDiagnostic = {
  code: "malformed" | "migration" | "read-failed" | "write-failed" | "quota";
  message: string;
};

export const DEFAULT_SETTINGS_STORAGE_KEY = "elite-kickoff:settings:v1";

export const DEFAULT_GAME_SETTINGS: PersistedGameSettings = {
  version: 1,
  difficulty: "normal",
  matchLength: 240,
  weather: "clear",
  reducedMotion: false,
  volume: 0.4,
  rules: {
    offside: false,
    advantage: false,
    injuryTime: false,
    substitutions: false
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const cloneSettings = (settings: PersistedGameSettings): PersistedGameSettings => ({
  ...settings,
  rules: { ...settings.rules }
});

export function migrateGameSettings(raw: unknown): PersistedGameSettings {
  if (!isRecord(raw)) return cloneSettings(DEFAULT_GAME_SETTINGS);
  const rules = isRecord(raw.rules) ? raw.rules : {};
  return {
    version: 1,
    difficulty: raw.difficulty === "easy" || raw.difficulty === "hard" ? raw.difficulty : "normal",
    matchLength: raw.matchLength === 30 ? 30 : 240,
    weather: raw.weather === "rain" ? "rain" : "clear",
    reducedMotion: typeof raw.reducedMotion === "boolean" ? raw.reducedMotion : false,
    volume: Math.max(0, Math.min(1, finiteNumber(raw.volume, DEFAULT_GAME_SETTINGS.volume))),
    rules: {
      offside: rules.offside === true,
      advantage: rules.advantage === true,
      injuryTime: rules.injuryTime === true,
      substitutions: rules.substitutions === true
    }
  };
}

export type SettingsStore = {
  readonly snapshot: PersistedGameSettings;
  readonly diagnostics: readonly SettingsDiagnostic[];
  update(patch: Partial<Omit<PersistedGameSettings, "version" | "rules">> & {
    rules?: Partial<PersistedGameSettings["rules"]>;
  }): PersistedGameSettings;
};

export function createSettingsStore(options: {
  storage?: SettingsStorage;
  key?: string;
  defaults?: PersistedGameSettings;
} = {}): SettingsStore {
  const diagnostics: SettingsDiagnostic[] = [];
  const key = options.key ?? DEFAULT_SETTINGS_STORAGE_KEY;
  const defaults = migrateGameSettings(options.defaults ?? DEFAULT_GAME_SETTINGS);
  let storage = options.storage;
  if (!storage) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = undefined;
    }
  }
  let current = defaults;
  if (storage) {
    try {
      const serialized = storage.getItem(key);
      if (serialized) {
        try {
          const parsed: unknown = JSON.parse(serialized);
          if (!isRecord(parsed)) {
            diagnostics.push({ code: "malformed", message: "Settings save was not an object; loaded defaults" });
          } else {
            if (parsed.version !== 1) diagnostics.push({ code: "migration", message: "Migrated settings save to version 1" });
            current = migrateGameSettings(parsed);
          }
        } catch {
          diagnostics.push({ code: "malformed", message: "Settings save contained invalid JSON; loaded defaults" });
        }
      }
    } catch {
      diagnostics.push({ code: "read-failed", message: "Unable to read settings save; loaded defaults" });
    }
  }

  const persist = () => {
    if (!storage) return;
    try {
      storage.setItem(key, JSON.stringify(current));
    } catch (error) {
      const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
      diagnostics.push({
        code: /quota|space|storage/i.test(text) ? "quota" : "write-failed",
        message: /quota|space|storage/i.test(text)
          ? "Settings save exceeded storage quota"
          : "Unable to persist settings"
      });
    }
  };

  return {
    get snapshot() {
      return cloneSettings(current);
    },
    get diagnostics() {
      return diagnostics.map((item) => ({ ...item }));
    },
    update(patch) {
      current = migrateGameSettings({
        ...current,
        ...patch,
        version: 1,
        rules: { ...current.rules, ...patch.rules }
      });
      persist();
      return cloneSettings(current);
    }
  };
}
