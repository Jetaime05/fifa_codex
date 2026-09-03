import { describe, expect, it } from "vitest";
import { KeyboardInput } from "./KeyboardInput";

function keyEvent(type: "keydown" | "keyup", code: string) {
  const event = new Event(type);
  Object.defineProperty(event, "code", { value: code });
  return event;
}

describe("KeyboardInput edge queue", () => {
  it("keeps a short tap until simulation consumes it", () => {
    const target = new EventTarget() as Window;
    const input = new KeyboardInput().attach(target);
    target.dispatchEvent(keyEvent("keydown", "Space"));
    target.dispatchEvent(keyEvent("keyup", "Space"));
    expect(input.consumeActions()).toEqual([{ type: "pause" }]);
    expect(input.consumeActions()).toEqual([]);
  });

  it("does not enqueue browser key-repeat events", () => {
    const target = new EventTarget() as Window;
    const input = new KeyboardInput().attach(target);
    target.dispatchEvent(keyEvent("keydown", "KeyJ"));
    target.dispatchEvent(keyEvent("keydown", "KeyJ"));
    target.dispatchEvent(keyEvent("keyup", "KeyJ"));
    expect(input.consumeActions()).toEqual([{ type: "pass" }]);
  });
});
