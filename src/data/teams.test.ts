import { describe, expect, it } from "vitest";
import { manCity, realMadrid } from "./teams";

describe("team data", () => {
  it("loads two complete 11-player rosters", () => {
    expect(realMadrid.players).toHaveLength(11);
    expect(manCity.players).toHaveLength(11);
    expect(realMadrid.players.every((player) => player.name && player.stats.pace > 0)).toBe(true);
  });
});
