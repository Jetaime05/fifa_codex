import { describe, expect, it } from "vitest";
import { FixedTimestep } from "./FixedTimestep";

describe("FixedTimestep", () => {
  it("turns variable frame time into deterministic steps", () => {
    const fixed = new FixedTimestep({ step: 0.1, maxSteps: 10 }); const values: number[] = [];
    fixed.advance(0.25, (dt) => values.push(dt));
    expect(values).toHaveLength(2); expect(values.every((value) => value === 0.1)).toBe(true);
  });
});
