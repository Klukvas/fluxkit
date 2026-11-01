import type { AdminSearchStatus } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  ENGINE_CODES,
  ageText,
  describeEngineCode,
  engineView,
  laneView,
  localeView,
  queueView,
  rejectedView,
  searchScreenState,
} from "./search-view";

const NOW = new Date("2026-10-29T12:00:00.000Z");

type LocaleEntry = AdminSearchStatus["locales"][number];

function locale(overrides: Partial<LocaleEntry> = {}): LocaleEntry {
  return {
    locale: "uk",
    liveIndex: "fluxkit_catalog_uk_1",
    documents: 120,
    builtAt: "2026-10-29T10:00:00.000Z",
    settingsFresh: true,
    documentsFresh: true,
    rebuildRequestedAt: null,
    build: null,
    failedAttempts: 0,
    lastErrorCode: null,
    lastErrorAt: null,
    nextAttemptAt: null,
    ...overrides,
  };
}

function queue(overrides: Partial<AdminSearchStatus["queue"]> = {}): AdminSearchStatus["queue"] {
  return {
    depth: 0,
    due: 0,
    leased: 0,
    dead: 0,
    oldestEnqueuedAt: null,
    oldestDueAt: null,
    errorCodes: [],
    ...overrides,
  };
}

describe("engineView", () => {
  it("is reachable, or unreachable with the engine's code (never a message)", () => {
    expect(engineView({ reachable: true, code: null })).toEqual({ kind: "reachable" });
    expect(engineView({ reachable: false, code: "engine_timeout" })).toEqual({
      kind: "unreachable",
      code: { key: "search.engine.code.engine_timeout" },
      raw: "engine_timeout",
    });
  });

  it("explains every code the engine client has and shows an unknown code as it is", () => {
    for (const code of ENGINE_CODES) {
      expect(describeEngineCode(code)).toEqual({ key: `search.engine.code.${code}` });
    }
    expect(describeEngineCode("brand_new")).toEqual({
      key: "search.engine.code.unrecognized",
      code: "brand_new",
    });
    expect(engineView({ reachable: false, code: null })).toEqual({
      kind: "unreachable",
      code: { key: "search.engine.code.unrecognized" },
      raw: null,
    });
  });
});

describe("localeView", () => {
  it("is fresh when the live index has the current documents and settings", () => {
    expect(localeView(locale())).toMatchObject({ state: "fresh", tone: "success" });
  });

  it("is never indexed before the first build", () => {
    expect(
      localeView(
        locale({ liveIndex: null, documents: null, builtAt: null, documentsFresh: false }),
      ),
    ).toMatchObject({ state: "never_indexed", tone: "warning" });
  });

  it("is building while a build runs, even before the first swap", () => {
    const build = {
      index: "fluxkit_catalog_uk_2",
      startedAt: "2026-10-29T11:59:00.000Z",
      documents: 40,
    };
    expect(localeView(locale({ build }))).toMatchObject({
      state: "building",
      tone: "neutral",
    });
    expect(
      localeView(locale({ build, liveIndex: null, documents: null, builtAt: null })),
    ).toMatchObject({ state: "building" });
  });

  it("says a rebuild was requested, with its time", () => {
    expect(localeView(locale({ rebuildRequestedAt: "2026-10-29T11:00:00.000Z" }))).toMatchObject({
      state: "rebuild_requested",
      tone: "neutral",
    });
  });

  it("is stale when the documents are not built for the current version or currency (a rebuild is due)", () => {
    expect(localeView(locale({ documentsFresh: false }))).toMatchObject({
      state: "documents_stale",
      tone: "warning",
    });
  });

  it("waits for job 13 when only the settings are behind (synonym or definition changes)", () => {
    expect(localeView(locale({ settingsFresh: false }))).toMatchObject({
      state: "settings_pending",
      tone: "neutral",
    });
  });

  it("shows the last error as an explanation and the code, and the retry time, whatever the state", () => {
    const view = localeView(
      locale({
        lastErrorCode: "engine_task_timeout",
        lastErrorAt: "2026-10-29T11:30:00.000Z",
        failedAttempts: 3,
        nextAttemptAt: "2026-10-29T12:10:00.000Z",
      }),
    );
    expect(view.state).toBe("fresh");
    expect(view.error).toEqual({
      code: { key: "search.engine.code.engine_task_timeout" },
      raw: "engine_task_timeout",
      at: "2026-10-29T11:30:00.000Z",
      attempts: 3,
      retryAt: "2026-10-29T12:10:00.000Z",
    });
    expect(view.tone).toBe("danger");
  });

  it("has no error block without an error code", () => {
    expect(localeView(locale({ failedAttempts: 2 })).error).toBeNull();
  });

  it("keeps the counts and times for the card", () => {
    expect(localeView(locale())).toMatchObject({
      locale: "uk",
      liveIndex: "fluxkit_catalog_uk_1",
      documents: 120,
      builtAt: "2026-10-29T10:00:00.000Z",
    });
  });
});

describe("queueView", () => {
  it("is empty without waiting products", () => {
    expect(queueView(queue(), NOW)).toMatchObject({ state: "empty", lagMinutes: null });
  });

  it("is draining with the lag of the oldest due change, in whole minutes", () => {
    expect(
      queueView(queue({ depth: 5, due: 3, oldestDueAt: "2026-10-29T11:45:30.000Z" }), NOW),
    ).toMatchObject({ state: "draining", lagMinutes: 14 });
  });

  it("never shows a negative lag (clock skew)", () => {
    expect(
      queueView(queue({ depth: 1, due: 1, oldestDueAt: "2026-10-29T12:30:00.000Z" }), NOW)
        .lagMinutes,
    ).toBe(0);
  });

  it("needs attention when products are dead (failed 10 times, retrying hourly)", () => {
    expect(queueView(queue({ depth: 2, dead: 2 }), NOW)).toMatchObject({ state: "attention" });
  });

  it("explains the error codes of the queue and keeps unknown ones", () => {
    expect(
      queueView(
        queue({
          depth: 2,
          errorCodes: [
            { code: "engine_unreachable", count: 2 },
            { code: "odd", count: 1 },
          ],
        }),
        NOW,
      ).errorCodes,
    ).toEqual([
      {
        code: { key: "search.engine.code.engine_unreachable" },
        raw: "engine_unreachable",
        count: 2,
      },
      { code: { key: "search.engine.code.unrecognized", code: "odd" }, raw: "odd", count: 1 },
    ]);
  });
});

describe("rejectedView", () => {
  it("is none at zero", () => {
    expect(rejectedView({ count: 0, lastCode: null, lastAt: null })).toEqual({ kind: "none" });
  });

  it("names the count, the engine's last code and when, as per process", () => {
    expect(
      rejectedView({
        count: 3,
        lastCode: "invalid_search_facets",
        lastAt: "2026-10-29T11:00:00.000Z",
      }),
    ).toEqual({
      kind: "rejected",
      count: 3,
      lastCode: "invalid_search_facets",
      lastAt: "2026-10-29T11:00:00.000Z",
    });
  });
});

describe("laneView", () => {
  const lane = (
    overrides: Partial<AdminSearchStatus["engine"]["interactiveLane"]> = {},
  ): AdminSearchStatus["engine"]["interactiveLane"] => ({
    maxConcurrency: 8,
    maxQueue: 512,
    inFlight: 0,
    queued: 0,
    inFlightHighWater: 0,
    queuedHighWater: 0,
    admitted: 0,
    calls: 0,
    refused: { queueFull: 0, waitExceeded: 0 },
    abandoned: 0,
    since: "2026-10-29T08:00:00.000Z",
    ...overrides,
  });

  it("is clear with no share before anything was admitted or refused", () => {
    expect(laneView(lane())).toMatchObject({ state: "clear", refused: 0, refusedShare: null });
  });

  it("is clear while nothing was refused, whatever the load", () => {
    expect(
      laneView(lane({ inFlight: 8, queued: 40, admitted: 1_000, calls: 2_400 })),
    ).toMatchObject({ state: "clear", refused: 0, refusedShare: 0 });
  });

  it("sums the refusals by reason and gives their share of all admissions asked for", () => {
    expect(
      laneView(
        lane({
          inFlight: 8,
          queued: 12,
          inFlightHighWater: 8,
          queuedHighWater: 512,
          admitted: 300,
          calls: 900,
          refused: { queueFull: 60, waitExceeded: 40 },
          abandoned: 7,
        }),
      ),
    ).toEqual({
      state: "refused",
      maxConcurrency: 8,
      maxQueue: 512,
      inFlight: 8,
      queued: 12,
      inFlightHighWater: 8,
      queuedHighWater: 512,
      admitted: 300,
      calls: 900,
      refused: 100,
      queueFull: 60,
      waitExceeded: 40,
      refusedShare: 0.25,
      abandoned: 7,
      since: "2026-10-29T08:00:00.000Z",
    });
  });
});

describe("searchScreenState", () => {
  it("shows the data when it is ready or being refreshed", () => {
    expect(searchScreenState({ status: "ready" })).toEqual({ kind: "data" });
  });

  it("treats a 404 as 'search is switched off' (SEARCH_ENABLED=false mounts no search route), not as a missing page", () => {
    expect(searchScreenState({ status: "notFound" })).toEqual({ kind: "off" });
  });

  it("passes loading, failure and forbidden through to the shared fallbacks", () => {
    expect(searchScreenState({ status: "loading" })).toEqual({ kind: "fallback" });
    expect(searchScreenState({ status: "error" })).toEqual({ kind: "fallback" });
    expect(searchScreenState({ status: "forbidden" })).toEqual({ kind: "fallback" });
  });
});

describe("ageText", () => {
  it("counts minutes, hours and days back from now, and reads a future time as now", () => {
    expect(ageText("2026-10-29T11:55:00.000Z", NOW, "en")).toBe("5 minutes ago");
    expect(ageText("2026-10-29T09:00:00.000Z", NOW, "en")).toBe("3 hours ago");
    expect(ageText("2026-10-27T12:00:00.000Z", NOW, "en")).toBe("2 days ago");
    expect(ageText("2026-10-29T12:30:00.000Z", NOW, "en")).toBe("this minute");
  });
});
