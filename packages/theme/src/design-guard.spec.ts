import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// AGENTS.md section 2.2: no hardcoded colors, fonts or arbitrary design values in components or apps.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const roots = ["packages/ui/src", "apps/storefront/src", "apps/admin/src"].map((path) =>
  join(repoRoot, path),
);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return files(full);
    }
    return /\.(tsx?|css)$/.test(entry) ? [full] : [];
  });
}

const forbidden: [string, RegExp][] = [
  ["hex color", /#[0-9a-fA-F]{3,8}\b/],
  ["rgb()/hsl()/oklch() color", /\b(rgb|rgba|hsl|hsla|oklch)\(/],
  [
    "Tailwind palette color (use semantic tokens)",
    /\b(bg|text|border|ring|fill|stroke|from|to|via)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(-\d{2,3})?\b/,
  ],
  ["arbitrary Tailwind value", /\b[a-z-]+-\[[^\]]+\]/],
  ["inline style attribute", /\bstyle=\{\{/],
];

describe("design guard", () => {
  const sources = roots.flatMap(files);

  it("scans real files", () => {
    expect(sources.length).toBeGreaterThan(5);
  });

  for (const [label, pattern] of forbidden) {
    it(`no ${label} in components or apps`, () => {
      const offenders = sources.filter((file) => pattern.test(readFileSync(file, "utf8")));
      expect(offenders.map((file) => file.replace(repoRoot, ""))).toEqual([]);
    });
  }
});
