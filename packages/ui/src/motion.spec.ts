import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./motion.css", import.meta.url), "utf8");

describe("motion stylesheet", () => {
  it("uses theme motion tokens without CSS toast reading timers", () => {
    expect(css).not.toMatch(/\b\d*\.?\d+m?s\b/);
    expect(css).not.toMatch(/cubic-bezier\(/);
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i);
    expect(css).not.toContain("--fk-toast-life");
    expect(css).toContain("var(--fk-motion-ease-spring)");
  });
  it("disables loader animations in hidden action labels while keeping standalone loaders animated", () => {
    expect(css).toMatch(
      /\.fk-action-label:not\(\[data-visible="true"\]\) \.fk-loader-dot\s*\{\s*animation: none;\s*\}/,
    );
    expect(css).toMatch(/\.fk-loader-dot\s*\{[^}]*animation: fk-hop[^}]*infinite;/);
  });
  it("turns off every keyframe animation under reduced motion, including infinite loops", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const selector of [
      ".fk-toast-item",
      ".fk-action-check",
      '.fk-number-frame[data-rolling="true"]::before',
      ".fk-number-new",
      ".fk-loader-dot",
      ".fk-skeleton-shimmer::after",
      ".fk-badge-bump",
      ".fk-badge-bump-alt",
      ".fk-empty-cart-float",
      ".fk-cart-line-enter",
    ]) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toMatch(
      /\.fk-toast-life,\s*\.fk-number-frame\[data-rolling="true"\]::before,\s*\.fk-skeleton-shimmer::after\s*\{\s*display: none;/,
    );
  });
  it("keeps a safe floating gap without a painted buffer and hides the whole rotated card on entry", () => {
    const drawer = css.match(/\.fk-drawer\s*\{([^}]+)\}/)?.[1];
    expect(drawer).toMatch(
      /padding:\s*max\(calc\(var\(--fk-space-unit\) \* 3\), env\(safe-area-inset-top\)\)\s+max\(calc\(var\(--fk-space-unit\) \* 3\), env\(safe-area-inset-right\)\)\s+max\(calc\(var\(--fk-space-unit\) \* 3\), env\(safe-area-inset-bottom\)\)\s+max\(calc\(var\(--fk-space-unit\) \* 3\), env\(safe-area-inset-left\)\)/,
    );
    const panel = css.match(/\.fk-drawer-panel\s*\{([^}]+)\}/)?.[1];
    expect(panel).toContain("transform-origin: top right");
    const closedTransform = panel?.match(/transform:\s*([^;]+);/)?.[1];
    expect(closedTransform).toMatch(
      /translateX\(\s*calc\(\s*100% \+ max\(calc\(var\(--fk-space-unit\) \* 3\), env\(safe-area-inset-right\)\) \+\s*calc\(var\(--fk-space-unit\) \* 16\)\s*\)\s*\)\s*rotate\(-3deg\)/,
    );
    expect(panel).not.toMatch(/(?:padding|margin)[\w-]*\s*:/);
    expect(css).not.toContain(".fk-drawer-panel::after");
    expect(css).not.toContain("--fk-drawer-overshoot");
    expect(css).not.toMatch(/\.fk-drawer-footer\s*\{/);
    expect(panel).toContain("var(--fk-motion-ease-spring)");
    expect(drawer).toContain("overflow: clip");
    expect(drawer).not.toContain("overflow: hidden");
    expect(css).toMatch(
      /\.fk-drawer\[open\] \.fk-drawer-panel\s*\{\s*transform: translateX\(0\) rotate\(0deg\);/,
    );
    const startTransform = css
      .slice(css.indexOf("@starting-style"))
      .match(/\.fk-drawer\[open\] \.fk-drawer-panel\s*\{\s*transform:\s*([^;]+);/)?.[1];
    expect(startTransform?.replace(/\s+/g, " ")).toBe(closedTransform?.replace(/\s+/g, " "));
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.fk-drawer-panel,[^}]*transition: none;/);
  });
  it("floats the empty-cart bag from its rest pose on tokens and leaves no transform under reduced motion", () => {
    const float = css.match(/\.fk-empty-cart-float\s*\{([^}]+)\}/)?.[1];
    expect(float).toMatch(
      /animation: fk-empty-cart-float calc\(var\(--fk-motion-duration-slow\) \* 6\)\s+var\(--fk-motion-ease-standard\) infinite alternate;/,
    );
    expect(float).not.toMatch(/(?:^|;)\s*transform:|animation-delay:/);
    expect(css).toMatch(
      /@keyframes fk-empty-cart-float\s*\{\s*from\s*\{\s*transform: translateY\(0\) rotate\(0deg\);/,
    );
    expect(css).toContain("translateY(calc(var(--fk-space-unit) * -1)) rotate(-2deg)");
  });
  it("limits card tilt and image hop to hover pointers with normal motion and alternates list or direct children", () => {
    const hover = css.match(
      /@media \(hover: hover\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]+?)\n {2}\}/,
    )?.[1];
    expect(hover).toBeDefined();
    expect(hover).toContain(".fk-card-tilt:hover");
    expect(hover).toContain("li:nth-child(even) > .fk-card-tilt:hover");
    expect(hover).toContain(":not(li) > .fk-card-tilt:nth-child(even):hover");
    expect(hover).toContain("rotate(-1.5deg)");
    expect(hover).toContain("rotate(1.5deg)");
    expect(hover).toContain("box-shadow var(--fk-motion-duration-base)");
    expect(hover).toMatch(
      /\.fk-card-hop\s*\{\s*transition: transform var\(--fk-motion-duration-slow\) var\(--fk-motion-ease-spring\);/,
    );
    expect(hover).toContain(".fk-card-tilt:hover .fk-card-hop");
    expect(hover).toContain(
      "translateY(calc(var(--fk-space-unit) * -1)) rotate(-1deg) scale(1.04)",
    );
    expect(css.replace(hover ?? "", "")).not.toMatch(/\.fk-card-(?:tilt|hop)/);
  });
  it("gives native progress an inner ink outline, a clipped pill and spring fill transitions", () => {
    const progress = css.match(/\.fk-progress\s*\{([^}]+)\}/)?.[1];
    expect(progress).toContain("border: 2px solid var(--fk-color-foreground)");
    expect(progress).toContain("block-size: calc(var(--fk-space-unit) * 3.5)");
    expect(progress).toContain("overflow: hidden");
    const track = css.match(/\.fk-progress::-webkit-progress-bar\s*\{([^}]+)\}/)?.[1];
    expect(track).not.toMatch(/(?:^|;)\s*border:/);
    expect(track).toContain("background: var(--fk-color-border)");
    for (const pseudo of ["-webkit-progress-value", "-moz-progress-bar"]) {
      const fill = css.match(new RegExp(`\\.fk-progress::${pseudo}\\s*\\{([^}]+)\\}`))?.[1];
      expect(fill).toContain("background: var(--fk-color-primary)");
      expect(fill).toContain(
        "transition: width var(--fk-motion-duration-base) var(--fk-motion-ease-spring)",
      );
      const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
      expect(reduced).toContain(`.fk-progress::${pseudo}`);
    }
  });
  it("keeps every -moz- pseudo-element in a selector list of its own", () => {
    // Blink drops a whole rule whose selector list holds an unknown -moz- pseudo-element (unknown ::-webkit-* ones stay valid).
    const selectorLists = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map(
      (match) => match[1]?.trim() ?? "",
    );
    const mixed = selectorLists.filter((list) => list.includes("::-moz-") && list.includes(","));
    expect(selectorLists.some((list) => list.includes("::-moz-"))).toBe(true);
    expect(mixed).toEqual([]);
  });
  it("locks body scrolling and uses CSS starting styles rather than JS animation delays", () => {
    expect(css).toContain("body:has(dialog[data-drawer][open])");
    expect(css).toContain("@starting-style");
    expect(css).not.toContain("allow-discrete");
    expect(css).toContain("@layer components");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
