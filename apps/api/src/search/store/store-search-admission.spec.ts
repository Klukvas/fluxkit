import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { DEFAULT_SEARCH_ENGINE_MAX_QUEUE } from "@fluxkit/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startApp, type RunningApp } from "../../test/app.js";
import { http } from "../../test/http.js";
import { ensureMigrated } from "../../test/migrate.js";
import type { SearchEngine } from "../engine/index.js";
import { SEARCH_ENGINE } from "../search.module.js";

/**
 * One admission per search pass (ADR 0042, review F2 of PR 204) through the real store routes, against a loopback engine
 * that counts and holds requests: a refused search starts no engine call afterwards, and a shopper who leaves takes their
 * waiting and running engine calls with them. Real Postgres (the definitions); the engine is an external boundary here.
 */

interface EngineRequest {
  readonly federated: boolean;
  readonly firstQuery: string;
  readonly response: ServerResponse;
  /** The client gave the request up (its socket closed before an answer). */
  abandoned: boolean;
}

interface LoopbackEngine {
  readonly url: string;
  readonly server: Server;
  readonly requests: EngineRequest[];
  /** When true, the store's federated searches are held too (otherwise only queries named `hold` are held). */
  holdSearches: boolean;
  /** Answers every held request. */
  releaseAll(): void;
}

const held = new Set<EngineRequest>();

function answer(entry: EngineRequest, body: unknown): void {
  entry.response.writeHead(200, { "content-type": "application/json" });
  entry.response.end(JSON.stringify(body));
}

const EMPTY_RESULT = { hits: [], totalHits: 0, totalPages: 0, facetDistribution: {} };

function resultOf(entry: EngineRequest, queries: number): unknown {
  return entry.federated
    ? EMPTY_RESULT
    : { results: Array.from({ length: queries }, () => EMPTY_RESULT) };
}

async function loopbackEngine(): Promise<LoopbackEngine> {
  const stub: LoopbackEngine = {
    url: "",
    server: createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url?.includes("/settings/") === true) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end("[]");
          return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          federation?: object;
          queries?: { q?: string }[];
        };
        const entry: EngineRequest = {
          federated: body.federation !== undefined,
          firstQuery: body.queries?.[0]?.q ?? "",
          response,
          abandoned: false,
        };
        response.on("close", () => {
          entry.abandoned = !response.writableFinished;
          held.delete(entry);
        });
        stub.requests.push(entry);
        const queries = body.queries?.length ?? 0;
        if (entry.firstQuery === "hold" || (entry.federated && stub.holdSearches)) {
          held.add(entry);
          return;
        }
        answer(entry, resultOf(entry, queries));
      });
    }),
    requests: [],
    holdSearches: false,
    releaseAll: () => {
      for (const entry of [...held]) {
        held.delete(entry);
        answer(entry, resultOf(entry, 1));
      }
    },
  };
  await new Promise<void>((resolve) => stub.server.listen(0, "127.0.0.1", resolve));
  return Object.assign(stub, {
    url: `http://127.0.0.1:${String((stub.server.address() as AddressInfo).port)}`,
  });
}

async function eventually(check: () => boolean, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) {
      throw new Error("condition not reached in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function pause(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ukrainian words: the words, their stems and their prefixes are three text queries, so each planned query is one call. */
const FEDERATED_SEARCH = `/store/search?q=${encodeURIComponent("теплі футболки")}`;

describe("store search: one admission per pass (loopback engine)", () => {
  let engineStub: LoopbackEngine;
  const apps: RunningApp[] = [];

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterEach(async () => {
    engineStub.releaseAll();
    for (const running of apps.splice(0)) {
      await running.app.close();
    }
    engineStub.server.closeAllConnections();
    await new Promise<void>((resolve) => engineStub.server.close(() => resolve()));
  });

  afterAll(() => {
    held.clear();
  });

  async function appWith(limits: {
    engineMaxConcurrency: number;
    engineMaxQueue: number;
  }): Promise<{ app: RunningApp; engine: SearchEngine }> {
    engineStub = await loopbackEngine();
    const running = await startApp({
      search: {
        enabled: true,
        meiliUrl: engineStub.url,
        meiliApiKey: "loopback-engine-key-0123456789",
        indexPrefix: "loop_",
        ...limits,
      },
      searchTuning: { engineQueueWaitMs: 5_000, searchTimeoutMs: 5_000 },
    });
    apps.push(running);
    const engine = running.app.get<SearchEngine>(SEARCH_ENGINE);
    // Caches the live settings, so the passes under test are the planned queries only.
    expect((await http(running.baseUrl, "GET", "/store/search")).status).toBe(200);
    return { app: running, engine };
  }

  const federatedCalls = (): number =>
    engineStub.requests.filter((entry) => entry.federated).length;

  function holdSlots(engine: SearchEngine, count: number): Promise<unknown>[] {
    return Array.from({ length: count }, () =>
      engine.multiSearch({ queries: [{ indexUid: "loop_catalog_uk", q: "hold" }] }, 10_000),
    );
  }

  it("a refused search starts no engine call afterwards and leaves nothing waiting", async () => {
    const { app, engine } = await appWith({ engineMaxConcurrency: 2, engineMaxQueue: 1 });
    const holders = holdSlots(engine, 2);
    await eventually(() => held.size === 2);
    const started = Date.now();
    const refused = await http<{ code: string }>(app.baseUrl, "GET", FEDERATED_SEARCH);
    expect(refused.status, JSON.stringify(refused.body)).toBe(503);
    expect(refused.body.code).toBe("search_unavailable");
    expect(Date.now() - started).toBeLessThan(1_000);
    engineStub.releaseAll();
    await Promise.all(holders);
    await pause(300);
    // Per call, the first sibling would have waited in the queue and run once the holders finished.
    expect(federatedCalls()).toBe(0);
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      queued: 0,
      refused: { queueFull: 1, waitExceeded: 0 },
    });
  });

  it("a shopper who leaves while the search waits for slots takes it out of the queue", async () => {
    const { app, engine } = await appWith({
      engineMaxConcurrency: 2,
      engineMaxQueue: DEFAULT_SEARCH_ENGINE_MAX_QUEUE,
    });
    const holders = holdSlots(engine, 2);
    await eventually(() => held.size === 2);
    const shopper = new AbortController();
    const leaving = fetch(`${app.baseUrl}${FEDERATED_SEARCH}`, { signal: shopper.signal }).catch(
      (error: unknown) => error,
    );
    await pause(300);
    shopper.abort();
    await leaving;
    await pause(100);
    engineStub.releaseAll();
    await Promise.all(holders);
    await pause(300);
    expect(federatedCalls()).toBe(0);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a shopper who leaves while the search runs destroys its engine requests at once and frees the slots", async () => {
    const { app, engine } = await appWith({ engineMaxConcurrency: 8, engineMaxQueue: 512 });
    engineStub.holdSearches = true;
    const shopper = new AbortController();
    const leaving = fetch(`${app.baseUrl}${FEDERATED_SEARCH}`, { signal: shopper.signal }).catch(
      (error: unknown) => error,
    );
    await eventually(() => federatedCalls() === 2);
    shopper.abort();
    await leaving;
    // Well before the 5 s deadline that would otherwise end them.
    await eventually(
      () => engineStub.requests.filter((entry) => entry.federated).every((e) => e.abandoned),
      1_000,
    );
    await eventually(() => engine.interactiveLane().inFlight === 0, 1_000);
    expect(engine.interactiveLane().queued).toBe(0);
  });

  it("a search on an idle lane is never refused by its own calls, even with one slot and no queue", async () => {
    const { app, engine } = await appWith({ engineMaxConcurrency: 1, engineMaxQueue: 0 });
    const answered = await http(app.baseUrl, "GET", FEDERATED_SEARCH);
    expect(answered.status, JSON.stringify(answered.body)).toBe(200);
    expect(federatedCalls()).toBeGreaterThanOrEqual(2);
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      queued: 0,
      inFlightHighWater: 1,
      refused: { queueFull: 0, waitExceeded: 0 },
    });
  });
});
