import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Runs ONLY in `vitest.home-fork.config.ts`. That run must keep a fork's OWN `custom.` texts (the real
// `src/messages-extra/*.json`) and merge upstream's fixture texts over them (`lib/messages-extra-fork-run.*.ts`): replacing
// the real extras with the fixture made `messages.spec.ts` fail in every fork whose own section uses a `custom.` key.

const locales = ["uk", "en"] as const;
const realPath = (locale: string) =>
  fileURLToPath(new URL(`../messages-extra/${locale}.json`, import.meta.url));
const fixturePath = (locale: string) =>
  fileURLToPath(new URL(`../lib/messages-extra-fork-fixture.${locale}.json`, import.meta.url));
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;

/** A fork's own section component, as source: a file of the fork, not a fixture of upstream. */
const forkComponentSource = `export function HeroBand({ headingId, t }) {
  return <h2 id={headingId}>{t("custom.heroBand.title")}</h2>;
}`;

afterEach(() => {
  vi.doUnmock(realPath("uk"));
  vi.doUnmock(realPath("en"));
  vi.resetModules();
});

describe("the message extras of the fork run", () => {
  it("are the real extras files with the fixture's texts merged over them", async () => {
    const { messagesByLocale } = await import("./index");
    for (const locale of locales) {
      const expected = { ...readJson(realPath(locale)), ...readJson(fixturePath(locale)) };
      expect(Object.keys(expected).length, locale).toBeGreaterThan(0);
      for (const [key, message] of Object.entries(expected)) {
        expect(messagesByLocale[locale][key], `${locale} ${key}`).toBe(message);
      }
    }
  });

  it("keep the key of a fork's own section (a non-fixture file) next to the fixture's keys", async () => {
    vi.resetModules();
    vi.doMock(realPath("uk"), () => ({ default: { "custom.heroBand.title": "Банер" } }));
    vi.doMock(realPath("en"), () => ({ default: { "custom.heroBand.title": "Hero band" } }));
    const { messagesByLocale } = await import("./index");
    const used = [...forkComponentSource.matchAll(/t\("(custom\.[A-Za-z0-9_.]+)"\)/g)].map(
      (match) => match[1] as string,
    );
    expect(used).toEqual(["custom.heroBand.title"]);
    for (const locale of locales) {
      for (const key of used) expect(messagesByLocale[locale], locale).toHaveProperty([key]);
      expect(messagesByLocale[locale], locale).toHaveProperty(["custom.brandStrip.title"]);
    }
  });
});
