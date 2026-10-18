import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const root = import.meta.dirname;
const files = sourceFiles(root).map((path) => ({
  path: relative(root, path),
  text: readFileSync(path, "utf8"),
}));
const clientFiles = files.filter((file) => /^\s*["']use client["']/.test(file.text));

// What must not reach the browser bundle: server-only wiring, the environment parser (zod) and the domain core.
const forbidden = [
  /\.server["']/, // lib/store-data.server
  /["']@fluxkit\/config["']/,
  /["']@fluxkit\/core["']/,
  /["']next\/server["']/,
];

describe("client bundle boundary", () => {
  it("finds the client components it is meant to guard", () => {
    expect(clientFiles.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        join("components", "cart-badge.tsx"),
        join("components", "account-link.tsx"),
        join("components", "locale-switcher.tsx"),
        join("components", "i18n-provider.tsx"),
      ]),
    );
  });

  it("keeps server-only modules, @fluxkit/config and @fluxkit/core out of every 'use client' file", () => {
    for (const file of clientFiles) {
      for (const pattern of forbidden) {
        expect(pattern.test(file.text), `${file.path} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("imports @fluxkit/core nowhere in the storefront source (it is not needed yet)", () => {
    for (const file of files) {
      expect(file.text, file.path).not.toMatch(/["']@fluxkit\/core["']/);
    }
  });

  it("imports the server-only store data module from server files only", () => {
    const importers = files.filter((file) => /store-data\.server["']/.test(file.text));
    expect(importers.length).toBeGreaterThan(0);
    for (const file of importers) expect(clientFiles).not.toContain(file);
  });
});
