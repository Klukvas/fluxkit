import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { locales, type Messages } from "@fluxkit/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_MESSAGE_PREFIXES, pickClientMessages } from "../lib/client-messages";
import {
  CUSTOM_NAMESPACE,
  MESSAGE_AREAS,
  MESSAGE_NAMESPACES,
  areaOfKey,
  namespaceOfKey,
} from "./areas";
import {
  MESSAGE_FILES,
  applyExtras,
  applyOverrides,
  baseMessagesByLocale,
  buildLocaleMessages,
  mergeAreas,
  messagesByLocale,
} from "./index";

const messagesDir = import.meta.dirname;
const overridesDir = join(import.meta.dirname, "..", "messages-overrides");
const extrasDir = join(import.meta.dirname, "..", "messages-extra");

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** The area files of a locale as they are on disk (not as `index.ts` imports them), so a stray or missing file shows. */
function filesOnDisk(locale: string): Record<string, Record<string, unknown>> {
  const directory = join(messagesDir, locale);
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [name, readJson(join(directory, name))]),
  );
}

const pluralSuffix = /\.(zero|one|two|few|many|other)$/;
/** Plural groups compared through their group name (uk has few and many, en has not). */
function comparableKeys(messages: Record<string, unknown>): string[] {
  return [...new Set(Object.keys(messages).map((key) => key.replace(pluralSuffix, ".*")))].sort();
}

describe("message area files (plan 2026-11-08-design-changeability.md, WP3 M1)", () => {
  it("keeps no flat message file at the top of src/messages (a fork's old uk.json would be silently ignored)", () => {
    const stray = readdirSync(messagesDir).filter((name) => name.endsWith(".json"));
    expect(stray).toEqual([]);
  });

  it("has one folder per locale, each holding exactly one JSON file per area", () => {
    const folders = readdirSync(messagesDir).filter((name) =>
      statSync(join(messagesDir, name)).isDirectory(),
    );
    expect(folders.sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      expect(Object.keys(filesOnDisk(locale)), locale).toEqual(
        MESSAGE_AREAS.map((area) => `${area}.json`).sort(),
      );
    }
  });

  it("puts every key in the file of its namespace (one map: MESSAGE_NAMESPACES)", () => {
    for (const locale of locales) {
      for (const [file, messages] of Object.entries(filesOnDisk(locale))) {
        for (const key of Object.keys(messages)) {
          expect(
            areaOfKey(key),
            `${locale}/${file}: ${key} has no namespace in areas.ts`,
          ).toBeDefined();
          expect(`${areaOfKey(key)}.json`, `${locale}/${file}: ${key}`).toBe(file);
        }
      }
    }
  });

  it("defines no key twice across the files of a locale", () => {
    for (const locale of locales) {
      const seen = new Map<string, string>();
      for (const [file, messages] of Object.entries(filesOnDisk(locale))) {
        for (const key of Object.keys(messages)) {
          expect(
            seen.get(key),
            `${locale}: ${key} in ${seen.get(key)} and ${file}`,
          ).toBeUndefined();
          seen.set(key, file);
        }
      }
    }
  });

  it("has the same keys in uk and en per area (plural groups compared by group)", () => {
    const uk = filesOnDisk("uk");
    const en = filesOnDisk("en");
    for (const file of Object.keys(uk)) {
      expect(comparableKeys(uk[file] ?? {}), file).toEqual(comparableKeys(en[file] ?? {}));
    }
  });

  it("names no unused namespace and no namespace whose area has no file (custom. has none: a fork's extras)", () => {
    const used = new Set(
      locales.flatMap((locale) =>
        Object.values(filesOnDisk(locale)).flatMap((messages) =>
          Object.keys(messages).map(namespaceOfKey),
        ),
      ),
    );
    const withAreaFile = Object.entries(MESSAGE_NAMESPACES)
      .filter(([, entry]) => entry.area !== null)
      .map(([namespace]) => namespace);
    expect([...used].sort()).toEqual(withAreaFile.sort());
    expect(used.has(CUSTOM_NAMESPACE)).toBe(false);
  });

  it("imports exactly the files on disk in index.ts, merged without loss", () => {
    for (const locale of locales) {
      const onDisk = filesOnDisk(locale);
      for (const area of MESSAGE_AREAS) {
        expect(MESSAGE_FILES[locale][area], `${locale}/${area}`).toEqual(onDisk[`${area}.json`]);
      }
      const total = Object.values(onDisk).reduce(
        (sum, messages) => sum + Object.keys(messages).length,
        0,
      );
      expect(Object.keys(baseMessagesByLocale[locale]).length, locale).toBe(total);
    }
  });

  it("refuses to merge a key defined in two area files, naming both", () => {
    expect(() => mergeAreas({ cart: { "cart.title": "a" }, shell: { "cart.title": "b" } })).toThrow(
      /cart\.title.*cart.*shell/,
    );
  });

  it("derives the client namespaces from the same map", () => {
    const fromMap = Object.entries(MESSAGE_NAMESPACES)
      .filter(([, entry]) => entry.client)
      .map(([namespace]) => `${namespace}.`)
      .sort();
    expect([...CLIENT_MESSAGE_PREFIXES].sort()).toEqual(fromMap);
  });
});

describe("message overrides (WP3 M2: fork-owned src/messages-overrides/{uk,en}.json)", () => {
  const base: Messages = {
    "site.name": "Fluxkit",
    "nav.cart": "Cart",
    "home.hero.title": "Welcome",
  };

  it("exist for every locale and hold a JSON object", () => {
    for (const locale of locales) {
      const file = join(overridesDir, `${locale}.json`);
      expect(existsSync(file), file).toBe(true);
      const content = JSON.parse(readFileSync(file, "utf8")) as unknown;
      expect(typeof content === "object" && content !== null && !Array.isArray(content)).toBe(true);
    }
  });

  it("are merged last into what the app uses: messagesByLocale equals the base, then the extras, then the overrides", () => {
    for (const locale of locales) {
      const extras = readJson(join(extrasDir, `${locale}.json`));
      const overrides = readJson(join(overridesDir, `${locale}.json`));
      expect(messagesByLocale[locale]).toEqual({
        ...baseMessagesByLocale[locale],
        ...extras,
        ...overrides,
      });
    }
  });

  it("replace the base text of the same flat key and keep every other key", () => {
    expect(applyOverrides(base, { "site.name": "Verde" }, "uk")).toEqual({
      ...base,
      "site.name": "Verde",
    });
    expect(applyOverrides(base, {}, "uk")).toEqual(base);
  });

  it("refuse a key the base does not have (a typo would otherwise change nothing), naming the key and the file", () => {
    expect(() => applyOverrides(base, { "site.nmae": "Verde" }, "uk")).toThrow(
      /site\.nmae.*messages-overrides\/uk\.json/,
    );
  });

  it("refuse a value that is not a non-empty string", () => {
    for (const bad of [1, null, ["x"], { a: "b" }, "", "  "]) {
      expect(() => applyOverrides(base, { "site.name": bad }, "en"), JSON.stringify(bad)).toThrow(
        /site\.name/,
      );
    }
  });

  it("apply before the client subset is picked, so the browser receives the overridden text (non-empty fixture)", () => {
    const files = {
      shell: { "site.name": "Fluxkit", "footer.copyright": "c" },
      home: { "home.hero.title": "w" },
    };
    const merged = buildLocaleMessages(
      files,
      {},
      { "site.name": "Verde Kopi", "home.hero.title": "Hi" },
      "uk",
    );
    expect(merged["site.name"]).toBe("Verde Kopi");
    expect(merged["home.hero.title"]).toBe("Hi");
    expect(pickClientMessages(merged)["site.name"]).toBe("Verde Kopi");
    expect(() => buildLocaleMessages(files, {}, { "home.hero.titel": "x" }, "uk")).toThrow(
      /home\.hero\.titel/,
    );
  });
});

describe("message extras (owner decision 2026-11-09: fork-owned src/messages-extra/{uk,en}.json, keys under custom.)", () => {
  const base: Messages = { "site.name": "Fluxkit", "nav.cart": "Cart" };

  it("exist for every locale and hold a JSON object", () => {
    for (const locale of locales) {
      const file = join(extrasDir, `${locale}.json`);
      expect(existsSync(file), file).toBe(true);
      const content = JSON.parse(readFileSync(file, "utf8")) as unknown;
      expect(typeof content === "object" && content !== null && !Array.isArray(content)).toBe(true);
    }
  });

  it("on disk: hold only custom. keys, none of them in the base, the same keys in uk and en", () => {
    for (const locale of locales) {
      for (const key of Object.keys(readJson(join(extrasDir, `${locale}.json`)))) {
        expect(namespaceOfKey(key), `${locale}: ${key}`).toBe(CUSTOM_NAMESPACE);
        expect(Object.hasOwn(baseMessagesByLocale[locale], key), `${locale}: ${key}`).toBe(false);
      }
    }
    expect(comparableKeys(readJson(join(extrasDir, "uk.json")))).toEqual(
      comparableKeys(readJson(join(extrasDir, "en.json"))),
    );
  });

  it("make custom a client namespace without an upstream area file", () => {
    expect(CUSTOM_NAMESPACE).toBe("custom");
    expect(MESSAGE_NAMESPACES[CUSTOM_NAMESPACE]).toEqual({ area: null, client: true });
    expect(areaOfKey("custom.deliveryKyiv")).toBeNull();
    expect(CLIENT_MESSAGE_PREFIXES).toContain("custom.");
  });

  it("add a custom. key and keep every base key", () => {
    expect(applyExtras(base, { "custom.deliveryKyiv": "Kyiv delivery" }, "uk")).toEqual({
      ...base,
      "custom.deliveryKyiv": "Kyiv delivery",
    });
    expect(applyExtras(base, {}, "uk")).toEqual(base);
  });

  it("refuse a key outside custom. (a core key must not be shadowed), naming the key and the file", () => {
    for (const key of ["site.name", "promo.banner", "custom", "custom.", "customs.x"]) {
      expect(() => applyExtras(base, { [key]: "x" }, "uk"), key).toThrow(
        `Message extra "${key}" in src/messages-extra/uk.json is outside the reserved namespace "custom."`,
      );
    }
  });

  it("refuse a key the base already has (extras add, overrides replace)", () => {
    expect(() =>
      applyExtras({ ...base, "custom.deliveryKyiv": "a" }, { "custom.deliveryKyiv": "b" }, "en"),
    ).toThrow(/custom\.deliveryKyiv.*messages-extra\/en\.json.*already has a base message/);
  });

  it("refuse a value that is not a non-empty string", () => {
    for (const bad of [1, null, ["x"], { a: "b" }, "", "  "]) {
      expect(
        () => applyExtras(base, { "custom.deliveryKyiv": bad }, "en"),
        JSON.stringify(bad),
      ).toThrow(/custom\.deliveryKyiv.*must be a non-empty string/);
    }
  });

  it("merge after the base and before the overrides: an override may replace an extra, the browser gets it", () => {
    const files = { shell: { "site.name": "Fluxkit", "footer.copyright": "c" } };
    const merged = buildLocaleMessages(
      files,
      { "custom.deliveryKyiv": "Kyiv delivery", "custom.note": "Note" },
      { "custom.deliveryKyiv": "Kyiv, by courier" },
      "uk",
    );
    expect(merged["custom.deliveryKyiv"]).toBe("Kyiv, by courier");
    expect(merged["custom.note"]).toBe("Note");
    expect(pickClientMessages(merged)["custom.note"]).toBe("Note");
    expect(() => buildLocaleMessages(files, {}, { "custom.deliveryKyiv": "x" }, "uk")).toThrow(
      /custom\.deliveryKyiv.*no base message/,
    );
  });
});

describe("messagesByLocale wiring with non-empty fork files (review of PR 244: the {} files made the order untestable)", () => {
  afterEach(() => {
    vi.doUnmock("../messages-extra/uk.json");
    vi.doUnmock("../messages-extra/en.json");
    vi.doUnmock("../messages-overrides/uk.json");
    vi.doUnmock("../messages-overrides/en.json");
    vi.resetModules();
  });

  async function loadWith(
    extras: Record<string, Record<string, string>>,
    overrides: Record<string, Record<string, string>>,
  ) {
    vi.resetModules();
    vi.doMock("../messages-extra/uk.json", () => ({ default: extras["uk"] ?? {} }));
    vi.doMock("../messages-extra/en.json", () => ({ default: extras["en"] ?? {} }));
    vi.doMock("../messages-overrides/uk.json", () => ({ default: overrides["uk"] ?? {} }));
    vi.doMock("../messages-overrides/en.json", () => ({ default: overrides["en"] ?? {} }));
    return (await import("./index")).messagesByLocale;
  }

  it("applies base, then extras, then overrides: an extra is added, an override replaces an extra and a base key", async () => {
    const loaded = await loadWith(
      {
        uk: { "custom.deliveryKyiv": "Доставка по Києву", "custom.note": "Примітка" },
        en: { "custom.deliveryKyiv": "Delivery in Kyiv", "custom.note": "Note" },
      },
      {
        uk: { "custom.deliveryKyiv": "Кур'єр по Києву", "site.name": "Верде" },
        en: { "site.name": "Verde" },
      },
    );
    expect(loaded.uk["custom.note"]).toBe("Примітка");
    expect(loaded.en["custom.note"]).toBe("Note");
    // An override replaces an extra (overrides come after extras) ...
    expect(loaded.uk["custom.deliveryKyiv"]).toBe("Кур'єр по Києву");
    expect(loaded.en["custom.deliveryKyiv"]).toBe("Delivery in Kyiv");
    // ... and a base key.
    expect(loaded.uk["site.name"]).toBe("Верде");
    expect(loaded.en["site.name"]).toBe("Verde");
    // Every other base key is kept as it is.
    for (const locale of locales) {
      for (const [key, value] of Object.entries(baseMessagesByLocale[locale])) {
        if (key !== "site.name") expect(loaded[locale][key], key).toBe(value);
      }
    }
  });

  it("checks the fork files at load: an extra outside custom. throws, an override of an extra key loads", async () => {
    await expect(loadWith({ uk: { "site.name": "x" } }, {})).rejects.toThrow(
      /Message extra "site\.name" in src\/messages-extra\/uk\.json/,
    );
    await expect(
      loadWith(
        { en: { "custom.deliveryKyiv": "Delivery in Kyiv" } },
        { en: { "custom.deliveryKyiv": "Courier" } },
      ),
    ).resolves.toMatchObject({ en: { "custom.deliveryKyiv": "Courier" } });
  });
});
