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

describe("no network in tests, and only api.brevo.com in the plugin", () => {
  it("refuses a request to a real host (the guard of every spec file)", async () => {
    await expect(fetch("https://api.brevo.com/v3/smtp/email", { method: "POST" })).rejects.toThrow(
      /no-network guard/,
    );
    expect(refusedHosts()).toEqual(["api.brevo.com"]);
    // Cleared here on purpose: this spec tests the guard; any other refusal fails its spec file.
    refusedHosts().length = 0;
  });

  it("reaches the network only through fetch: no socket module in the shipped sources", () => {
    const sources = shippedSources();
    expect(sources.map(([name]) => name).sort()).toEqual(
      [
        "answer-map.ts",
        "config.ts",
        "http.ts",
        "index.ts",
        "outbound-client.ts",
        "request.ts",
        "brevo-provider.ts",
        "webhook.ts",
      ].sort(),
    );
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(
        /from\s+["']node:(http|https|net|tls|dgram|child_process)["']/,
      );
      expect(text, name).not.toMatch(/from\s+["'](http|https|net|tls|undici|axios|node-fetch)["']/);
    }
  });

  it("names no host but api.brevo.com over https (and the local stub form over http)", () => {
    const https = new Set<string>();
    const http = new Set<string>();
    for (const [, text] of shippedSources()) {
      for (const match of text.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
        https.add(match[1] ?? "");
      }
      for (const match of text.matchAll(/http:\/\/([a-z0-9.-]+)/gi)) {
        http.add(match[1] ?? "");
      }
    }
    expect([...https]).toEqual(["api.brevo.com"]);
    expect([...http]).toEqual(["127.0.0.1"]);
  });

  it("reads only its API key and webhook secret, in module factories and the config accessors", () => {
    for (const [name, text] of shippedSources()) {
      const reads = [...text.matchAll(/process\.env(?:\.([A-Z_]+))?/g)].map((match) => match[0]);
      const variables = [...text.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
      if (name === "index.ts") {
        expect(reads, name).toEqual(["process.env", "process.env"]);
      } else {
        expect(reads, name).toEqual([]);
      }
      expect(
        variables.every(
          (variable) => variable === "BREVO_API_KEY" || variable === "BREVO_WEBHOOK_SECRET",
        ),
        name,
      ).toBe(true);
    }
  });
});
