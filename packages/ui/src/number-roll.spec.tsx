import { beforeEach, describe, expect, it, vi } from "vitest";
import { NumberRoll, numberRollDirection } from "./number-roll";
import { render, tags, text } from "./test-helpers";

// Preserve the number's hook state across prop changes without a DOM dependency.
const hook = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(initial: T) => {
    if (hook.value === undefined) hook.value = initial;
    return [
      hook.value,
      (value: T) => {
        hook.value = value;
      },
    ];
  },
}));
beforeEach(() => {
  hook.value = undefined;
});

function draw(value: number): string {
  NumberRoll({ value, decorative: true });
  return render(NumberRoll({ value, decorative: true }));
}

describe("NumberRoll", () => {
  it("does not animate the first render and exposes the current value outside hidden moving digits", () => {
    const markup = render(<NumberRoll value={12} />);
    expect(markup).toContain('data-rolling="false"');
    expect(markup).not.toContain("fk-number-old");
    expect(tags(markup, "span").some((tag) => tag.attributes.class === "sr-only")).toBe(true);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("tabular-nums");
  });
  it("keeps decorative text exactly the current count after increases and decreases", () => {
    expect(text(draw(1))).toBe("1");
    const increased = draw(12);
    expect(text(increased)).toBe("12");
    expect(increased).toContain('data-previous="1"');
    expect(increased).toContain('data-rolling="true"');
    expect(increased).not.toContain('class="sr-only"');
    expect(increased).not.toContain("fk-number-old");
    const decreased = draw(2);
    expect(text(decreased)).toBe("2");
    expect(decreased).toContain('data-previous="12"');
  });
  it("chooses opposite roll directions for an increase and a decrease", () => {
    expect(numberRollDirection(1, 2)).toBe("up");
    expect(numberRollDirection(2, 1)).toBe("down");
  });
  it("takes accessible text from its caller", () => {
    expect(render(<NumberRoll value={3} accessibleLabel="Three items" />)).toContain("Three items");
  });
});
