import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_WRITE_OPERATIONS, canWriteBanners } from "./banner-permissions";

/**
 * Guards over the banner area's wiring that static markup cannot see. They read the sources as text, so each rule is
 * pinned to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */
const folder = import.meta.dirname;
const sources = readdirSync(folder)
  .filter(
    (name) => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) && name !== "test-helpers.ts",
  )
  .map((name) => ({
    name,
    code: readFileSync(join(folder, name), "utf8").replace(
      /\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g,
      "$1",
    ),
  }));
const file = (name: string) => {
  const found = sources.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`${name} does not exist`);
  return found.code;
};

describe("banner area source guards", () => {
  it("finds its sources", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it("sends every write exactly once: through a form submit or the delete confirmation", () => {
    const writes =
      /adminClient\.(createHomeBanner|updateHomeBanner|deleteHomeBanner|reorderHomeBanners)\(/g;
    let seen = 0;
    for (const { name, code } of sources) {
      for (const match of code.matchAll(writes)) {
        seen += 1;
        const before = code.slice(Math.max(0, (match.index ?? 0) - 80), match.index);
        expect(before, `${name}: ${match[0]}`).toMatch(
          /(form|reorder)\.submit\(\(\) =>\s*$|remove=\{\(\) =>\s*$/,
        );
      }
    }
    // Create, update, reorder, and delete from the list and from the editor.
    expect(seen).toBe(5);
  });

  it("never retries a write and never polls: no loop or timer", () => {
    for (const { name, code } of sources) {
      expect(code, name).not.toMatch(/setInterval|setTimeout|while \(|retry\(/);
    }
  });

  it("uploads pictures only through the shared queue (one file, one slot at a time)", () => {
    for (const { name, code } of sources) expect(code, name).not.toMatch(/uploadMedia\(|fetch\(/);
    const upload = file("banner-picture-upload.ts");
    expect(upload).toMatch(/maxRows: 1,\s*maxFiles: 1,/);
    expect(upload).toMatch(/if \(!queue\.running\) \{\s*target\.current = slot;/);
  });

  it("refuses a save while a picture uploads, in both handlers and on the button", () => {
    const pages = file("banner-editor-pages.tsx");
    expect(
      pages.match(/if \(form\.state\.busy \|\| !canWrite \|\| upload\.running\) return;/g),
    ).toHaveLength(2);
    expect(pages).toMatch(/upload\.running\) && !saved && !form\.state\.busy/);
    expect(file("banner-form-view.tsx")).toMatch(/locked=\{upload\.running\}/);
  });

  it("renders the upload controls only behind write permission and the server's switch", () => {
    const view = file("banner-form-view.tsx");
    // The limits line, and in each slot the upload panel inside the write-only block.
    expect(view.match(/canWrite && upload\.uploadsEnabled/g)).toHaveLength(1);
    expect(view).toMatch(
      /\{canWrite \? \(\s*<div[^>]*>\s*\{upload\.uploadsEnabled \? \(\s*<UploadPanel/,
    );
    expect(view.match(/<UploadPanel/g)).toHaveLength(1);
  });

  it("puts uploaded addresses into img src only through safeHttpUrl", () => {
    for (const { name, code } of sources) {
      for (const match of code.matchAll(/src=\{([^}]+)\}/g)) {
        expect(["source", "thumbnail"], `${name}: ${match[0]}`).toContain(match[1]);
      }
    }
  });
});

describe("banner permissions", () => {
  it("lets owner and manager write (catalog.write), the viewer only read", () => {
    expect(canWriteBanners([...ROLE_PERMISSIONS.owner])).toBe(true);
    expect(canWriteBanners([...ROLE_PERMISSIONS.manager])).toBe(true);
    expect(canWriteBanners([...ROLE_PERMISSIONS.viewer])).toBe(false);
    expect(canWriteBanners(null)).toBe(false);
  });

  it("names the four banner writes and the picture upload", () => {
    expect([...BANNER_WRITE_OPERATIONS].sort()).toEqual([
      "createHomeBanner",
      "deleteHomeBanner",
      "reorderHomeBanners",
      "updateHomeBanner",
      "uploadMedia",
    ]);
  });
});
