import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import config, {
  DEMO_CONTENT_FLAGS,
  LEGAL_MARKER,
  assertNoLegalPlaceholders,
  demoContentLeft,
  loadRootEnvFile,
  readMergedMessages,
} from "./next.config.js";
import { LEGAL_PLACEHOLDER_MARKER } from "./src/config/legal";
import { messagesByLocale } from "./src/messages";

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
  it("proxies /store/* and /media/* to the API in the development server only", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000/");
    expect(await rewritesFor(PHASE_DEVELOPMENT_SERVER)).toEqual([
      { source: "/store/:path*", destination: "http://127.0.0.1:3000/store/:path*" },
      { source: "/media/:path*", destination: "http://127.0.0.1:3000/media/:path*" },
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

// Owner decision 2026-11-01 (plan docs/plans/2026-11-01-demo-images-local-run.md, option a): local product images in
// `next dev` only. A production build or server must keep the policy of ADR 0028 / owner answer 7 exactly.
describe("next.config development media rule", () => {
  const productionPhases = [PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER];

  it("gives the dev server the API's media prefix: MEDIA_PUBLIC_BASE_URL, else API_INTERNAL_URL + /media", () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "");
    expect(config(PHASE_DEVELOPMENT_SERVER).env).toEqual({
      FLUXKIT_DEV_MEDIA_BASE_URL: "http://127.0.0.1:3000/media",
    });
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "http://127.0.0.1:4000/media");
    expect(config(PHASE_DEVELOPMENT_SERVER).env).toEqual({
      FLUXKIT_DEV_MEDIA_BASE_URL: "http://127.0.0.1:4000/media",
    });
  });

  it("fails loudly in development on a malformed MEDIA_PUBLIC_BASE_URL, without echoing it", () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "not a url secret-value");
    expect(() => config(PHASE_DEVELOPMENT_SERVER)).toThrow(/MEDIA_PUBLIC_BASE_URL/);
    expect(() => config(PHASE_DEVELOPMENT_SERVER)).not.toThrow(/secret-value/);
  });

  it("is absent from a production build and a production server, whatever the environment says", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://127.0.0.1:3000");
    vi.stubEnv("MEDIA_PUBLIC_BASE_URL", "http://127.0.0.1:3000/media");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("STOREFRONT_IMAGE_HOSTS", "cdn.example.com");
    // Review F1 of PR 209: even an exported prefix (with NODE_ENV=development forced) cannot switch the rule on in a
    // build, because the build inlines an EMPTY prefix into every bundle, server code included.
    vi.stubEnv("FLUXKIT_DEV_MEDIA_BASE_URL", "http://127.0.0.1:3000/media");
    for (const phase of productionPhases) {
      const resolved = config(phase);
      expect(resolved.env, phase).toEqual({ FLUXKIT_DEV_MEDIA_BASE_URL: "" });
      expect(await rewritesFor(phase), phase).toEqual([]);
      // Exactly today's image policy: https on the listed hosts, nothing local or plain http.
      expect(resolved.images, phase).toEqual({
        remotePatterns: [{ protocol: "https", hostname: "cdn.example.com" }],
      });
    }
  });
});

describe("next.config legal placeholder guard (privacy plan step 10)", () => {
  const masterMessages = join(import.meta.dirname, "src", "messages");
  const masterOverrides = join(import.meta.dirname, "src", "messages-overrides");
  const masterIdentity = join(import.meta.dirname, "src", "config", "legal-identity.json");
  const placeholderTextKeys = ["legal.privacy.intro", "legal.terms.intro", "legal.cookies.intro"];
  const filledIdentity = {
    shopLegalName: "Example Shop Ltd",
    shopLegalAddress: "1 Example Street, Kyiv",
    privacyContact: "privacy@example.test",
    lastUpdated: "2026-10-29",
  };

  const masterDemoContent = join(import.meta.dirname, "src", "config", "demo-content.json");
  /** What a fork that replaced every demo text has (repair batch 2). */
  const clearedDemo = { shopPages: [], contacts: false, home: false, trustBar: false };
  const sharedDirectory = mkdtempSync(join(tmpdir(), "storefront-demo-"));
  const clearedDemoFile = join(sharedDirectory, "demo-content.json");
  writeFileSync(clearedDemoFile, JSON.stringify(clearedDemo));
  afterAll(() => rmSync(sharedDirectory, { recursive: true, force: true }));

  /**
   * A scratch copy of master's messages (the area files `<locale>/<area>.json`, plan 2026-11-08-design-changeability.md
   * WP3), an overrides folder and an identity file. `edit` changes the merged base of each locale; every key is written
   * back to the area file it came from (a new key to `extra.json`). `overrides` are the override files' contents.
   */
  function scratch(
    edit: (messages: Record<string, string>) => void,
    identity: Record<string, unknown> = filledIdentity,
    overrides: Record<string, Record<string, unknown>> = { en: {}, uk: {} },
  ) {
    const directory = mkdtempSync(join(tmpdir(), "storefront-legal-"));
    const messagesDir = join(directory, "messages");
    const overridesDir = join(directory, "messages-overrides");
    mkdirSync(overridesDir, { recursive: true });
    for (const language of ["en", "uk"]) {
      const origin = new Map<string, string>();
      const messages: Record<string, string> = {};
      for (const file of readdirSync(join(masterMessages, language))) {
        const area = JSON.parse(
          readFileSync(join(masterMessages, language, file), "utf8"),
        ) as Record<string, string>;
        for (const [key, value] of Object.entries(area)) {
          messages[key] = value;
          origin.set(key, file);
        }
      }
      edit(messages);
      const byFile: Record<string, Record<string, string>> = {};
      for (const [key, value] of Object.entries(messages)) {
        const file = origin.get(key) ?? "extra.json";
        (byFile[file] ??= {})[key] = value;
      }
      mkdirSync(join(messagesDir, language), { recursive: true });
      for (const [file, content] of Object.entries(byFile)) {
        writeFileSync(join(messagesDir, language, file), JSON.stringify(content));
      }
    }
    for (const [language, content] of Object.entries(overrides)) {
      writeFileSync(join(overridesDir, `${language}.json`), JSON.stringify(content));
    }
    const identityFile = join(directory, "legal-identity.json");
    writeFileSync(identityFile, JSON.stringify(identity));
    return { directory, messagesDir, overridesDir, identityFile };
  }

  function failureOf(options: {
    messagesDir: string;
    overridesDir?: string;
    identityFile: string;
    demoContentFile?: string;
  }): string {
    try {
      assertNoLegalPlaceholders({
        enabled: true,
        demoContentFile: clearedDemoFile,
        overridesDir: masterOverrides,
        ...options,
      });
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
    for (const language of ["en", "uk"]) {
      for (const key of placeholderTextKeys) {
        expect(message).toContain(`messages/${language}/legal.json: ${key}`);
      }
    }
  });

  it("reads the merged messages the app uses: the same texts as messagesByLocale (area files plus overrides)", () => {
    const merged = readMergedMessages(masterMessages, masterOverrides);
    expect(Object.keys(merged).sort()).toEqual(Object.keys(messagesByLocale).sort());
    for (const [language, messages] of Object.entries(merged)) {
      const values = Object.fromEntries(
        Object.entries(messages).map(([key, entry]) => [key, entry.value]),
      );
      expect(values, language).toEqual(messagesByLocale[language as keyof typeof messagesByLocale]);
    }
  });

  it("refuses a marker inside an area file of a locale folder (the split files are read, not only top-level files)", () => {
    const { directory, messagesDir, overridesDir, identityFile } = scratch((messages) => {
      withoutMarkers(messages);
      messages["legal.terms.intro"] = `${LEGAL_MARKER} ${messages["legal.terms.intro"]}`;
    });
    try {
      const message = failureOf({ messagesDir, overridesDir, identityFile });
      expect(message).toContain("messages/en/legal.json: legal.terms.intro");
      expect(message).toContain("messages/uk/legal.json: legal.terms.intro");
      expect(message).not.toContain("legal.privacy.intro");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes when an override replaces every marked text (a fork's own texts in messages-overrides)", () => {
    const replaced = Object.fromEntries(placeholderTextKeys.map((key) => [key, `Our own ${key}`]));
    const { directory, messagesDir, overridesDir, identityFile } = scratch(
      () => {},
      filledIdentity,
      { en: replaced, uk: replaced },
    );
    try {
      expect(failureOf({ messagesDir, overridesDir, identityFile })).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses while one locale's override leaves a marked text, naming the override file that carries it", () => {
    const replaced = Object.fromEntries(placeholderTextKeys.map((key) => [key, `Our own ${key}`]));
    const { directory, messagesDir, overridesDir, identityFile } = scratch(
      () => {},
      filledIdentity,
      { en: replaced, uk: { ...replaced, "legal.cookies.intro": `${LEGAL_MARKER} copied` } },
    );
    try {
      const message = failureOf({ messagesDir, overridesDir, identityFile });
      expect(message).toContain("messages-overrides/uk.json: legal.cookies.intro");
      expect(message).not.toContain("legal.json");
      expect(message).not.toContain("legal.privacy.intro");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on a messages folder without area files (the check must never pass by finding nothing)", () => {
    const { directory, overridesDir, identityFile } = scratch(withoutMarkers);
    const empty = join(directory, "empty-messages");
    mkdirSync(empty);
    try {
      expect(failureOf({ messagesDir: empty, overridesDir, identityFile })).toMatch(
        /no message files/,
      );
      mkdirSync(join(empty, "en"));
      expect(failureOf({ messagesDir: empty, overridesDir, identityFile })).toMatch(
        /no message files/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on an old flat message file left at the top of the messages folder (the app would ignore it)", () => {
    const { directory, messagesDir, overridesDir, identityFile } = scratch(withoutMarkers);
    writeFileSync(join(messagesDir, "uk.json"), JSON.stringify({ "legal.terms.intro": "x" }));
    try {
      expect(failureOf({ messagesDir, overridesDir, identityFile })).toMatch(/uk\.json.*flat/s);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed on an override value that is not a non-empty string, as the app's loader does (review M1 of PR 241)", () => {
    for (const bad of [42, null, ["x"], { a: "b" }, "", "   "]) {
      const { directory, messagesDir, overridesDir, identityFile } = scratch(
        withoutMarkers,
        filledIdentity,
        { en: { "legal.terms.intro": bad }, uk: {} },
      );
      try {
        expect(failureOf({ messagesDir, overridesDir, identityFile }), JSON.stringify(bad)).toMatch(
          /Message override "legal\.terms\.intro" in .*messages-overrides\/en\.json must be a non-empty string\./,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("fails closed on a key in two area files, an override of an unknown key, or a missing override file", () => {
    const duplicate = scratch(withoutMarkers);
    writeFileSync(
      join(duplicate.messagesDir, "en", "zz.json"),
      JSON.stringify({ "legal.terms.intro": "again" }),
    );
    const unknown = scratch(withoutMarkers, filledIdentity, {
      en: { "legal.trems.intro": "x" },
      uk: {},
    });
    const missing = scratch(withoutMarkers, filledIdentity, { en: {} });
    try {
      expect(failureOf(duplicate)).toMatch(/legal\.terms\.intro.*legal\.json.*zz\.json/s);
      expect(failureOf(unknown)).toMatch(/legal\.trems\.intro/);
      expect(failureOf(missing)).toMatch(/uk\.json/);
    } finally {
      for (const { directory } of [duplicate, unknown, missing]) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("names the files and keys of every message that still carries the marker, and no other", () => {
    const message = failureOf({ messagesDir: masterMessages, identityFile: masterIdentity });
    expect(message).not.toContain("legal.privacy.title");
    expect(message).not.toContain("legal.placeholder");
  });

  it("refuses while one legal text still carries the marker, however the placeholder box messages were edited", () => {
    for (const key of placeholderTextKeys) {
      const { directory, messagesDir, overridesDir, identityFile } = scratch((messages) => {
        withoutMarkers(messages);
        messages[key] = `${LEGAL_MARKER} ${messages[key]}`;
        for (const box of ["legal.placeholder.title", "legal.placeholder.body"]) messages[box] = "";
      });
      try {
        expect(failureOf({ messagesDir, overridesDir, identityFile }), key).toContain(
          `messages/en/legal.json: ${key}`,
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it("refuses a controller identity that is unset, empty or blank, naming the field", () => {
    for (const field of Object.keys(filledIdentity)) {
      for (const bad of [null, "", "   "]) {
        const { directory, messagesDir, overridesDir, identityFile } = scratch(withoutMarkers, {
          ...filledIdentity,
          [field]: bad,
        });
        try {
          const message = failureOf({ messagesDir, overridesDir, identityFile });
          expect(message, `${field}=${JSON.stringify(bad)}`).toContain(field);
          expect(message).not.toContain("legal.json");
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  });

  it("refuses an identity file that lacks a field", () => {
    const { directory, messagesDir, overridesDir, identityFile } = scratch(withoutMarkers, {});
    try {
      const message = failureOf({ messagesDir, overridesDir, identityFile });
      for (const field of Object.keys(filledIdentity)) expect(message).toContain(field);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses master's own identity file, where every field is unset", () => {
    const { directory, messagesDir, overridesDir } = scratch(withoutMarkers);
    try {
      const message = failureOf({ messagesDir, overridesDir, identityFile: masterIdentity });
      for (const field of Object.keys(filledIdentity)) expect(message).toContain(field);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when the identity file cannot be read", () => {
    const { directory, messagesDir, overridesDir } = scratch(withoutMarkers);
    try {
      expect(() =>
        assertNoLegalPlaceholders({
          enabled: true,
          messagesDir,
          overridesDir,
          identityFile: join(directory, "missing.json"),
          demoContentFile: clearedDemoFile,
        }),
      ).toThrow(/identity/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes for a fully filled-in set: no marker in any legal text, a complete identity and no demo content left", () => {
    const { directory, messagesDir, overridesDir, identityFile } = scratch(withoutMarkers);
    try {
      expect(() =>
        assertNoLegalPlaceholders({
          enabled: true,
          messagesDir,
          overridesDir,
          identityFile,
          demoContentFile: clearedDemoFile,
        }),
      ).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("looks only at legal messages for the marker", () => {
    const { directory, messagesDir, overridesDir, identityFile } = scratch((messages) => {
      withoutMarkers(messages);
      messages["site.note"] = `x ${LEGAL_MARKER} y`;
    });
    try {
      expect(() =>
        assertNoLegalPlaceholders({
          enabled: true,
          messagesDir,
          overridesDir,
          identityFile,
          demoContentFile: clearedDemoFile,
        }),
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
        overridesDir: masterOverrides,
        identityFile: masterIdentity,
        demoContentFile: masterDemoContent,
      }),
    ).not.toThrow();
    expect(() => config(PHASE_PRODUCTION_BUILD)).not.toThrow();
  });

  describe("demo content (repair batch 2: shop pages, contacts, home texts, trust bar)", () => {
    function demoFile(content: unknown): string {
      const file = join(sharedDirectory, `demo-${String(Math.random()).slice(2)}.json`);
      writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
      return file;
    }

    function demoFailure(demoContentFile: string): string {
      const { directory, messagesDir, overridesDir, identityFile } = scratch(withoutMarkers);
      try {
        return failureOf({ messagesDir, overridesDir, identityFile, demoContentFile });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }

    it("refuses master's own demo content, naming every shop page and every flag (texts and identity filled in)", () => {
      const message = demoFailure(masterDemoContent);
      const master = JSON.parse(readFileSync(masterDemoContent, "utf8")) as {
        shopPages: string[];
      };
      expect(master.shopPages.length).toBeGreaterThan(0);
      for (const slug of master.shopPages) expect(message).toContain(`shopPages: ${slug}`);
      for (const flag of DEMO_CONTENT_FLAGS) expect(message).toContain(`\n${flag}`);
      expect(message).toContain("demo copy");
      expect(message).not.toContain("legal.json");
    });

    it("refuses while a single page or a single flag is left, and names only that one", () => {
      expect(demoFailure(demoFile({ ...clearedDemo, shopPages: ["faq"] }))).toMatch(
        /\nshopPages: faq$/,
      );
      for (const flag of DEMO_CONTENT_FLAGS) {
        const message = demoFailure(demoFile({ ...clearedDemo, [flag]: true }));
        expect(message, flag).toMatch(new RegExp(`\\n${flag}$`));
        expect(message, flag).not.toContain("shopPages:");
      }
    });

    it("treats a missing entry as cleared, and false or [] as cleared", () => {
      expect(demoFailure(demoFile({}))).toBe("");
      expect(demoFailure(demoFile(clearedDemo))).toBe("");
    });

    it("fails closed on a missing file, a malformed file, an unknown key or a value of the wrong type", () => {
      expect(demoFailure(join(sharedDirectory, "missing.json"))).toMatch(/demo content file/);
      // Malformed JSON names the file (review m6 of PR 232).
      const malformed = demoFile("{");
      expect(demoFailure(malformed)).toContain(`${malformed} is not valid JSON`);
      expect(demoFailure(demoFile([]))).toMatch(/object/);
      expect(demoFailure(demoFile({ ...clearedDemo, contact: false }))).toMatch(
        /unknown keys: contact/,
      );
      expect(demoFailure(demoFile({ ...clearedDemo, home: "false" }))).toMatch(/"home" must be/);
      expect(demoFailure(demoFile({ ...clearedDemo, shopPages: "faq" }))).toMatch(/"shopPages"/);
      expect(demoFailure(demoFile({ ...clearedDemo, shopPages: [1] }))).toMatch(/"shopPages"/);
    });

    it("lists what is left without the check switched on (the same reader)", () => {
      expect(demoContentLeft(demoFile(clearedDemo))).toEqual([]);
      expect(demoContentLeft(demoFile({ shopPages: ["about"], trustBar: true }))).toEqual([
        "shopPages: about",
        "trustBar",
      ]);
    });
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
