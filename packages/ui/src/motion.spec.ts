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
      ".fk-cart-line-enter",
    ]) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toContain("animation: none !important");
    expect(reduced).toMatch(
      /\.fk-toast-life,\s*\.fk-number-frame\[data-rolling="true"\]::before,\s*\.fk-skeleton-shimmer::after\s*\{\s*display: none;/,
    );
  });
  it("covers the spring overshoot with an off-screen buffer and hides the full panel on entry", () => {
    const panel = css.match(/\.fk-drawer-panel\s*\{([^}]+)\}/)?.[1];
    expect(panel).toContain("--fk-drawer-overshoot: calc(var(--fk-space-unit) * 16)");
    expect(panel).toContain("padding-inline-end: env(safe-area-inset-right)");
    expect(panel).not.toMatch(/margin(?:-[\w-]+)?\s*:/);
    expect(panel).not.toMatch(/(?:padding|margin)[\w-]*\s*:[^;]*var\(--fk-drawer-overshoot\)/);
    const buffer = css.match(/\.fk-drawer-panel::after\s*\{([^}]+)\}/)?.[1];
    expect(buffer).toContain('content: ""');
    expect(buffer).toContain("position: absolute");
    expect(buffer).toContain("inset-block: 0");
    expect(buffer).toContain("inset-inline-start: 100%");
    expect(buffer).toContain("inline-size: var(--fk-drawer-overshoot)");
    expect(buffer).toContain("background: inherit");
    expect(panel).toContain("transform: translateX(100%)");
    expect(panel).toContain("var(--fk-motion-ease-spring)");
    expect(css).toMatch(/\.fk-drawer\s*\{[^}]*overflow: clip;/);
    expect(css).not.toMatch(/\.fk-drawer\s*\{[^}]*overflow: hidden;/);
    expect(css.slice(css.indexOf("@starting-style"))).toMatch(
      /\.fk-drawer\[open\] \.fk-drawer-panel\s*\{\s*transform: translateX\(100%\)/,
    );
  });
  it("locks body scrolling and uses CSS starting styles rather than JS animation delays", () => {
    expect(css).toContain("body:has(dialog[data-drawer][open])");
    expect(css).toContain("@starting-style");
    expect(css).not.toContain("allow-discrete");
    expect(css).toContain("@layer components");
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
