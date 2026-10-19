import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import en from "./messages/en.json";
import { CLIENT_MESSAGE_PREFIXES } from "./lib/client-messages";

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

  it("serializes the namespace of every message key a 'use client' file writes out", () => {
    const namespaces = [...new Set(Object.keys(en).map((key) => key.split(".")[0]))];
    const quote = "[\"'`]";
    const literal = new RegExp(
      `${quote}((?:${namespaces.join("|")})\\.[A-Za-z0-9_.]*[A-Za-z0-9_])${quote}`,
      "g",
    );
    for (const file of clientFiles) {
      for (const match of file.text.matchAll(literal)) {
        const key = match[1] as string;
        const serialized = CLIENT_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix));
        expect(serialized, `${file.path} uses "${key}", which the browser does not receive`).toBe(
          true,
        );
      }
    }
  });

  it("makes the one cart read and the one session read of a page load in the session provider only", () => {
    const clients = clientFiles.filter((file) => /createStoreClient\(/.test(file.text));
    expect(clients.map((file) => file.path)).toEqual([join("components", "session-provider.tsx")]);
  });

  it("keeps the header islands from reading anything of their own (the badge shares the store's read)", () => {
    for (const name of ["cart-badge.tsx", "account-link.tsx"]) {
      const file = files.find((candidate) => candidate.path === join("components", name));
      expect(file, name).toBeDefined();
      expect(file?.text, name).not.toMatch(
        /\.(refresh|start|add|setQuantity|remove|clear|acknowledge)\(/,
      );
      expect(file?.text, name).not.toMatch(/\bfetch\(|useEffect/);
    }
  });
});
