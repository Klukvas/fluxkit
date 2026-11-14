import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale, Messages } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  buildMessages,
  EAGER_FILES,
  eagerMessages,
  mergeAreas,
  messagesWith,
  OVERRIDE_FILES,
} from ".";
import { applyOverrides, overrideProblems } from "./overrides";

const directory = import.meta.dirname;
const localeList = ["uk", "en"] as const;

/** Every message file of a locale on disk, eager and lazy, merged (the base an override must name a key of). */
function allBaseMessages(locale: Locale): Messages {
  const files: Record<string, Messages> = {};
  for (const name of readdirSync(join(directory, locale)).filter((file) =>
    file.endsWith(".json"),
  )) {
    files[name] = JSON.parse(readFileSync(join(directory, locale, name), "utf8")) as Messages;
  }
  return mergeAreas(files);
}

describe("applyOverrides (a fork's src/messages-overrides/<locale>.json, merged last)", () => {
  const base = { "app.name": "Admin", "nav.home": "Home" };

  it("replaces the texts it names and keeps the others", () => {
    expect(applyOverrides(base, { "app.name": "Shop Admin" }, "en")).toEqual({
      "app.name": "Shop Admin",
      "nav.home": "Home",
    });
    expect(base["app.name"]).toBe("Admin");
  });

  it("leaves a key of a file that is not loaded for when it is loaded (an area's lazy file)", () => {
    expect(applyOverrides(base, { "orders.title": "Purchases" }, "en")).toEqual(base);
    expect(
      applyOverrides({ ...base, "orders.title": "Orders" }, { "orders.title": "Purchases" }, "en"),
    ).toEqual({ ...base, "orders.title": "Purchases" });
  });

  it("refuses a value that is not a non-empty string, naming the key and the file", () => {
    for (const value of [1, null, "", "  ", ["x"]]) {
      expect(() => applyOverrides(base, { "app.name": value }, "uk")).toThrow(
        /"app\.name" in src\/messages-overrides\/uk\.json must be a non-empty string/,
      );
    }
  });
});

describe("overrideProblems (checked by the build, `brand-html.ts`, and here)", () => {
  const all = { "app.name": "Admin", "orders.title": "Orders" };

  it("names a key no message file has (a typo, or a key upstream renamed or removed)", () => {
    expect(overrideProblems(all, { "app.nmae": "X", "orders.title": "Y" }, "en")).toEqual([
      'Message override "app.nmae" in src/messages-overrides/en.json has no base message (a typo, or a key upstream renamed or removed).',
    ]);
  });

  it("names a value that is not a non-empty string", () => {
    expect(overrideProblems(all, { "app.name": 3 }, "uk")).toEqual([
      'Message override "app.name" in src/messages-overrides/uk.json must be a non-empty string.',
    ]);
  });

  it("finds nothing in this repository's overrides files (upstream: empty; a fork: its own texts)", () => {
    for (const locale of localeList) {
      expect(overrideProblems(allBaseMessages(locale), OVERRIDE_FILES[locale], locale)).toEqual([]);
    }
  });

  it("accepts fork overrides of retained navigation headings even when they are not shown", () => {
    for (const locale of localeList) {
      expect(
        overrideProblems(
          allBaseMessages(locale),
          { "nav.group.sales": "Fork sales", "nav.group.catalog": "Fork catalog" },
          locale,
        ),
      ).toEqual([]);
    }
  });
});

describe("the messages the admin renders", () => {
  it("are the eager files with the fork's overrides applied last", () => {
    for (const locale of localeList) {
      expect(eagerMessages[locale]).toEqual(
        applyOverrides(mergeAreas(EAGER_FILES[locale]), OVERRIDE_FILES[locale], locale),
      );
    }
  });

  it("apply the overrides to a lazily loaded file too", () => {
    const lazy = { "orders.title": "Orders" };
    for (const locale of localeList) {
      expect(messagesWith(locale, { orders: lazy })).toEqual(
        buildMessages({ ...EAGER_FILES[locale], orders: lazy }, OVERRIDE_FILES[locale], locale),
      );
    }
    expect(
      buildMessages({ common: { "app.name": "A" }, orders: lazy }, { "orders.title": "B" }, "en"),
    ).toEqual({ "app.name": "A", "orders.title": "B" });
  });
});
