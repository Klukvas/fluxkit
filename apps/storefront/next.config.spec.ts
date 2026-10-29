import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config, { LEGAL_MARKER, assertNoLegalPlaceholders, loadRootEnvFile } from "./next.config.js";
import { LEGAL_PLACEHOLDER_MARKER } from "./src/config/legal";

// `config()` looks for ../../.env relative to the working directory; point it at an empty directory so a developer's
// real .env cannot change what these tests see.
const emptyDirectory = mkdtempSync(join(tmpdir(), "storefront-cwd-"));
beforeEach(() => {
  vi.spyOn(process, "cwd").mockReturnValue(join(emptyDirectory, "apps", "storefront"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(() => rmSync(emptyDirectory, { recursive: true, force: true }));

async function rewritesFor(phase: string) {
  const resolved = config(phase);
  return resolved.rewrites === undefined ? [] : await resolved.rewrites();
}

describe("next.config store rewrite", () => {
  it("proxies /store/* to the API in the development server only", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000/");
    expect(await rewritesFor(PHASE_DEVELOPMENT_SERVER)).toEqual([
      { source: "/store/:path*", destination: "http://127.0.0.1:3000/store/:path*" },
    ]);
  });

  it("never rewrites in a production build or a production server, whatever the environment says", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.stubEnv("NODE_ENV", "development");
    expect(await rewritesFor(PHASE_PRODUCTION_BUILD)).toEqual([]);
    expect(await rewritesFor(PHASE_PRODUCTION_SERVER)).toEqual([]);
  });

  it("does not need API_INTERNAL_URL to build", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    expect(await rewritesFor(PHASE_PRODUCTION_BUILD)).toEqual([]);
  });

  it("fails loudly in development without a valid API_INTERNAL_URL, without echoing it", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    await expect(rewritesFor(PHASE_DEVELOPMENT_SERVER)).rejects.toThrow(/API_INTERNAL_URL/);
    vi.stubEnv("API_INTERNAL_URL", "http://user:hunter2@api:3000/path");
    const error = await rewritesFor(PHASE_DEVELOPMENT_SERVER).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(String(error)).toMatch(/API_INTERNAL_URL/);
    expect(String(error)).not.toContain("hunter2");
  });

  it("keeps the redirect from / to the default locale", async () => {
    const redirects = (await config(PHASE_PRODUCTION_BUILD).redirects?.()) ?? [];
    expect(redirects).toEqual([{ source: "/", destination: "/uk", permanent: false }]);
  });
});

describe("loadRootEnvFile", () => {
  const directory = mkdtempSync(join(tmpdir(), "storefront-env-"));
  const file = join(directory, ".env");
  writeFileSync(file, "FLUXKIT_TEST_FROM_FILE=file\nFLUXKIT_TEST_SHELL=file\n");
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  afterEach(() => {
    delete process.env.FLUXKIT_TEST_FROM_FILE;
    delete process.env.FLUXKIT_TEST_SHELL;
  });

  it("loads the file for the development and production servers without overriding the shell", () => {
    for (const phase of [PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER]) {
      delete process.env.FLUXKIT_TEST_FROM_FILE;
      process.env.FLUXKIT_TEST_SHELL = "shell";
      loadRootEnvFile(phase, file);
      expect(process.env.FLUXKIT_TEST_FROM_FILE).toBe("file");
      expect(process.env.FLUXKIT_TEST_SHELL).toBe("shell");
    }
  });

  it("does not read the file for a build", () => {
    loadRootEnvFile(PHASE_PRODUCTION_BUILD, file);
    expect(process.env.FLUXKIT_TEST_FROM_FILE).toBeUndefined();
  });

  it("accepts a missing file", () => {
    expect(() =>
      loadRootEnvFile(PHASE_DEVELOPMENT_SERVER, join(directory, "missing.env")),
    ).not.toThrow();
  });
});

describe("next.config headers", () => {
  async function headersFor(phase: string) {
    const resolved = config(phase);
    return resolved.headers === undefined ? [] : await resolved.headers();
  }

  it("applies the security headers to every path, then no-referrer to the guest order page, the emailed-link pages and the payment return page", async () => {
    const rules = await headersFor(PHASE_PRODUCTION_BUILD);
    expect(rules).toHaveLength(4);
    expect(rules[0]?.source).toBe("/:path*");
    expect(rules[1]).toEqual({
      source: "/:locale/order/:path*",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    });
    expect(rules[2]).toEqual({
      source: "/:locale/account/:page(forgot-password|reset-password|verify-email)",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    });
    expect(rules[3]).toEqual({
      source: "/:locale/payment/return",
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    });
    const names = rules[0]?.headers.map((header) => header.key) ?? [];
    expect(names).toEqual(
      expect.arrayContaining([
        "Content-Security-Policy",
        "X-Content-Type-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "Strict-Transport-Security",
      ]),
    );
  });

  it("reads STOREFRONT_IMAGE_HOSTS without needing API_INTERNAL_URL (a build has no runtime settings)", async () => {
    vi.stubEnv("API_INTERNAL_URL", "");
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "cdn.example.com");
    const rules = await headersFor(PHASE_PRODUCTION_BUILD);
    const csp = rules[0]?.headers.find((header) => header.key === "Content-Security-Policy");
    expect(csp?.value).toContain("img-src 'self' data: https://cdn.example.com");
  });

  it("fails loudly on a malformed STOREFRONT_IMAGE_HOSTS", async () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "https://cdn.example.com/path");
    await expect(headersFor(PHASE_PRODUCTION_BUILD)).rejects.toThrow(/STOREFRONT_IMAGE_HOSTS/);
  });

  it("relaxes the policy for the development server only", async () => {
    const development = await headersFor(PHASE_DEVELOPMENT_SERVER);
    const production = await headersFor(PHASE_PRODUCTION_SERVER);
    const cspOf = (rules: typeof development) =>
      rules[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    expect(cspOf(development)).toContain("'unsafe-eval'");
    expect(cspOf(production)).not.toContain("'unsafe-eval'");
    expect(development[0]?.headers.some((h) => h.key === "Strict-Transport-Security")).toBe(false);
  });
});

describe("next.config images", () => {
  it("lets next/image optimize https images of exactly the configured hosts, without wildcards", () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "cdn.example.com, Images.Example.org");
    expect(config(PHASE_PRODUCTION_BUILD).images?.remotePatterns).toEqual([
      { protocol: "https", hostname: "cdn.example.com" },
      { protocol: "https", hostname: "images.example.org" },
    ]);
  });

  it("allows no remote image at all without STOREFRONT_IMAGE_HOSTS", () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "");
    expect(config(PHASE_PRODUCTION_BUILD).images?.remotePatterns ?? []).toEqual([]);
  });

  it("uses the same hosts for the CSP img-src and the optimizer", async () => {
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "cdn.example.com");
    const resolved = config(PHASE_PRODUCTION_BUILD);
    const rules = (await resolved.headers?.()) ?? [];
    const csp = rules[0]?.headers.find((header) => header.key === "Content-Security-Policy")?.value;
    expect(csp).toContain("https://cdn.example.com");
    expect(resolved.images?.remotePatterns).toEqual([
      { protocol: "https", hostname: "cdn.example.com" },
    ]);
  });
});

describe("next.config legal placeholder guard (privacy plan step 10)", () => {
  const masterMessages = join(import.meta.dirname, "src", "messages");

  it("uses the marker the legal config names, and master carries it in both languages", () => {
    expect(LEGAL_MARKER).toBe(LEGAL_PLACEHOLDER_MARKER);
    expect(() => assertNoLegalPlaceholders({ enabled: true, messagesDir: masterMessages })).toThrow(
      /legal\.placeholder\.marker/,
    );
  });

  it("names the files and keys of every message that still carries the marker, and no other", () => {
    let message = "";
    try {
      assertNoLegalPlaceholders({ enabled: true, messagesDir: masterMessages });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("en.json: legal.placeholder.marker");
    expect(message).toContain("uk.json: legal.placeholder.marker");
    expect(message).not.toContain("legal.privacy.title");
  });

  it("does nothing while the check is off (master builds with its placeholders)", () => {
    expect(() =>
      assertNoLegalPlaceholders({ enabled: false, messagesDir: masterMessages }),
    ).not.toThrow();
    expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow();
  });

  it("passes when no legal message carries the marker, and only legal messages count", () => {
    const directory = mkdtempSync(join(tmpdir(), "storefront-legal-"));
    try {
      writeFileSync(
        join(directory, "en.json"),
        JSON.stringify({ "legal.privacy.title": "Privacy", "site.note": `x ${LEGAL_MARKER} y` }),
      );
      expect(() =>
        assertNoLegalPlaceholders({ enabled: true, messagesDir: directory }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when asked to check and the messages cannot be read", () => {
    vi.stubEnv("STOREFRONT_REQUIRE_LEGAL_TEXT", "true");
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/messages/);
  });

  it("checks only for a production build, not for the dev server or a running server", () => {
    vi.stubEnv("STOREFRONT_REQUIRE_LEGAL_TEXT", "true");
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    expect(() => config(PHASE_PRODUCTION_SERVER)).not.toThrow();
    expect(() => config(PHASE_DEVELOPMENT_SERVER)).not.toThrow();
  });
});
