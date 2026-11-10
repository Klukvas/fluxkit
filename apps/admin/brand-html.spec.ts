import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  adminBrand,
  adminBrandHtml,
  adminName,
  brandIndexHtml,
  FAVICON_FILES,
  messageOverrideProblems,
} from "./brand-html";
import { eagerMessages } from "./src/messages";
import enCommon from "./src/messages/en/common.json";
import enOverrides from "./src/messages-overrides/en.json";

const page = `<!doctype html>
<html lang="uk" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <title></title>
  </head>
  <body><div id="root"></div></body>
</html>`;

const folders: string[] = [];
function publicDir(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "admin-brand-"));
  folders.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const file of files) writeFileSync(join(dir, file), "x");
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("brandIndexHtml (the admin's document title and favicon, set once at build)", () => {
  it("writes the name into the one title element and adds no icon without a favicon", () => {
    const html = brandIndexHtml(page, { name: "Fluxkit Admin", favicon: null }, "/admin-ui/");
    expect(html).toContain("<title>Fluxkit Admin</title>");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).not.toMatch(/rel="icon"/);
  });

  it("escapes the name (a fork may write any text into app.name)", () => {
    const html = brandIndexHtml(
      page,
      { name: `Tom & Jerry <"shop">`, favicon: null },
      "/admin-ui/",
    );
    expect(html).toContain("<title>Tom &amp; Jerry &lt;&quot;shop&quot;&gt;</title>");
  });

  it("links the favicon under the base path, with its type, inside the head", () => {
    const html = brandIndexHtml(page, { name: "A", favicon: "favicon.svg" }, "/admin-ui/");
    expect(html).toMatch(
      /<link rel="icon" href="\/admin-ui\/favicon\.svg" type="image\/svg\+xml" \/>\s*<\/head>/,
    );
  });

  it("fails loudly when the page does not have exactly one title element or a head", () => {
    const brand = { name: "A", favicon: null };
    expect(() => brandIndexHtml(page.replace("<title></title>", ""), brand, "/")).toThrow(/title/);
    expect(() =>
      brandIndexHtml(page.replace("<title></title>", "<title></title><title></title>"), brand, "/"),
    ).toThrow(/title/);
    expect(() =>
      brandIndexHtml(page.replace("</head>", ""), { name: "A", favicon: "favicon.ico" }, "/"),
    ).toThrow(/head/);
  });
});

describe("adminBrand (where the name and the favicon come from)", () => {
  it("takes the name from the English app.name the admin renders (a fork's override included), before the UI language is known", () => {
    // From the messages, never a literal: renaming the admin (`docs/customization.md`, step 10) needs no test edit.
    expect(adminBrand(publicDir([])).name).toBe(eagerMessages.en["app.name"]);
    expect(adminBrand(publicDir([])).name).toBe(adminName(enCommon, enOverrides));
  });

  it("prefers the fork's override of app.name over the template's text", () => {
    expect(adminName({ "app.name": "Template" }, {})).toBe("Template");
    expect(adminName({ "app.name": "Template" }, { "app.name": "Fork" })).toBe("Fork");
    expect(() => adminName({ "app.name": "Template" }, { "app.name": "" })).toThrow(/app\.name/);
  });

  it("uses no favicon by default, and the first fork-supplied file of the public folder otherwise", () => {
    expect(adminBrand(publicDir([])).favicon).toBeNull();
    expect(adminBrand("").favicon).toBeNull();
    expect(adminBrand(publicDir(["favicon.ico"])).favicon).toBe("favicon.ico");
    expect(adminBrand(publicDir(["favicon.ico", "favicon.svg"])).favicon).toBe("favicon.svg");
    expect(FAVICON_FILES).toEqual(["favicon.svg", "favicon.png", "favicon.ico"]);
  });
});

describe("messageOverrideProblems (the build refuses a broken src/messages-overrides file)", () => {
  /** A source folder with one message file per locale and the given overrides. */
  function sourceDir(overrides: Record<"uk" | "en", unknown>): string {
    const dir = publicDir([]);
    for (const locale of ["uk", "en"] as const) {
      mkdirSync(join(dir, "messages", locale), { recursive: true });
      writeFileSync(join(dir, "messages", locale, "a.json"), '{"app.name":"A"}');
      writeFileSync(join(dir, "messages", locale, "b.json"), '{"orders.title":"B"}');
      mkdirSync(join(dir, "messages-overrides"), { recursive: true });
      writeFileSync(
        join(dir, "messages-overrides", `${locale}.json`),
        JSON.stringify(overrides[locale]),
      );
    }
    return dir;
  }

  it("accepts overrides of keys in any message file, eager or lazy", () => {
    expect(
      messageOverrideProblems(sourceDir({ uk: {}, en: { "app.name": "X", "orders.title": "Y" } })),
    ).toEqual([]);
  });

  it("names an unknown key and a value that is not a non-empty string", () => {
    expect(
      messageOverrideProblems(sourceDir({ uk: { "app.nmae": "X" }, en: { "app.name": 1 } })),
    ).toEqual([
      'Message override "app.nmae" in src/messages-overrides/uk.json has no base message (a typo, or a key upstream renamed or removed).',
      'Message override "app.name" in src/messages-overrides/en.json must be a non-empty string.',
    ]);
  });

  it("finds nothing in this repository", () => {
    expect(messageOverrideProblems(join(import.meta.dirname, "src"))).toEqual([]);
  });

  it("stops the build: the plugin throws once the config is resolved", () => {
    const root = publicDir([]);
    const source = sourceDir({ uk: {}, en: { "app.nmae": "X" } });
    renameSync(source, join(root, "src"));
    const configResolved = adminBrandHtml().configResolved as (config: object) => void;
    expect(() => {
      configResolved({ root, publicDir: "", base: "/" });
    }).toThrow(/"app\.nmae" in src\/messages-overrides\/en\.json has no base message/);
  });
});
