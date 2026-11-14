import { describe, expect, it } from "vitest";
import * as icons from "./icons";
import { first, render, text } from "./test-helpers";

describe("replaceable decorative icons", () => {
  it("exports 23 distinct icons with fixed SVG and accessibility invariants", () => {
    expect(Object.keys(icons)).toHaveLength(23);
    const drawings = Object.values(icons).map((Icon) => {
      const markup = render(<Icon className="custom" />);
      expect(first(markup, "svg").attributes).toMatchObject({
        viewBox: "0 0 24 24",
        stroke: "currentColor",
        fill: "none",
        "aria-hidden": "true",
        focusable: "false",
      });
      expect(markup).toContain("size-6");
      expect(markup).toContain("custom");
      expect(text(markup)).toBe("");
      return markup;
    });
    expect(new Set(drawings).size).toBe(23);
  });
});
