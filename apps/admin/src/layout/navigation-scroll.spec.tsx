import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sentinelTranslator } from "../test-helpers";
import { NavigationScrollHint, revealDelta, scrollEdges } from "./navigation-scroll";

describe("navigation scroll edges", () => {
  it.each([
    [0, 300, 300, false, false],
    [0, 300, 200, false, false],
    [0, 300, 600, false, true],
    [150, 300, 600, true, true],
    [300, 300, 600, true, false],
    [1, 300, 600, false, true],
    [1.01, 300, 600, true, true],
    [299, 300, 600, true, false],
    [298.99, 300, 600, true, true],
    [0, 300, 301, false, false],
    [-20, 300, 600, false, true],
    [320, 300, 600, true, false],
    [20, 300, 200, false, false],
  ])(
    "at %s with viewport %s and content %s",
    (scrollTop, clientHeight, scrollHeight, above, below) => {
      expect(scrollEdges({ scrollTop, clientHeight, scrollHeight })).toEqual({ above, below });
    },
  );
});

describe("current navigation item reveal", () => {
  it.each([
    [120, 156, 0],
    [100, 300, 0],
    [90, 126, -10],
    [280, 316, 16],
  ])("moves an item at %s..%s by the minimum delta %s", (top, bottom, delta) => {
    expect(revealDelta({ top, bottom }, { top: 100, bottom: 300 })).toBe(delta);
  });
});

describe("navigation scroll hint", () => {
  const t = sentinelTranslator();
  it.each([
    [false, false, "none", null],
    [false, true, "below", "§shell.navMoreBelow"],
    [true, true, "below", "§shell.navMoreBelow"],
    [true, false, "above", "§shell.navMoreAbove"],
  ])("shows %s/%s as %s", (above, below, direction, label) => {
    const markup = renderToStaticMarkup(
      <NavigationScrollHint edges={{ above, below }} collapsed={false} t={t} />,
    );
    expect(markup).toContain(`data-nav-scroll-hint="${direction}"`);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("h-5 shrink-0");
    if (label) expect(markup).toContain(label);
    else expect(markup).not.toContain("<svg");
    expect(markup.includes("rotate-180")).toBe(direction === "above");
  });

  it("keeps only the decorative chevron when collapsed", () => {
    const markup = renderToStaticMarkup(
      <NavigationScrollHint edges={{ above: false, below: true }} collapsed t={t} />,
    );
    expect(markup).toContain("<svg");
    expect(markup).not.toContain("§shell.navMoreBelow");
  });
});
