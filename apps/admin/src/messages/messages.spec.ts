import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { messagePlaceholders, type Locale, type Messages } from "@fluxkit/ui";
import { beforeAll, describe, expect, it } from "vitest";
import * as account from "../areas/account/account-page";
import * as catalogDictionaries from "../areas/catalog-dictionaries";
import * as customers from "../areas/customers";
import * as orders from "../areas/orders";
import * as products from "../areas/products";
import * as users from "../areas/users";
import {
  EAGER_FILES,
  LAZY_FILES,
  LAZY_FILE_LOADERS,
  createFileLoader,
  eagerMessages,
  mergeAreas,
  messagesWith,
  type LazyFile,
} from ".";

const pluralForms = { uk: ["one", "few", "many", "other"], en: ["one", "other"] } as const;
const allCategories = ["zero", "one", "two", "few", "many", "other"];
const localeList = ["uk", "en"] as const;
const directory = import.meta.dirname;

function pluralGroupOf(key: string): string | null {
  const suffix = key.slice(key.lastIndexOf(".") + 1);
  return allCategories.includes(suffix) ? key.slice(0, key.lastIndexOf(".")) : null;
}

/** Plural forms differ by locale (uk has few and many), so they are compared by group, through the `other` form. */
function comparable(messages: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(messages)) {
    const group = pluralGroupOf(key);
    if (group === null) result[key] = message;
    else if (key.endsWith(".other")) result[`${group}.*`] = message;
  }
  return result;
}

function onDisk(locale: Locale): string[] {
  return readdirSync(join(directory, locale))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function fromDisk(locale: Locale, file: string): Messages {
  return JSON.parse(readFileSync(join(directory, locale, `${file}.json`), "utf8")) as Messages;
}

/** Every file of both locales, eager and lazy, read through the app's own loaders. */
const files: Record<Locale, Record<string, Messages>> = { uk: {}, en: {} };
/** Everything merged per locale (a key in two files throws). */
const all: Record<Locale, Messages> = { uk: {}, en: {} };

beforeAll(async () => {
  for (const locale of localeList) {
    const lazy: Partial<Record<LazyFile, Messages>> = {};
    for (const file of LAZY_FILES) lazy[file] = await LAZY_FILE_LOADERS[file][locale]();
    files[locale] = { ...EAGER_FILES[locale], ...lazy };
    all[locale] = messagesWith(locale, lazy);
  }
});

describe("message files", () => {
  it("are on disk exactly as listed: eager files plus lazy files, the same in uk and en", () => {
    for (const locale of localeList) {
      const eager = Object.keys(EAGER_FILES[locale]);
      expect(eager.filter((file) => (LAZY_FILES as readonly string[]).includes(file))).toEqual([]);
      expect([...eager, ...LAZY_FILES].sort(), locale).toEqual(onDisk(locale));
    }
    expect(Object.keys(EAGER_FILES.uk).sort()).toEqual(Object.keys(EAGER_FILES.en).sort());
  });

  it("load a lazy file as exactly the JSON on disk", () => {
    for (const locale of localeList) {
      for (const file of LAZY_FILES) expect(files[locale][file]).toEqual(fromDisk(locale, file));
    }
  });

  it("keep each key in the same file in both locales", () => {
    for (const file of Object.keys(files.uk)) {
      expect(Object.keys(comparable(files.uk[file] ?? {})).sort(), file).toEqual(
        Object.keys(comparable(files.en[file] ?? {})).sort(),
      );
    }
  });

  it("refuse a key defined in two files", () => {
    expect(() => mergeAreas({ a: { "x.y": "1" }, b: { "x.y": "2" } })).toThrow(/x\.y/);
  });

  it("have the same keys in uk and en (plural groups compared by group)", () => {
    expect(Object.keys(comparable(all.uk)).sort()).toEqual(Object.keys(comparable(all.en)).sort());
  });

  it("have the same {placeholders} for every key", () => {
    const ukComparable = comparable(all.uk);
    const enComparable = comparable(all.en);
    for (const [key, message] of Object.entries(ukComparable)) {
      const other = enComparable[key];
      expect(other, `en is missing ${key}`).toBeDefined();
      expect(messagePlaceholders(other as string), `placeholders of ${key}`).toEqual(
        messagePlaceholders(message),
      );
    }
  });

  it("hold non-empty strings without literal braces other than placeholders", () => {
    for (const [locale, messages] of Object.entries(all)) {
      for (const [key, message] of Object.entries(messages)) {
        expect(typeof message, `${locale} ${key}`).toBe("string");
        expect(message.trim(), `${locale} ${key}`).not.toBe("");
        expect(message.replace(/\{[A-Za-z_][A-Za-z0-9_]*\}/g, ""), `${locale} ${key}`).not.toMatch(
          /[{}]/,
        );
      }
    }
  });

  it("have complete plural forms: uk one/few/many/other, en one/other, each with {count}", () => {
    for (const locale of localeList) {
      const keys = Object.keys(all[locale]);
      const groups = new Set(
        keys.map(pluralGroupOf).filter((group): group is string => group !== null),
      );
      expect(groups.size, `${locale} has at least one plural group`).toBeGreaterThan(0);
      for (const group of groups) {
        const present = keys
          .filter((key) => key.startsWith(`${group}.`))
          .map((key) => key.slice(group.length + 1))
          .filter((suffix) => allCategories.includes(suffix));
        expect([...present].sort(), `${locale} plural forms of ${group}`).toEqual(
          [...pluralForms[locale]].sort(),
        );
        for (const form of pluralForms[locale]) {
          const message = all[locale][`${group}.${form}`] as string;
          expect(messagePlaceholders(message), `${locale} ${group}.${form}`).toContain("count");
        }
      }
    }
  });

  it("keep every lazy file out of the eager messages", () => {
    for (const locale of localeList) {
      for (const file of LAZY_FILES) {
        for (const key of Object.keys(files[locale][file] ?? {})) {
          expect(key in eagerMessages[locale], `${locale} ${file} ${key} is eager`).toBe(false);
        }
      }
    }
  });
});

describe("the lazy file loader", () => {
  it("loads a file once per locale, shares a running load, and loads again after a failure", async () => {
    const calls: string[] = [];
    let fail = true;
    const loader = (locale: Locale) => () => {
      calls.push(locale);
      if (locale === "en" && fail) {
        fail = false;
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve({ "dict.x": locale });
    };
    const unused = () => Promise.reject(new Error("not asked for"));
    const load = createFileLoader({
      "catalog-dictionaries": { uk: loader("uk"), en: loader("en") },
      products: { uk: unused, en: unused },
      orders: { uk: unused, en: unused },
      customers: { uk: unused, en: unused },
      users: { uk: unused, en: unused },
    });
    const [first, second] = await Promise.all([
      load("catalog-dictionaries", "uk"),
      load("catalog-dictionaries", "uk"),
    ]);
    expect(first).toEqual({ "dict.x": "uk" });
    expect(second).toBe(first);
    await expect(load("catalog-dictionaries", "en")).rejects.toThrow("offline");
    await expect(load("catalog-dictionaries", "en")).resolves.toEqual({ "dict.x": "en" });
    await load("catalog-dictionaries", "en");
    expect(calls).toEqual(["uk", "en", "en"]);
  });
});

// ------------------------------------------------------------------ keys used by the source

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

const sourceRoot = join(directory, "..");

/**
 * The lazy files each folder of `src/areas` loads (its module's `MESSAGE_FILES`). Folders whose pages are in the entry
 * chunk (sign-in, start page) load none. A new area folder must be added here (checked below).
 */
const AREA_FOLDERS: Record<string, readonly LazyFile[]> = {
  account: account.MESSAGE_FILES,
  auth: [],
  "catalog-dictionaries": catalogDictionaries.MESSAGE_FILES,
  customers: customers.MESSAGE_FILES,
  home: [],
  orders: orders.MESSAGE_FILES,
  products: products.MESSAGE_FILES,
  users: users.MESSAGE_FILES,
};

/**
 * Files outside `src/areas` that only an area imports (they travel in its lazy chunk), with that area. Checked below: no
 * other area and no shell file imports them.
 */
const AREA_OWNED_FILES: Record<string, string> = {
  [join("layout", "product-editor.ts")]: "products",
};

/** The area folder of a source file, or `null` for shell code (eager messages only). */
function areaOf(file: string): string | null {
  const path = relative(sourceRoot, file);
  const owned = AREA_OWNED_FILES[path];
  if (owned !== undefined) return owned;
  const parts = path.split(sep);
  return parts[0] === "areas" ? (parts[1] ?? null) : null;
}

describe("message keys used in the source", () => {
  it("know every area folder", () => {
    const folders = readdirSync(join(sourceRoot, "areas")).sort();
    expect(Object.keys(AREA_FOLDERS).sort()).toEqual(folders);
  });

  it("exist in the messages the file's screen has loaded: eager, plus its area's lazy files", () => {
    const namespaces = [...new Set(Object.keys(all.en).map((key) => key.split(".")[0]))];
    const literal = new RegExp(
      `["'\`](((?:${namespaces.join("|")})\\.[A-Za-z0-9_.]*[A-Za-z0-9_]))["'\`]`,
      "g",
    );
    let used = 0;
    for (const file of sourceFiles(sourceRoot)) {
      const area = areaOf(file);
      const lazy = area === null ? [] : (AREA_FOLDERS[area] ?? []);
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(literal)) {
        used += 1;
        const key = match[1] as string;
        for (const locale of localeList) {
          const visible = { ...eagerMessages[locale] };
          for (const lazyFile of lazy) Object.assign(visible, files[locale][lazyFile]);
          const exists =
            key in visible || pluralForms[locale].every((form) => `${key}.${form}` in visible);
          expect(
            exists,
            `${relative(sourceRoot, file)} uses "${key}", not loaded for it in ${locale}`,
          ).toBe(true);
        }
      }
    }
    expect(used).toBeGreaterThan(30);
  });

  it("keeps the area-owned files out of the shell and of other areas", () => {
    for (const [owned, area] of Object.entries(AREA_OWNED_FILES)) {
      const module = owned.replace(/\.tsx?$/, "");
      const importers = sourceFiles(sourceRoot).filter((file) =>
        new RegExp(`from "[./]*${module.split(sep).join("/")}"`).test(readFileSync(file, "utf8")),
      );
      expect(importers.length, owned).toBeGreaterThan(0);
      for (const file of importers) expect(areaOf(file), relative(sourceRoot, file)).toBe(area);
    }
  });

  it("an area that imports another area's code loads that area's files too", () => {
    for (const file of sourceFiles(sourceRoot)) {
      const area = areaOf(file);
      if (area === null) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from "\.\.\/([a-z-]+)\//g)) {
        const other = match[1] as string;
        if (other === area || !(other in AREA_FOLDERS)) continue;
        for (const needed of AREA_FOLDERS[other] ?? []) {
          expect(AREA_FOLDERS[area], `${relative(sourceRoot, file)} uses ${other}`).toContain(
            needed,
          );
        }
      }
    }
  });
});
