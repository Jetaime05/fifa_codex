import type { MissionDefinition } from "./types";

/**
 * Small, offline-friendly mission set used by the prototype. Product code can
 * pass its own definitions to `MissionsSystem`; these defaults make the domain
 * useful immediately and provide goals for all three supported scopes.
 */
export const DEFAULT_MISSION_DEFINITIONS: readonly MissionDefinition[] = Object.freeze([
  {
    id: "daily-play-one",
    scope: "daily",
    title: "Play a match",
    description: "Complete one match today.",
    metric: "matchesPlayed",
    target: 1,
    reward: { coins: 50, xp: 50 }
  },
  {
    id: "daily-create-chances",
    scope: "daily",
    title: "Create chances",
    description: "Record five shots in completed matches today.",
    metric: "shots",
    target: 5,
    reward: { coins: 35, xp: 65 }
  },
  {
    id: "daily-pass-master",
    scope: "daily",
    title: "Pass master",
    description: "Complete ten passes today.",
    metric: "completedPasses",
    target: 10,
    reward: { coins: 40, xp: 80 }
  },
  {
    id: "weekly-win-three",
    scope: "weekly",
    title: "Winning week",
    description: "Win three matches this week.",
    metric: "wins",
    target: 3,
    reward: { coins: 150, xp: 250 }
  },
  {
    id: "weekly-score-eight",
    scope: "weekly",
    title: "Prolific attack",
    description: "Score eight goals this week.",
    metric: "goals",
    target: 8,
    reward: { coins: 125, xp: 220 }
  },
  {
    id: "match-result",
    scope: "match",
    title: "Finish the fixture",
    description: "Complete this match.",
    metric: "matchesPlayed",
    target: 1,
    reward: { coins: 20, xp: 25 }
  },
  {
    id: "match-win",
    scope: "match",
    title: "Take the win",
    description: "Win this match.",
    metric: "wins",
    target: 1,
    reward: { coins: 40, xp: 70 }
  }
]);

/** Public alias for callers that prefer a shorter constant name. */
export const defaultMissionDefinitions = DEFAULT_MISSION_DEFINITIONS;
