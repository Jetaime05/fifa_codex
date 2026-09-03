import { describe, expect, it } from "vitest";
import { SeededRandom } from "./random";

describe("SeededRandom", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new SeededRandom(123); const b = new SeededRandom(123);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });
});
