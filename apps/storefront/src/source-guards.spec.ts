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
// Test fixtures hold API-shaped sample data (they may name options); real source must not.
const sources = sourceFiles(root)
  .filter((path) => !/test-(fixtures|helpers)\.tsx?$/.test(path))
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));

describe("source guards (AGENTS.md sections 2.3 and 11)", () => {
  it("finds the sources it guards", () => {
    expect(sources.length).toBeGreaterThan(30);
  });

  it("sets raw HTML only in the JSON-LD component, which escapes it", () => {
    const users = sources.filter((file) => file.text.includes("dangerouslySetInnerHTML"));
    expect(users.map((file) => file.path)).toEqual(["components/json-ld.tsx"]);
    expect(users[0]?.text).toContain("serializeJsonLd");
  });

  it("never hardcodes a niche-specific option or attribute name (they are data from the API)", () => {
    const niche = /["'`](size|sizes|color|colour|colors|material|weight|flavor|pack)["'`]/i;
    // `sizes="..."` of next/image is an attribute name, written without quotes around the word itself.
    for (const file of sources) {
      expect(niche.test(file.text), `${file.path} names a niche-specific field`).toBe(false);
    }
  });

  it("does no floating point money math (amounts are integers and strings)", () => {
    const floatMoney = /\/\s*100\b|\*\s*100\b|toFixed\(|parseFloat\(|Math\.round\([^)]*amount/;
    for (const file of sources) {
      expect(floatMoney.test(file.text), `${file.path} looks like float money math`).toBe(false);
    }
  });

  it("loads images only through StoreImage, so the host allow-list cannot be bypassed", () => {
    for (const file of sources) {
      if (file.path === join("components", "store-image.tsx")) continue;
      expect(file.text, file.path).not.toMatch(/from ["']next\/image["']/);
      expect(file.text, file.path).not.toMatch(/<img[\s>]/);
    }
  });

  // The cart, the session and the account forms (plan: "no secrets in logs, URLs or localStorage"). The checkout attempt of
  // step 7 may use sessionStorage for its idempotency key; that file is outside this pattern.
  const personal = sources.filter((file) =>
    /(^|\/)(cart|account|session|login|register|profile|form|use-form|failure)[^/]*\.tsx?$/.test(
      file.path,
    ),
  );

  it("finds the cart and account sources it guards", () => {
    expect(personal.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        join("lib", "cart-store.ts"),
        join("lib", "account-store.ts"),
        join("components", "login-form.tsx"),
        join("components", "use-form.ts"),
      ]),
    );
  });

  it("keeps the cart, the session and the account forms out of browser storage and cookies", () => {
    for (const file of personal) {
      expect(file.text, file.path).not.toMatch(
        /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/,
      );
    }
  });

  it("never logs a password or a form value", () => {
    for (const file of personal) {
      for (const call of file.text.matchAll(/console\.\w+\([^;]*\)/gs)) {
        expect(call[0], `${file.path} logs ${call[0]}`).not.toMatch(/password|values|body/i);
      }
    }
  });

  it("navigates only to paths built by the safe builders (no raw next, no raw URL)", () => {
    const calls = sources.flatMap((file) =>
      [...file.text.matchAll(/router\.(?:push|replace)\(([^;]*)\);/gs)].map((match) => ({
        path: file.path,
        argument: match[1] as string,
      })),
    );
    expect(calls.length).toBeGreaterThan(3);
    for (const call of calls) {
      expect(call.argument, `${call.path}: router.replace(${call.argument})`).toMatch(
        /^(safeNextPath\(|localizedHref\(|signInHref$)/,
      );
    }
    for (const file of sources) {
      expect(file.text, file.path).not.toMatch(/window\.location\s*(=|\.(href|assign|replace))/);
    }
  });
});
