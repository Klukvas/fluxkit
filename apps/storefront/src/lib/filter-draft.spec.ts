import { describe, expect, it } from "vitest";
import { floatingTop, isControlChanged, isFormChanged } from "./filter-draft";

describe("filter form draft (the floating Apply button)", () => {
  it("sees a ticked or unticked checkbox as a change, and ticking it back as none", () => {
    expect(isControlChanged({ type: "checkbox", checked: true, defaultChecked: false })).toBe(true);
    expect(isControlChanged({ type: "checkbox", checked: false, defaultChecked: true })).toBe(true);
    expect(isControlChanged({ type: "checkbox", checked: true, defaultChecked: true })).toBe(false);
  });

  it("sees typed text in a price or range box as a change, and the original text as none", () => {
    expect(isControlChanged({ type: "text", value: "12", defaultValue: "" })).toBe(true);
    expect(isControlChanged({ type: "text", value: "", defaultValue: "" })).toBe(false);
    expect(isControlChanged({ type: "text", value: "5", defaultValue: "5" })).toBe(false);
  });

  it("ignores the hidden words field and buttons, and reads a select's options", () => {
    expect(isControlChanged({ type: "hidden", value: "x", defaultValue: "" })).toBe(false);
    expect(isControlChanged({ type: "submit", value: "x", defaultValue: "" })).toBe(false);
    expect(
      isControlChanged({
        type: "select-one",
        options: [
          { selected: false, defaultSelected: true },
          { selected: true, defaultSelected: false },
        ],
      }),
    ).toBe(true);
    expect(
      isControlChanged({
        type: "select-one",
        options: [{ selected: true, defaultSelected: true }],
      }),
    ).toBe(false);
  });

  it("calls the form changed while any control differs", () => {
    const unchanged = { type: "checkbox", checked: false, defaultChecked: false };
    const changed = { type: "text", value: "3", defaultValue: "" };
    expect(isFormChanged([unchanged, unchanged])).toBe(false);
    expect(isFormChanged([unchanged, changed])).toBe(true);
    expect(isFormChanged([])).toBe(false);
  });

  it("centres the button on the changed row and keeps it inside the form", () => {
    const form = { top: 100, height: 600 };
    expect(floatingTop({ top: 300, height: 44 }, form, 44)).toBe(200);
    expect(floatingTop({ top: 300, height: 24 }, form, 44)).toBe(190);
    // A row scrolled above the form's top, or below its end.
    expect(floatingTop({ top: 50, height: 24 }, form, 44)).toBe(0);
    expect(floatingTop({ top: 900, height: 24 }, form, 44)).toBe(556);
  });
});
