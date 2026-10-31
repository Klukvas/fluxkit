import {
  MEILI_INDEX_PREFIX_PATTERN,
  SEARCH_MAX_PARALLEL_ENGINE_CALLS,
  loadEnv,
} from "@fluxkit/config";
import { SEARCH_INDEX_PREFIX_PATTERN, SEARCH_LIMITS } from "@fluxkit/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../test/app.js";
import { http } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { meiliUrl } from "../test/search-engine.js";
import { DEFAULT_SEARCH_TUNING, searchConfigOf, searchStartupLine } from "./search-config.js";

describe("search configuration", () => {
  it("uses the same index prefix pattern in config and core", () => {
    expect(MEILI_INDEX_PREFIX_PATTERN.source).toBe(SEARCH_INDEX_PREFIX_PATTERN.source);
  });

  it("knows how many engine calls one search sends at once (core planSearchQueries: hits, variant facets, one per group)", () => {
    // A price selection counts as one of the selected groups (parseSelectionParams) and plans `price_range` instead of a
    // disjunctive query, so the most is the two fixed queries plus one per group.
    expect(SEARCH_MAX_PARALLEL_ENGINE_CALLS).toBe(2 + SEARCH_LIMITS.maxSelectedGroups);
  });

  it("maps the environment to the module config and never prints the key or the URL at startup", () => {
    const env = loadEnv({
      DATABASE_URL: "postgres://x",
      SEARCH_ENABLED: "true",
      MEILI_URL: "http://127.0.0.1:7700/",
      MEILI_API_KEY: "secret-search-key-0123456789",
      MEILI_INDEX_PREFIX: "shop_",
    });
    const config = searchConfigOf(env.search);
    expect(config).toEqual({
      enabled: true,
      meiliUrl: "http://127.0.0.1:7700",
      meiliApiKey: "secret-search-key-0123456789",
      indexPrefix: "shop_",
      engineMaxConcurrency: 8,
      engineMaxQueue: 512,
      tuning: DEFAULT_SEARCH_TUNING,
    });
    expect(
      searchConfigOf(
        loadEnv({
          DATABASE_URL: "postgres://x",
          SEARCH_ENABLED: "true",
          MEILI_URL: "http://127.0.0.1:7700",
          MEILI_API_KEY: "secret-search-key-0123456789",
          SEARCH_ENGINE_MAX_CONCURRENCY: "3",
          SEARCH_ENGINE_MAX_QUEUE: "5",
        }).search,
      ),
    ).toMatchObject({ engineMaxConcurrency: 3, engineMaxQueue: 5 });
    expect(searchStartupLine(config)).toBe("Search: enabled (shop_)");
    expect(searchStartupLine(searchConfigOf(undefined))).toBe("Search: disabled");
    expect(searchConfigOf(loadEnv({ DATABASE_URL: "postgres://x" }).search)).toEqual({
      enabled: false,
    });
  });
});

describe("search in GET /store/config and GET /admin/config (real app, real Postgres)", () => {
  let off: RunningApp;
  let on: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    off = await startApp();
    // No engine call is made at startup or by these routes, so an invented key is enough here.
    on = await startApp({
      search: {
        enabled: true,
        meiliUrl: meiliUrl(),
        meiliApiKey: "config-spec-key-0123456789",
        indexPrefix: "cfgspec_",
        engineMaxConcurrency: 8,
        engineMaxQueue: 64,
      },
    });
  });

  afterAll(async () => {
    await off.app.close();
    await on.app.close();
  });

  it("is false for both routes with SEARCH_ENABLED=false and true with search on", async () => {
    for (const [app, expected] of [
      [off, false],
      [on, true],
    ] as const) {
      const store = await http<{ search: boolean }>(app.baseUrl, "GET", "/store/config");
      const admin = await http<{ search: boolean }>(app.baseUrl, "GET", "/admin/config");
      expect(store.status).toBe(200);
      expect(store.body.search).toBe(expected);
      expect(admin.status).toBe(200);
      expect(admin.body.search).toBe(expected);
    }
  });

  it("is a plain boolean: no engine URL, key or prefix reaches either route", async () => {
    for (const path of ["/store/config", "/admin/config"]) {
      const result = await http(on.baseUrl, "GET", path);
      expect(JSON.stringify(result.body)).not.toMatch(/meili|7700|config-spec-key|cfgspec_/i);
    }
  });
});
