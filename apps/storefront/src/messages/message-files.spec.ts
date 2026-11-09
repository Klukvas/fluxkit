import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { locales, type Messages } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { CLIENT_MESSAGE_PREFIXES, pickClientMessages } from "../lib/client-messages";
import { MESSAGE_AREAS, MESSAGE_NAMESPACES, areaOfKey, namespaceOfKey } from "./areas";
import {
  MESSAGE_FILES,
  applyOverrides,
  baseMessagesByLocale,
  buildLocaleMessages,
  mergeAreas,
  messagesByLocale,
} from "./index";

const messagesDir = import.meta.dirname;
const overridesDir = join(import.meta.dirname, "..", "messages-overrides");

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

  it("names no unused namespace and no namespace whose area has no file", () => {
    const used = new Set(
      locales.flatMap((locale) =>
        Object.values(filesOnDisk(locale)).flatMap((messages) =>
          Object.keys(messages).map(namespaceOfKey),
        ),
      ),
    );
    expect([...used].sort()).toEqual(Object.keys(MESSAGE_NAMESPACES).sort());
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

  it("are merged last into what the app uses: messagesByLocale equals the base plus the override file", () => {
    for (const locale of locales) {
      const overrides = readJson(join(overridesDir, `${locale}.json`));
      expect(messagesByLocale[locale]).toEqual({ ...baseMessagesByLocale[locale], ...overrides });
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
      { "site.name": "Verde Kopi", "home.hero.title": "Hi" },
      "uk",
    );
    expect(merged["site.name"]).toBe("Verde Kopi");
    expect(merged["home.hero.title"]).toBe("Hi");
    expect(pickClientMessages(merged)["site.name"]).toBe("Verde Kopi");
    expect(() => buildLocaleMessages(files, { "home.hero.titel": "x" }, "uk")).toThrow(
      /home\.hero\.titel/,
    );
  });
});
