import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { messagePlaceholders } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import uk from "./uk.json";

const files = { uk, en } as const;
const pluralForms = { uk: ["one", "few", "many", "other"], en: ["one", "other"] } as const;
const allCategories = ["zero", "one", "two", "few", "many", "other"];

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

describe("message files", () => {
  it("have the same keys in uk and en (plural groups compared by group)", () => {
    expect(Object.keys(comparable(uk)).sort()).toEqual(Object.keys(comparable(en)).sort());
  });

  it("have the same {placeholders} for every key", () => {
    const ukComparable = comparable(uk);
    const enComparable = comparable(en);
    for (const [key, message] of Object.entries(ukComparable)) {
      const other = enComparable[key];
      expect(other, `en is missing ${key}`).toBeDefined();
      expect(messagePlaceholders(other as string), `placeholders of ${key}`).toEqual(
        messagePlaceholders(message),
      );
    }
  });

  it("hold non-empty strings without literal braces other than placeholders", () => {
    for (const [locale, messages] of Object.entries(files)) {
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
    for (const locale of ["uk", "en"] as const) {
      const keys = Object.keys(files[locale]);
      const groups = new Set(
        keys
          .filter((key) => allCategories.includes(key.slice(key.lastIndexOf(".") + 1)))
          .map((key) => key.slice(0, key.lastIndexOf("."))),
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
          const message = (files[locale] as Record<string, string>)[`${group}.${form}`] as string;
          expect(messagePlaceholders(message), `${locale} ${group}.${form}`).toContain("count");
        }
      }
    }
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("message keys used in the source", () => {
  const sourceRoot = join(import.meta.dirname, "..");
  const namespaces = [...new Set(Object.keys(en).map((key) => key.split(".")[0]))];
  const literal = new RegExp(
    `["'](((?:${namespaces.join("|")})\\.[A-Za-z0-9_.]*[A-Za-z0-9_]))["']`,
    "g",
  );

  it("exist in both files (a literal that looks like a key must be a key; plural groups count)", () => {
    const used: [string, string][] = [];
    for (const file of sourceFiles(sourceRoot)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(literal)) {
        used.push([relative(sourceRoot, file), match[1] as string]);
      }
    }
    expect(used.length).toBeGreaterThan(10);
    for (const [file, key] of used) {
      for (const locale of ["uk", "en"] as const) {
        const messages = files[locale] as Record<string, string>;
        const exists =
          key in messages || pluralForms[locale].every((form) => `${key}.${form}` in messages);
        expect(exists, `${file} uses "${key}", missing in ${locale}.json`).toBe(true);
      }
    }
  });
});
