import { describe, expect, it } from "vitest";
import { accelerator, prettyKey, errorMessage } from "./api";
describe("physical shortcut recording", () => {
  it("uses physical letters when Option changes the typed character", () => {
    expect(
      accelerator({
        key: "∆",
        code: "KeyJ",
        metaKey: true,
        shiftKey: true,
        altKey: true,
        ctrlKey: false,
      } as KeyboardEvent),
    ).toBe("Super+Alt+Shift+J");
  });
  it("records Space and ignores modifier-only events", () => {
    expect(
      accelerator({ key: " ", code: "Space", altKey: true } as KeyboardEvent),
    ).toBe("Alt+Space");
    expect(accelerator({ key: "Meta" } as KeyboardEvent)).toBeNull();
  });
  it("shows clear errors for structured backend failures", () => {
    expect(errorMessage({ code: "CANCELLED", message: "任务已取消" })).toBe(
      "任务已取消",
    );
    expect(prettyKey("Super+Shift+J")).toBe("⌘ ⇧ J");
  });
});
