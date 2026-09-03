import { describe, expect, it } from "vitest";
import { MatchController } from "./MatchController";

describe("MatchController", () => {
  it("routes normalized actions to gameplay handlers", () => {
    const received: string[] = [];
    const controller = new MatchController({ pass: () => received.push("pass"), pause: () => received.push("pause") });
    controller.dispatch([{ type: "pass" }, { type: "pause" }]);
    expect(received).toEqual(["pass", "pause"]);
  });
});
