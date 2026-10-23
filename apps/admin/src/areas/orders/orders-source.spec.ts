import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the order detail page's wiring that a static-markup test cannot see (the decisions themselves are tested in
 * `order-actions.spec.ts`). They read the file as text, so each rule is pinned to the shape of the code that keeps it; a
 * refactor that keeps the rule updates the pattern here.
 */
const code = readFileSync(join(import.meta.dirname, "order-detail-page.tsx"), "utf8").replace(
  /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
  "$1",
);

describe("order detail page source guards", () => {
  it("never closes a dialog while its write runs (step 13 review, G15)", () => {
    const close = code.slice(
      code.indexOf("function closeDialog()"),
      code.indexOf("function open("),
    );
    expect(close).toMatch(
      /^function closeDialog\(\) \{\s*if \(!canCloseOrderDialog\(\{ busy, writing: flight\.pending\(\) \}\)\) return;/,
    );
    // Every dialog closes through it and knows the busy state (it is not dismissible with Escape while busy).
    expect(code.match(/onClose=\{closeDialog\}/g)).toHaveLength(3);
    expect(code.match(/busy=\{busy\}/g)).toHaveLength(3);
  });

  it("sends every write through the single flight", () => {
    expect(code).toContain("const running = flight.run(() => runWrite(write));");
    expect(code).toContain("if (running === null) return null;");
  });
});
