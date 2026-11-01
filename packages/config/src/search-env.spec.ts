import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEILI_INDEX_PREFIX,
  DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY,
  DEFAULT_SEARCH_ENGINE_MAX_QUEUE,
  loadEnv,
  SEARCH_MAX_PARALLEL_ENGINE_CALLS,
} from "./index.js";

const base = { DATABASE_URL: "postgres://x" };
const production = {
  ...base,
  NODE_ENV: "production",
  MEDIA_STORAGE_DRIVER: "none",
  ORDER_TOKEN_SECRET: "p".repeat(40),
};
const KEY = "k".repeat(16);
const enabled = {
  ...base,
  SEARCH_ENABLED: "true",
  MEILI_URL: "http://127.0.0.1:7700",
  MEILI_API_KEY: KEY,
};

function messageOf(source: Record<string, string | undefined>): string {
  try {
    loadEnv(source);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("loadEnv did not throw");
}

describe("SEARCH_ENABLED", () => {
  it("is off by default and then ignores every MEILI_* variable, valid or not", () => {
    expect(loadEnv(base).search).toEqual({ enabled: false });
    expect(
      loadEnv({
        ...base,
        SEARCH_ENABLED: "false",
        MEILI_URL: "not a url",
        MEILI_API_KEY: "short",
        MEILI_INDEX_PREFIX: "Bad",
      }).search,
    ).toEqual({ enabled: false });
  });

  it.each(["TRUE", "1", "yes", "on", " true", ""])(
    "accepts exactly true or false, refusing %j",
    (value) => {
      expect(messageOf({ ...enabled, SEARCH_ENABLED: value })).toMatch(/SEARCH_ENABLED/);
    },
  );

  it("reads the engine, the key and the default prefix when on", () => {
    expect(DEFAULT_MEILI_INDEX_PREFIX).toBe("fluxkit_");
    expect(loadEnv(enabled).search).toEqual({
      enabled: true,
      meiliUrl: "http://127.0.0.1:7700",
      meiliApiKey: KEY,
      indexPrefix: "fluxkit_",
      engineMaxConcurrency: DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY,
      engineMaxQueue: DEFAULT_SEARCH_ENGINE_MAX_QUEUE,
    });
    expect([DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY, DEFAULT_SEARCH_ENGINE_MAX_QUEUE]).toEqual([
      8, 512,
    ]);
  });

  it("drops one trailing slash of the URL and keeps a path prefix", () => {
    expect(loadEnv({ ...enabled, MEILI_URL: "http://search.internal:7700/" }).search).toMatchObject(
      { meiliUrl: "http://search.internal:7700" },
    );
    expect(loadEnv({ ...enabled, MEILI_URL: "https://proxy.example/meili" }).search).toMatchObject({
      meiliUrl: "https://proxy.example/meili",
    });
  });
});

describe("MEILI_URL", () => {
  it("is required when search is on", () => {
    expect(messageOf({ ...enabled, MEILI_URL: undefined })).toMatch(
      /MEILI_URL: is required when SEARCH_ENABLED is true/,
    );
    expect(messageOf({ ...enabled, MEILI_URL: "" })).toMatch(/MEILI_URL: is required/);
  });

  it.each([
    ["ftp://127.0.0.1:7700", /http or https/],
    ["127.0.0.1:7700", /http or https/],
    ["http://user:secret@127.0.0.1:7700", /credentials/],
    ["http://127.0.0.1:7700/?key=x", /query or a fragment/],
    ["http://127.0.0.1:7700/#x", /query or a fragment/],
  ])("refuses %j without printing it", (value, problem) => {
    const message = messageOf({ ...enabled, MEILI_URL: value });
    expect(message).toMatch(problem);
    expect(message).not.toContain(value);
    expect(message).not.toContain("secret");
  });

  it("needs https or a private address in production", () => {
    for (const url of [
      "https://search.example",
      "http://127.0.0.1:7700",
      "http://10.1.2.3:7700",
      "http://172.16.0.5:7700",
      "http://192.168.1.10:7700",
      "http://[::1]:7700",
      "http://[fd00::1]:7700",
      "http://meilisearch:7700",
      "http://localhost:7700",
    ]) {
      expect(
        loadEnv({ ...production, ...enabled, NODE_ENV: "production", MEILI_URL: url }).search,
        url,
      ).toMatchObject({ enabled: true });
    }
    for (const url of [
      "http://search.example",
      "http://8.8.8.8:7700",
      "http://172.32.0.1:7700",
      "http://[2001:db8::1]:7700",
    ]) {
      expect(
        messageOf({ ...production, ...enabled, NODE_ENV: "production", MEILI_URL: url }),
        url,
      ).toMatch(/MEILI_URL: must use https or a private address when NODE_ENV is production/);
    }
  });
});

describe("MEILI_API_KEY", () => {
  it("is required when search is on and never printed", () => {
    expect(messageOf({ ...enabled, MEILI_API_KEY: undefined })).toMatch(
      /MEILI_API_KEY: is required when SEARCH_ENABLED is true/,
    );
    for (const value of [
      "k".repeat(15),
      "k".repeat(257),
      `${"k".repeat(16)} `,
      `${"k".repeat(16)}\n`,
      `${"k".repeat(16)}é`,
    ]) {
      const message = messageOf({ ...enabled, MEILI_API_KEY: value });
      expect(message).toMatch(/MEILI_API_KEY: must be 16 to 256 visible ASCII characters/);
      expect(message).not.toContain("kkkkkkkkkkkkkkkk");
    }
    expect(loadEnv({ ...enabled, MEILI_API_KEY: "k".repeat(256) }).search).toMatchObject({
      enabled: true,
    });
  });
});

describe("MEILI_INDEX_PREFIX", () => {
  it("is fluxkit_ when unset or blank", () => {
    for (const prefix of [undefined, "", "  "]) {
      expect(loadEnv({ ...enabled, MEILI_INDEX_PREFIX: prefix }).search).toMatchObject({
        indexPrefix: "fluxkit_",
      });
    }
  });

  it.each(["shop_a_", "x_", `${"a".repeat(32)}_`])("accepts %j", (prefix) => {
    expect(loadEnv({ ...enabled, MEILI_INDEX_PREFIX: prefix }).search).toMatchObject({
      indexPrefix: prefix,
    });
  });

  it.each(["fluxkit", "Fluxkit_", "1shop_", "shop-a_", "_", `${"a".repeat(33)}_`])(
    "refuses %j",
    (prefix) => {
      expect(messageOf({ ...enabled, MEILI_INDEX_PREFIX: prefix })).toMatch(
        /MEILI_INDEX_PREFIX: must match/,
      );
    },
  );
});

describe("SEARCH_ENGINE_MAX_CONCURRENCY and SEARCH_ENGINE_MAX_QUEUE", () => {
  it("are read when search is on, blank counting as unset", () => {
    expect(
      loadEnv({ ...enabled, SEARCH_ENGINE_MAX_CONCURRENCY: "16", SEARCH_ENGINE_MAX_QUEUE: "0" })
        .search,
    ).toMatchObject({ engineMaxConcurrency: 16, engineMaxQueue: 0 });
    expect(
      loadEnv({ ...enabled, SEARCH_ENGINE_MAX_CONCURRENCY: "", SEARCH_ENGINE_MAX_QUEUE: " " })
        .search,
    ).toMatchObject({ engineMaxConcurrency: 8, engineMaxQueue: 512 });
    expect(
      loadEnv({
        ...enabled,
        SEARCH_ENGINE_MAX_CONCURRENCY: "256",
        SEARCH_ENGINE_MAX_QUEUE: "10000",
      }).search,
    ).toMatchObject({ engineMaxConcurrency: 256, engineMaxQueue: 10_000 });
  });

  it("are ignored, valid or not, when search is off", () => {
    expect(
      loadEnv({ ...base, SEARCH_ENGINE_MAX_CONCURRENCY: "0", SEARCH_ENGINE_MAX_QUEUE: "-1" })
        .search,
    ).toEqual({ enabled: false });
  });

  it.each(["0", "257", "-1", "1.5", "08", "1e2", "eight"])(
    "refuses a concurrency of %j",
    (value) => {
      expect(messageOf({ ...enabled, SEARCH_ENGINE_MAX_CONCURRENCY: value })).toMatch(
        /SEARCH_ENGINE_MAX_CONCURRENCY: must be a whole number from 1 to 256/,
      );
    },
  );

  it.each([
    ["1", 1],
    ["9", 9],
    ["10", 10],
    [undefined, DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY],
  ])(
    "accepts no queue with any concurrency (%j): one admission covers a whole search pass (ADR 0042)",
    (concurrency, expected) => {
      // A search sends up to this many engine calls at once, but takes their slots as one admission, so on an idle lane
      // it is admitted whatever the limits; `0` only means "refuse whenever no slot is free".
      expect(SEARCH_MAX_PARALLEL_ENGINE_CALLS).toBe(10);
      expect(
        loadEnv({
          ...enabled,
          SEARCH_ENGINE_MAX_CONCURRENCY: concurrency,
          SEARCH_ENGINE_MAX_QUEUE: "0",
        }).search,
      ).toMatchObject({ engineMaxConcurrency: expected, engineMaxQueue: 0 });
    },
  );

  it.each(["10001", "-1", "2.0", "007", "lots"])("refuses a queue of %j", (value) => {
    expect(messageOf({ ...enabled, SEARCH_ENGINE_MAX_QUEUE: value })).toMatch(
      /SEARCH_ENGINE_MAX_QUEUE: must be a whole number from 0 to 10000/,
    );
  });
});
