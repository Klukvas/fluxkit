import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { refusedHosts } from "./test-support/no-network.js";

const SOURCE_DIR = fileURLToPath(new URL(".", import.meta.url));

/** The plugin's shipped sources (no specs, no test support). */
function shippedSources(): [string, string][] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))
    .map((name) => [name, readFileSync(join(SOURCE_DIR, name), "utf8")]);
}

describe("no network in tests, and only the two Nova Post hosts in the plugin", () => {
  it("refuses a request to a real host (the guard of every spec file)", async () => {
    await expect(fetch("https://api.novapost.com/v.1.0/divisions")).rejects.toThrow(
      /no-network guard/,
    );
    expect(refusedHosts()).toEqual(["api.novapost.com"]);
    // Cleared here on purpose: this spec tests the guard; any other refusal fails its spec file.
    refusedHosts().length = 0;
  });

  it("reaches the network only through fetch: no socket module in the shipped sources", () => {
    const sources = shippedSources();
    expect(sources.length).toBeGreaterThan(5);
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(
        /from\s+["']node:(http|https|net|tls|dgram|child_process)["']/,
      );
      expect(text, name).not.toMatch(/from\s+["'](http|https|net|tls|undici|axios|node-fetch)["']/);
    }
  });

  it("names no host but the two base URL constants (and the documentation portal in comments)", () => {
    const hosts = new Set<string>();
    for (const [, text] of shippedSources()) {
      for (const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
        hosts.add(match[1] ?? "");
      }
    }
    expect([...hosts].sort()).toEqual(
      ["api-portal.novapost.com", "api-stage.novapost.com", "api.novapost.com"].sort(),
    );
  });
});
