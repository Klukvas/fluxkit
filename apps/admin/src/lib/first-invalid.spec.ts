import { describe, expect, it } from "vitest";
import { INVALID_SELECTOR, firstInvalidControl, type InvalidSearchRoot } from "./first-invalid";

interface Fake extends InvalidSearchRoot {
  name: string;
}

/** A fake element: `found` answers each selector the way a document would (first match in document order). */
function fake(name: string, found: Record<string, Fake | null> = {}, groupMark = false): Fake {
  return {
    name,
    querySelector: (selector: string): Fake | null => found[selector] ?? null,
    matches: (selector) => groupMark && selector === '[data-invalid="true"]',
  };
}

describe("firstInvalidControl", () => {
  it("answers null when no field is marked (the caller focuses the summary)", () => {
    expect(firstInvalidControl(fake("form"))).toBeNull();
  });

  it("answers the first field marked aria-invalid", () => {
    const title = fake("title-uk");
    expect(
      (firstInvalidControl(fake("form", { [INVALID_SELECTOR]: title })) as Fake | null)?.name,
    ).toBe("title-uk");
  });

  it("answers the first enabled control of a marked group (a picture slot has no native field)", () => {
    const button = fake("upload-button");
    const group = fake("picture-slot", {}, true);
    group.querySelector = (selector) => (selector.startsWith("input") ? button : null);
    expect(
      (firstInvalidControl(fake("form", { [INVALID_SELECTOR]: group })) as Fake | null)?.name,
    ).toBe("upload-button");
  });

  it("answers the group itself when it holds no control", () => {
    const group = fake("picture-slot", {}, true);
    expect(
      (firstInvalidControl(fake("form", { [INVALID_SELECTOR]: group })) as Fake | null)?.name,
    ).toBe("picture-slot");
  });
});
