import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// `scripts/messages-extract-overrides.mjs` (plan 2026-11-08-design-changeability.md, WP3 M2): a fork's one-time move from
// its edited flat `uk.json` to `src/messages-overrides/uk.json`. Run as the fork would run it, as a plain Node script.
const script = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "messages-extract-overrides.mjs",
);
const directory = mkdtempSync(join(tmpdir(), "storefront-extract-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function file(name: string, content: unknown): string {
  const path = join(directory, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const upstream = {
  "site.name": "Demo shop",
  "site.title": "Demo shop — online store",
  "nav.cart": "Cart",
  "home.hero.title": "Welcome",
};

describe("messages-extract-overrides script", () => {
  it("writes exactly the keys whose fork text differs from upstream's, as a JSON object", () => {
    const fork = { ...upstream, "site.name": "Verde Kopi", "home.hero.title": "Fresh coffee" };
    const out = join(directory, "overrides-1.json");
    const result = run(
      "--fork",
      file("fork-1.json", fork),
      "--upstream",
      file("up-1.json", upstream),
      "--out",
      out,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({
      "site.name": "Verde Kopi",
      "home.hero.title": "Fresh coffee",
    });
  });

  it("prints to stdout without --out, and an unchanged fork gives {}", () => {
    const result = run(
      "--fork",
      file("fork-2.json", upstream),
      "--upstream",
      file("up-2.json", upstream),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });

  it("reports keys the fork added (no override possible) and keys it removed, and leaves them out", () => {
    const fork: Record<string, string> = {
      ...upstream,
      "site.name": "Verde",
      "promo.banner": "Sale",
    };
    delete fork["nav.cart"];
    const result = run(
      "--fork",
      file("fork-3.json", fork),
      "--upstream",
      file("up-3.json", upstream),
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ "site.name": "Verde" });
    expect(result.stderr).toMatch(/not in upstream.*\n.*promo\.banner/);
    expect(result.stderr).toMatch(/removed.*\n.*nav\.cart/);
  });

  it("with --messages, leaves out and reports overrides whose key the current upstream area files no longer have", () => {
    const current = join(directory, "current-uk");
    mkdirSync(current);
    file("current-uk/shell.json", { "site.name": "Demo shop", "nav.cart": "Cart" });
    const fork = { ...upstream, "site.name": "Verde", "site.title": "Verde shop" };
    const result = run(
      "--fork",
      file("fork-4.json", fork),
      "--upstream",
      file("up-4.json", upstream),
      "--messages",
      current,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ "site.name": "Verde" });
    expect(result.stderr).toMatch(/no longer.*\n.*site\.title/);
  });

  it("fails with a usage message on missing arguments and names a file that is not a JSON object", () => {
    expect(run("--fork", file("fork-5.json", upstream)).status).toBe(2);
    const bad = run("--fork", file("fork-6.json", "{"), "--upstream", file("up-6.json", upstream));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("fork-6.json");
  });

  it("refuses a flag where a value belongs (`--fork --upstream x`), naming the option (review m3 of PR 241)", () => {
    const up = file("up-7.json", upstream);
    for (const args of [
      ["--fork", "--upstream", up],
      ["--fork", file("fork-7.json", upstream), "--upstream", up, "--out"],
      ["--fork", file("fork-8.json", upstream), "--upstream", up, "--messages", "--out", "x"],
    ]) {
      const result = run(...args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr, args.join(" ")).toMatch(/--(fork|out|messages) needs a value/);
    }
  });

  it("creates the missing parent folders of --out", () => {
    const out = join(directory, "new", "folder", "uk.json");
    const fork = { ...upstream, "site.name": "Verde" };
    const result = run(
      "--fork",
      file("fork-9.json", fork),
      "--upstream",
      file("up-9.json", upstream),
      "--out",
      out,
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual({ "site.name": "Verde" });
  });
});
