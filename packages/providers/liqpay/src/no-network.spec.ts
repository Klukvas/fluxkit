import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { refusedHosts } from "./test-support/no-network.js";

const SOURCE_DIR = fileURLToPath(new URL(".", import.meta.url));

function shippedSources(): [string, string][] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"))
    .map((name) => [name, readFileSync(join(SOURCE_DIR, name), "utf8")]);
}

describe("no network in tests, and only www.liqpay.ua in the plugin", () => {
  it("refuses a request to a real host", async () => {
    await expect(fetch("https://www.liqpay.ua/api/request")).rejects.toThrow(/no-network guard/);
    expect(refusedHosts()).toEqual(["www.liqpay.ua"]);
    refusedHosts().length = 0;
  });

  it("reaches the network only through fetch in shipped sources", () => {
    const sources = shippedSources();
    expect(sources.map(([name]) => name).sort()).toEqual(
      [
        "answer-map.ts",
        "config.ts",
        "http.ts",
        "index.ts",
        "liqpay-provider.ts",
        "payload-money.ts",
        "payload.ts",
        "signature.ts",
      ].sort(),
    );
    for (const [name, text] of sources) {
      expect(text, name).not.toMatch(
        /from\s+["']node:(http|https|net|tls|dgram|child_process)["']/,
      );
      expect(text, name).not.toMatch(/from\s+["'](http|https|net|tls|undici|axios|node-fetch)["']/);
    }
  });

  it("names no host but www.liqpay.ua over https (and 127.0.0.1 for stubs)", () => {
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
    expect([...https]).toEqual(["www.liqpay.ua"]);
    expect([...http]).toEqual(["127.0.0.1"]);
  });

  it("reads only LIQPAY_* keys from process.env in the module factory", () => {
    for (const [name, text] of shippedSources()) {
      const reads = [...text.matchAll(/process\.env(?:\.([A-Z_]+))?/g)].map((match) => match[0]);
      const variables = [...text.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]);
      if (name === "index.ts") {
        expect(reads, name).toEqual(["process.env"]);
      } else {
        expect(reads, name).toEqual([]);
      }
      expect(
        variables.every(
          (variable) => variable === "LIQPAY_PUBLIC_KEY" || variable === "LIQPAY_PRIVATE_KEY",
        ),
        name,
      ).toBe(true);
    }
  });
});
