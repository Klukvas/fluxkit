import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adminBrand, brandIndexHtml, FAVICON_FILES } from "./brand-html";
import enCommon from "./src/messages/en/common.json";

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
  it("takes the name from the English app.name: today's title, before the UI language is known", () => {
    expect(adminBrand(publicDir([])).name).toBe(enCommon["app.name"]);
  });

  it("uses no favicon by default, and the first fork-supplied file of the public folder otherwise", () => {
    expect(adminBrand(publicDir([])).favicon).toBeNull();
    expect(adminBrand("").favicon).toBeNull();
    expect(adminBrand(publicDir(["favicon.ico"])).favicon).toBe("favicon.ico");
    expect(adminBrand(publicDir(["favicon.ico", "favicon.svg"])).favicon).toBe("favicon.svg");
    expect(FAVICON_FILES).toEqual(["favicon.svg", "favicon.png", "favicon.ico"]);
  });
});
