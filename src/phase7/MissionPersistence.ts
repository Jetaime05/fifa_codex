import {
  MissionsSystem,
  type MatchCompletedEvent,
  type MissionClaimOptions,
  type MissionClaimResult,
  type MissionEventResult,
  type MissionPeriodKeys,
  type MissionProgress,
  type MissionState
} from "../missions";

export const DEFAULT_MISSIONS_STORAGE_KEY = "elite-kickoff:missions:v1";

export type MissionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type MissionPersistenceDiagnostic = {
  code: "read-failed" | "write-failed" | "quota" | "malformed";
  message: string;
};

/**
 * Calendar keys for an explicit timezone offset. The offset is minutes east of
 * UTC (Bangkok is 420). Omitting it uses the browser's local timezone.
 */
export function missionPeriodKeysAt(
  timestamp: number,
  timezoneOffsetMinutes = -new Date(timestamp).getTimezoneOffset()
): MissionPeriodKeys {
  const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
  const local = new Date(safeTimestamp + timezoneOffsetMinutes * 60_000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");

  const isoDate = new Date(Date.UTC(year, local.getUTCMonth(), local.getUTCDate()));
  const weekday = isoDate.getUTCDay() || 7;
  isoDate.setUTCDate(isoDate.getUTCDate() + 4 - weekday);
  const isoYear = isoDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((isoDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return {
    dayKey: `${year}-${month}-${day}`,
    weekKey: `${isoYear}-W${String(week).padStart(2, "0")}`
  };
}

export type PersistentMissions = {
  readonly snapshot: MissionState;
  readonly diagnostics: readonly MissionPersistenceDiagnostic[];
  readonly system: MissionsSystem;
  sync(timestamp: number, timezoneOffsetMinutes?: number): MissionState;
  startMatch(matchId: string, timestamp: number, timezoneOffsetMinutes?: number): MissionState;
  processMatch(event: MatchCompletedEvent, timezoneOffsetMinutes?: number): MissionEventResult;
  claim(missionId: string, options?: MissionClaimOptions): MissionClaimResult;
  listCurrent(): MissionProgress[];
  persist(): void;
};

export function createPersistentMissions(options: {
  storage?: MissionStorage;
  key?: string;
  timestamp?: number;
  timezoneOffsetMinutes?: number;
} = {}): PersistentMissions {
  const diagnostics: MissionPersistenceDiagnostic[] = [];
  const key = options.key ?? DEFAULT_MISSIONS_STORAGE_KEY;
  const timestamp = options.timestamp ?? Date.now();
  const periodKeys = missionPeriodKeysAt(timestamp, options.timezoneOffsetMinutes);
  let storage = options.storage;
  if (!storage) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = undefined;
    }
  }

  let restored: string | undefined;
  if (storage) {
    try {
      restored = storage.getItem(key) ?? undefined;
      if (restored) {
        try {
          JSON.parse(restored);
        } catch {
          diagnostics.push({ code: "malformed", message: "Mission save contained invalid JSON; loaded current missions" });
          restored = undefined;
        }
      }
    } catch {
      diagnostics.push({ code: "read-failed", message: "Unable to read mission save; loaded current missions" });
    }
  }

  const system = new MissionsSystem({ state: restored, periodKeys });
  const persist = () => {
    if (!storage) return;
    try {
      storage.setItem(key, system.serialize());
    } catch (error) {
      const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
      diagnostics.push({
        code: /quota|space|storage/i.test(text) ? "quota" : "write-failed",
        message: /quota|space|storage/i.test(text)
          ? "Mission save exceeded storage quota"
          : "Unable to persist mission progress"
      });
    }
  };

  return {
    get snapshot() {
      return system.state;
    },
    get diagnostics() {
      return diagnostics.map((item) => ({ ...item }));
    },
    system,
    sync(nextTimestamp, offset) {
      const state = system.syncPeriods(missionPeriodKeysAt(nextTimestamp, offset));
      persist();
      return state;
    },
    startMatch(matchId, nextTimestamp, offset) {
      const state = system.startMatch(matchId, missionPeriodKeysAt(nextTimestamp, offset));
      persist();
      return state;
    },
    processMatch(event, offset) {
      const result = system.processMatchCompleted(event, missionPeriodKeysAt(event.occurredAt, offset));
      persist();
      return result;
    },
    claim(missionId, claimOptions) {
      const result = system.claimMission(missionId, claimOptions);
      persist();
      return result;
    },
    listCurrent() {
      return system.getCurrentMissions();
    },
    persist
  };
}
