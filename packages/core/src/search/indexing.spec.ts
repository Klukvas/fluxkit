import { describe, expect, it } from "vitest";
import {
  SEARCH_DOCUMENT_VERSION,
  SEARCH_INDEXING,
  SEARCH_INDEX_PREFIX_PATTERN,
  SEARCH_INDEX_UID_PATTERN,
  SEARCH_SYNC_REASONS,
  SYNONYM_LIMITS,
  SYNONYM_MAX_TERM_WORDS,
  decideIndexAction,
  deriveIndexSettings,
  isOwnedIndexUid,
  nextSearchSyncAttemptAt,
  parseSynonymTerms,
  searchBuildIndexUid,
  searchLiveIndexUid,
  searchRebuildKey,
} from "./index.js";
import type { IndexStateFacts } from "./index.js";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

describe("nextSearchSyncAttemptAt", () => {
  it("waits 1, 2, 5, 10 and 30 minutes after the first five failures, then hourly", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map((n) => nextSearchSyncAttemptAt(n, NOW))).toEqual([
      minutes(1),
      minutes(2),
      minutes(5),
      minutes(10),
      minutes(30),
      minutes(60),
      minutes(60),
      minutes(60),
    ]);
  });

  it("refuses an attempt count that is not a whole number of at least 1", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => nextSearchSyncAttemptAt(bad, NOW)).toThrow(RangeError);
    }
  });

  it("calls a row dead from the tenth failed attempt on (it still retries hourly)", () => {
    expect(SEARCH_INDEXING.deadAfterAttempts).toBe(10);
  });
});

describe("index uids", () => {
  it("names the live index <prefix>catalog_<locale> with dashes of the locale as underscores", () => {
    expect(searchLiveIndexUid("fluxkit_", "uk")).toBe("fluxkit_catalog_uk");
    expect(searchLiveIndexUid("shop_a_", "en-us")).toBe("shop_a_catalog_en_us");
  });

  it("names a build index after the live one with a UTC stamp to the second", () => {
    expect(searchBuildIndexUid("fluxkit_", "uk", new Date("2026-01-02T03:04:05.678Z"))).toBe(
      "fluxkit_catalog_uk_20260102030405",
    );
  });

  it("refuses a prefix or locale that would make an unsafe uid", () => {
    for (const prefix of ["", "Fluxkit_", "fluxkit", "1x_", "a-b_", `${"a".repeat(33)}_`]) {
      expect(() => searchLiveIndexUid(prefix, "uk"), prefix).toThrow(RangeError);
    }
    for (const locale of ["", "UK", "u k", "uk;", "uk/../x"]) {
      expect(() => searchLiveIndexUid("fluxkit_", locale), locale).toThrow(RangeError);
    }
    expect(SEARCH_INDEX_PREFIX_PATTERN.test(`${"a".repeat(32)}_`)).toBe(true);
    expect(SEARCH_INDEX_UID_PATTERN.test("fluxkit_catalog_uk")).toBe(true);
    expect(SEARCH_INDEX_UID_PATTERN.test("fluxkit-catalog")).toBe(false);
    expect(SEARCH_INDEX_UID_PATTERN.test("a".repeat(129))).toBe(false);
  });

  it("owns only uids of its own prefix and catalog family", () => {
    expect(isOwnedIndexUid("fluxkit_catalog_uk", "fluxkit_")).toBe(true);
    expect(isOwnedIndexUid("fluxkit_catalog_uk_20260102030405", "fluxkit_")).toBe(true);
    expect(isOwnedIndexUid("other_catalog_uk", "fluxkit_")).toBe(false);
    expect(isOwnedIndexUid("fluxkit_orders", "fluxkit_")).toBe(false);
    expect(isOwnedIndexUid("fluxkit_catalog_UK", "fluxkit_")).toBe(false);
  });
});

describe("searchRebuildKey", () => {
  it("is the key deriveIndexSettings reports, so a stored version and currency can be compared", () => {
    const derived = deriveIndexSettings({
      locale: "uk",
      currency: "UAH",
      options: [],
      attributes: [],
      synonymGroups: [],
    });
    expect(searchRebuildKey(SEARCH_DOCUMENT_VERSION, "UAH", "uk")).toBe(derived.rebuildKey);
    expect(searchRebuildKey(SEARCH_DOCUMENT_VERSION + 1, "UAH", "uk")).not.toBe(derived.rebuildKey);
    expect(searchRebuildKey(SEARCH_DOCUMENT_VERSION, "EUR", "uk")).not.toBe(derived.rebuildKey);
  });
});

describe("parseSynonymTerms", () => {
  it("normalizes terms like queries and keeps their order", () => {
    expect(parseSynonymTerms(["Викрутка", " відвертка  ", "М’ясо"])).toEqual({
      ok: true,
      terms: ["викрутка", "відвертка", "м'ясо"],
    });
    expect(parseSynonymTerms(["t shirt", "t-shirt"])).toEqual({
      ok: false,
      reason: "duplicate_terms",
    });
  });

  it("needs 2 to 20 distinct terms of 1 to 50 characters", () => {
    expect(SYNONYM_LIMITS).toEqual({ minTerms: 2, maxTerms: 20, maxTermLength: 50 });
    expect(parseSynonymTerms(["одне"])).toEqual({ ok: false, reason: "too_few_terms" });
    expect(parseSynonymTerms(Array.from({ length: 21 }, (_, i) => `term${i}`))).toEqual({
      ok: false,
      reason: "too_many_terms",
    });
    expect(parseSynonymTerms(["a", "b".repeat(51)])).toEqual({
      ok: false,
      reason: "invalid_term",
    });
    expect(parseSynonymTerms(["a", "b".repeat(50)]).ok).toBe(true);
    expect(parseSynonymTerms(["a", "a"])).toEqual({ ok: false, reason: "duplicate_terms" });
  });

  it("refuses a term of more than three words: the engine ignores longer multi-word synonyms (review F4)", () => {
    expect(SYNONYM_MAX_TERM_WORDS).toBe(3);
    expect(parseSynonymTerms(["shirt", "long sleeve top"])).toEqual({
      ok: true,
      terms: ["shirt", "long sleeve top"],
    });
    for (const long of ["long sleeve cotton top", "  a  b   c d ", "футболка з довгим рукавом"]) {
      expect(parseSynonymTerms(["shirt", long]), long).toEqual({
        ok: false,
        reason: "invalid_term",
      });
    }
  });

  it("refuses terms that are not text, are empty after normalization or carry control characters", () => {
    for (const bad of [
      "x",
      null,
      [1, 2],
      ["a", ""],
      ["a", "  "],
      ["a", "!!!"],
      ["a", "b\u0000c"],
      ["a", "b\u0007"],
    ]) {
      expect(parseSynonymTerms(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("SEARCH_SYNC_REASONS", () => {
  it("are codes the queue table accepts", () => {
    for (const reason of SEARCH_SYNC_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });
});

describe("decideIndexAction", () => {
  const derived = {
    settingsHash: "h1",
    rebuildKey: searchRebuildKey(SEARCH_DOCUMENT_VERSION, "UAH", "uk"),
  };
  const live: IndexStateFacts = {
    liveIndexUid: "fluxkit_catalog_uk",
    settingsHash: "h1",
    documentVersion: SEARCH_DOCUMENT_VERSION,
    currency: "UAH",
    rebuildRequestedAt: null,
    buildIndexUid: null,
    buildStartedAt: null,
  };

  it("does nothing for a fresh live index", () => {
    expect(decideIndexAction({ locale: "uk", state: live, derived, now: NOW })).toEqual({
      kind: "none",
    });
  });

  it("builds when there is no state or no live index", () => {
    expect(decideIndexAction({ locale: "uk", state: null, derived, now: NOW })).toEqual({
      kind: "rebuild",
      cause: "missing",
    });
    expect(
      decideIndexAction({
        locale: "uk",
        state: { ...live, liveIndexUid: null },
        derived,
        now: NOW,
      }),
    ).toEqual({ kind: "rebuild", cause: "missing" });
  });

  it("rebuilds when the document version or currency changed, or a rebuild was requested", () => {
    expect(
      decideIndexAction({
        locale: "uk",
        state: { ...live, documentVersion: 0 },
        derived,
        now: NOW,
      }),
    ).toEqual({ kind: "rebuild", cause: "stale_documents" });
    expect(
      decideIndexAction({ locale: "uk", state: { ...live, currency: "EUR" }, derived, now: NOW }),
    ).toEqual({ kind: "rebuild", cause: "stale_documents" });
    expect(
      decideIndexAction({
        locale: "uk",
        state: { ...live, rebuildRequestedAt: minutes(-1) },
        derived,
        now: NOW,
      }),
    ).toEqual({ kind: "rebuild", cause: "requested" });
  });

  it("updates the settings in place when only the settings hash differs", () => {
    expect(
      decideIndexAction({
        locale: "uk",
        state: { ...live, settingsHash: "old" },
        derived,
        now: NOW,
      }),
    ).toEqual({ kind: "update_settings" });
  });

  it("continues a running build, and restarts one older than 24 hours", () => {
    const building = {
      ...live,
      rebuildRequestedAt: minutes(-10),
      buildIndexUid: "fluxkit_catalog_uk_20261029115000",
      buildStartedAt: minutes(-10),
    };
    expect(decideIndexAction({ locale: "uk", state: building, derived, now: NOW })).toEqual({
      kind: "continue_build",
    });
    expect(
      decideIndexAction({
        locale: "uk",
        state: { ...building, buildStartedAt: minutes(-24 * 60 - 1) },
        derived,
        now: NOW,
      }),
    ).toEqual({ kind: "rebuild", cause: "build_expired" });
  });
});
