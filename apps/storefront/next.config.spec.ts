import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const masterIdentity = join(import.meta.dirname, "src", "config", "legal-identity.json");
  const placeholderTextKeys = ["legal.privacy.intro", "legal.terms.intro", "legal.cookies.intro"];
  const filledIdentity = {
    shopLegalName: "Example Shop Ltd",
    shopLegalAddress: "1 Example Street, Kyiv",
    privacyContact: "privacy@example.test",
    lastUpdated: "2026-10-29",
  };

  /** A scratch copy of master's messages plus an identity file, for a case that edits some of them. */
  function scratch(
    edit: (messages: Record<string, string>) => void,
    identity: Record<string, unknown> = filledIdentity,
  ) {
    const directory = mkdtempSync(join(tmpdir(), "storefront-legal-"));
    for (const language of ["en", "uk"]) {
      const messages = JSON.parse(
        readFileSync(join(masterMessages, `${language}.json`), "utf8"),
      ) as Record<string, string>;
      edit(messages);
      writeFileSync(join(directory, `${language}.json`), JSON.stringify(messages));
    }
    const identityFile = join(directory, "legal-identity.json");
    writeFileSync(identityFile, JSON.stringify(identity));
    return { directory, identityFile };
  }

  function failureOf(options: { messagesDir: string; identityFile: string }): string {
    try {
      assertNoLegalPlaceholders({ enabled: true, ...options });
    } catch (error) {
      return (error as Error).message;
    }
    return "";
  }

  /** Master's messages with the marker taken out of every legal text (what a fork that wrote its own texts has). */
  function withoutMarkers(messages: Record<string, string>) {
    for (const [key, value] of Object.entries(messages)) {
      if (key.startsWith("legal.")) messages[key] = value.replace(LEGAL_MARKER, "").trim();
    }
  }

  it("uses the marker the legal config names, and master carries it in the intro of every legal page in both languages", () => {
    expect(LEGAL_MARKER).toBe(LEGAL_PLACEHOLDER_MARKER);
    const message = failureOf({ messagesDir: masterMessages, identityFile: masterIdentity });
    for (const file of ["en.json", "uk.json"]) {
      for (const key of placeholderTextKeys) expect(message).toContain(`${file}: ${key}`);
    }
  });

  it("names the files and keys of every message that still carries the marker, and no other", () => {
    const message = failureOf({ messagesDir: masterMessages, identityFile: masterIdentity });
    expect(message).not.toContain("legal.privacy.title");
    expect(message).not.toContain("legal.placeholder");
  });

  it("refuses while one legal text still carries the marker, however the placeholder box messages were edited", () => {
    for (const key of placeholderTextKeys) {
      const { directory, identityFile } = scratch((messages) => {
        withoutMarkers(messages);
        messages[key] = `${LEGAL_MARKER} ${messages[key]}`;
        for (const box of ["legal.placeholder.title", "legal.placeholder.body"]) messages[box] = "";
      });
      try {
        expect(failureOf({ messagesDir: directory, identityFile }), key).toContain(
          `en.json: ${key}`,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("refuses a controller identity that is unset, empty or blank, naming the field", () => {
    for (const field of Object.keys(filledIdentity)) {
      for (const bad of [null, "", "   "]) {
        const { directory, identityFile } = scratch(withoutMarkers, {
          ...filledIdentity,
          [field]: bad,
        });
        try {
          const message = failureOf({ messagesDir: directory, identityFile });
          expect(message, `${field}=${JSON.stringify(bad)}`).toContain(field);
          expect(message).not.toContain("en.json");
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  });

  it("refuses an identity file that lacks a field", () => {
    const { directory, identityFile } = scratch(withoutMarkers, {});
    try {
      const message = failureOf({ messagesDir: directory, identityFile });
      for (const field of Object.keys(filledIdentity)) expect(message).toContain(field);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses master's own identity file, where every field is unset", () => {
    const { directory } = scratch(withoutMarkers);
    try {
      const message = failureOf({ messagesDir: directory, identityFile: masterIdentity });
      for (const field of Object.keys(filledIdentity)) expect(message).toContain(field);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the identity file cannot be read", () => {
    const { directory } = scratch(withoutMarkers);
    try {
      expect(() =>
        assertNoLegalPlaceholders({
          enabled: true,
          messagesDir: directory,
          identityFile: join(directory, "missing.json"),
        }),
      ).toThrow(/identity/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes for a fully filled-in set: no marker in any legal text and a complete identity", () => {
    const { directory, identityFile } = scratch(withoutMarkers);
    try {
      expect(() =>
        assertNoLegalPlaceholders({ enabled: true, messagesDir: directory, identityFile }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("looks only at legal messages for the marker", () => {
    const { directory, identityFile } = scratch((messages) => {
      withoutMarkers(messages);
      messages["site.note"] = `x ${LEGAL_MARKER} y`;
    });
    try {
      expect(() =>
        assertNoLegalPlaceholders({ enabled: true, messagesDir: directory, identityFile }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does nothing while the check is off (master builds with its placeholders)", () => {
    expect(() =>
      assertNoLegalPlaceholders({
        enabled: false,
        messagesDir: masterMessages,
        identityFile: masterIdentity,
      }),
    ).not.toThrow();
    expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow();
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
