import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SearchEngine, SearchEngineError, type InteractiveLimits } from "./index.js";

/**
 * The engine client's transport and interactive lane (ADR 0041) against loopback HTTP servers: the engine is an external
 * boundary, and a real socket is more faithful than a stubbed `fetch`. The real Meilisearch cases are in
 * `search-engine.spec.ts`.
 */

const KEY = "transport-spec-key-0123456789";

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

interface Stub {
  url: string;
  readonly server: Server;
  /** Connections the server accepted. */
  connections: number;
  /** Connections the server saw closed. */
  closed: number;
  readonly requests: {
    method: string;
    url: string;
    headers: IncomingMessage["headers"];
    body: string;
  }[];
  readonly sockets: Set<Socket>;
}

const servers: Stub[] = [];
const engines: SearchEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) {
    engine.close();
  }
  for (const stub of servers.splice(0)) {
    stub.server.closeAllConnections();
    await new Promise<void>((resolve) => stub.server.close(() => resolve()));
  }
});

async function stubEngine(handler: Handler): Promise<Stub> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      stub.requests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      });
      handler(request, response, body);
    });
  });
  const stub: Stub = {
    url: "",
    server,
    connections: 0,
    closed: 0,
    requests: [],
    sockets: new Set(),
  };
  server.on("connection", (socket: Socket) => {
    stub.connections += 1;
    stub.sockets.add(socket);
    socket.on("close", () => {
      stub.closed += 1;
      stub.sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  stub.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  servers.push(stub);
  return stub;
}

function engineFor(
  url: string,
  options: { requestTimeoutMs?: number; interactive?: Partial<InteractiveLimits> } = {},
): SearchEngine {
  const engine = new SearchEngine({
    url,
    apiKey: KEY,
    requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
    ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
  });
  engines.push(engine);
  return engine;
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function engineError(run: () => Promise<unknown>): Promise<SearchEngineError> {
  const error = await run().then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SearchEngineError);
  return error as SearchEngineError;
}

/** Resolves when `check` holds (polling a loopback server's counters; never longer than `ms`). */
async function eventually(check: () => boolean, ms = 2_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) {
      throw new Error("condition not reached in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("SearchEngine transport (loopback servers)", () => {
  it("reuses one kept-alive connection for sequential calls and sends the key, and a body type only with a body", async () => {
    const stub = await stubEngine((request, response) => {
      if (request.url === "/health") {
        json(response, 200, { status: "available" });
        return;
      }
      json(response, 200, { results: [{ hits: [{ productId: "p1" }] }] });
    });
    const engine = engineFor(stub.url);
    for (let i = 0; i < 5; i += 1) {
      expect(
        await engine.multiSearch({ queries: [{ indexUid: "x", q: `q${String(i)}` }] }),
      ).toEqual({
        results: [{ hits: [{ productId: "p1" }] }],
      });
    }
    expect(stub.connections).toBe(1);
    expect(await engine.health()).toBe(true);
    const search = stub.requests[0];
    expect(search?.method).toBe("POST");
    expect(search?.url).toBe("/multi-search");
    expect(search?.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(search?.headers["content-type"]).toBe("application/json");
    expect(search?.headers["content-length"]).toBe(String(Buffer.byteLength(search?.body ?? "")));
    expect(JSON.parse(search?.body ?? "")).toEqual({ queries: [{ indexUid: "x", q: "q0" }] });
    const health = stub.requests.at(-1);
    expect(health?.method).toBe("GET");
    expect(health?.headers["authorization"]).toBe(`Bearer ${KEY}`);
    expect(health?.headers["content-type"]).toBeUndefined();
  });

  it("keeps a path prefix of the engine URL", async () => {
    const stub = await stubEngine((_request, response) =>
      json(response, 200, { status: "available" }),
    );
    const engine = engineFor(`${stub.url}/meili`);
    expect(await engine.health()).toBe(true);
    expect(stub.requests[0]?.url).toBe("/meili/health");
  });

  it("reads an answer larger than 64 KB, sent in pieces, with multi-byte characters", async () => {
    const hits = Array.from({ length: 2_000 }, (_, index) => ({
      productId: `p${String(index)}`,
      title: "Зимова куртка з капюшоном — ✓",
    }));
    const text = JSON.stringify({ results: [{ hits }] });
    expect(Buffer.byteLength(text)).toBeGreaterThan(64 * 1024);
    const stub = await stubEngine((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      const bytes = Buffer.from(text, "utf8");
      // Split inside multi-byte characters on purpose: the client must decode the whole body, not each piece.
      let offset = 0;
      const step = 4_099;
      const writeNext = (): void => {
        if (offset >= bytes.length) {
          response.end();
          return;
        }
        response.write(bytes.subarray(offset, offset + step));
        offset += step;
        setImmediate(writeNext);
      };
      writeNext();
    });
    const engine = engineFor(stub.url);
    expect(await engine.multiSearch({ queries: [] })).toEqual({ results: [{ hits }] });
  });

  it("maps a silent engine to engine_timeout at the deadline and destroys the socket", async () => {
    const stub = await stubEngine(() => {
      // never answers
    });
    const engine = engineFor(stub.url, { requestTimeoutMs: 200 });
    const started = Date.now();
    const error = await engineError(() => engine.documentCount("idx"));
    expect(error.code).toBe("engine_timeout");
    expect(error.status).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(190);
    expect(Date.now() - started).toBeLessThan(1_500);
    // The socket is closed, not returned to the pool, so a late answer can never reach the next call.
    await eventually(() => stub.closed === 1);
  });

  it("maps an answer that stalls after its headers to engine_timeout with the status, and destroys the socket", async () => {
    const stub = await stubEngine((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      response.write('{"results":');
    });
    const engine = engineFor(stub.url);
    const error = await engineError(() => engine.multiSearch({ queries: [] }, 200));
    expect(error.code).toBe("engine_timeout");
    expect(error.status).toBe(200);
    await eventually(() => stub.closed === 1);
  });

  it("maps a refused connection to engine_unreachable without the address in the error", async () => {
    const stub = await stubEngine(() => undefined);
    const url = stub.url;
    stub.server.close();
    servers.splice(servers.indexOf(stub), 1);
    const engine = engineFor(url);
    const error = await engineError(() => engine.health());
    expect(error.code).toBe("engine_unreachable");
    expect(error.status).toBeUndefined();
    expect(error.message).not.toContain("127.0.0.1");
    expect(error.message).not.toContain(KEY);
    expect(await engine.isHealthy()).toBe(false);
  });

  it("maps an answer cut after its headers to engine_unreachable with the status", async () => {
    const stub = await stubEngine((_request, response) => {
      response.writeHead(200, { "content-type": "application/json", "content-length": "100" });
      response.write('{"results":');
      setTimeout(() => response.socket?.destroy(), 20);
    });
    const engine = engineFor(stub.url);
    const error = await engineError(() => engine.multiSearch({ queries: [] }));
    expect(error.code).toBe("engine_unreachable");
    expect(error.status).toBe(200);
  });

  it.each([301, 302, 303, 307, 308])(
    "never follows a %i redirect and refuses it as engine_unreachable (as fetch with redirect: error did)",
    async (status) => {
      const stub = await stubEngine((request, response) => {
        if (request.url === "/elsewhere") {
          json(response, 200, { status: "available" });
          return;
        }
        response.writeHead(status, { location: "/elsewhere" });
        response.end();
      });
      const engine = engineFor(stub.url);
      const error = await engineError(() => engine.health());
      expect(error.code).toBe("engine_unreachable");
      expect(error.status).toBeUndefined();
      // Give a follow-up request time to arrive if the client wrongly followed the redirect.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stub.requests.map((entry) => entry.url)).toEqual(["/health"]);
    },
  );

  it.each([300, 304])(
    "treats %i as an answer the engine refused (engine_rejected)",
    async (status) => {
      const stub = await stubEngine((_request, response) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(status === 304 ? undefined : JSON.stringify({ code: "multiple_choices" }));
      });
      const engine = engineFor(stub.url);
      const error = await engineError(() => engine.health());
      expect(error.code).toBe("engine_rejected");
      expect(error.status).toBe(status);
    },
  );

  it("keeps the error taxonomy of answers: bad JSON, engine codes, statuses, never the engine's message", async () => {
    const answers: [number, string][] = [
      [200, "not json"],
      [502, "<html>Bad gateway</html>"],
      [503, JSON.stringify({ code: "busy_now", message: "secret engine text" })],
      [401, JSON.stringify({ code: "missing_authorization_header" })],
      [404, JSON.stringify({ code: "index_not_found", message: "Index `x` not found." })],
      [400, JSON.stringify({ code: "Not A Code!", message: "secret engine text" })],
    ];
    let next = 0;
    const stub = await stubEngine((_request, response) => {
      const [status, body] = answers[next] ?? [500, ""];
      next += 1;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    });
    const engine = engineFor(stub.url);
    const seen: [string, number | undefined, string | undefined][] = [];
    for (let i = 0; i < answers.length; i += 1) {
      const error = await engineError(() => engine.documentCount("x"));
      expect(error.message).not.toContain("secret engine text");
      seen.push([error.code, error.status, error.engineCode]);
    }
    expect(seen).toEqual([
      ["engine_bad_response", 200, undefined],
      ["engine_unavailable", 502, undefined],
      ["engine_unavailable", 503, "busy_now"],
      ["engine_unauthorized", 401, "missing_authorization_header"],
      ["engine_index_missing", 404, "index_not_found"],
      ["engine_rejected", 400, undefined],
    ]);
  });

  it("sends a read again on a new connection when its kept-alive connection was closed under it, but never a write", async () => {
    // The server drops the connection on the second request of each connection without answering: what a client sees
    // when the engine closed an idle connection just as the client reused it.
    const perSocket = new WeakMap<Socket, number>();
    const stub = await stubEngine((request, response) => {
      const socket = request.socket;
      const count = (perSocket.get(socket) ?? 0) + 1;
      perSocket.set(socket, count);
      if (count === 2) {
        socket.destroy();
        return;
      }
      if (request.url === "/indexes") {
        json(response, 202, { taskUid: 7 });
        return;
      }
      json(response, 200, { results: [] });
    });
    const engine = engineFor(stub.url);
    expect(await engine.multiSearch({ queries: [] })).toEqual({ results: [] });
    expect(await engine.multiSearch({ queries: [] })).toEqual({ results: [] });
    expect(stub.connections).toBe(2);
    expect(stub.requests).toHaveLength(3);

    // A write on the background lane: first on a new connection, then on the reused one, which is dropped.
    expect(await engine.createIndex("a")).toBe(7);
    const error = await engineError(() => engine.createIndex("b"));
    expect(error.code).toBe("engine_unreachable");
    expect(stub.requests.filter((entry) => entry.url === "/indexes")).toHaveLength(2);
  });

  it("close() is final: a read cut by it on a reused connection is not sent again, and later calls are refused", async () => {
    let held = 0;
    const stub = await stubEngine((_request, response) => {
      if (stub.requests.length === 1) {
        json(response, 200, { results: [] });
        return;
      }
      held += 1; // never answered: close() has to end it
    });
    const engine = engineFor(stub.url);
    await engine.multiSearch({ queries: [] });
    const cut = engineError(() => engine.multiSearch({ queries: [] }, 5_000));
    await eventually(() => held === 1);
    engine.close();
    expect((await cut).code).toBe("engine_unreachable");
    // Give a wrongly retried request time to arrive.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stub.requests).toHaveLength(2);
    expect(stub.connections).toBe(1);
    const later = await engineError(() => engine.documentCount("idx"));
    expect(later.code).toBe("engine_unreachable");
    expect((await engineError(() => engine.multiSearch({ queries: [] }))).code).toBe("engine_busy");
    expect(stub.requests).toHaveLength(2);
  });

  it("close() closes the kept-alive connections", async () => {
    const stub = await stubEngine((_request, response) =>
      json(response, 200, { status: "available" }),
    );
    const engine = engineFor(stub.url);
    await engine.health();
    await engine.multiSearch({ queries: [] }).catch(() => undefined);
    expect(stub.connections).toBe(2);
    engine.close();
    await eventually(() => stub.closed === 2);
  });
});

describe("SearchEngine interactive lane (loopback servers)", () => {
  /** A server that holds every `/multi-search` until the spec lets it answer; other paths answer at once. */
  async function holdingEngine(): Promise<{
    stub: Stub;
    arrived: () => number;
    answerAll: () => void;
  }> {
    let gate = deferred();
    let arrived = 0;
    const stub = await stubEngine((request, response) => {
      if (request.url !== "/multi-search") {
        json(
          response,
          200,
          request.url === "/health" ? { status: "available" } : { numberOfDocuments: 3 },
        );
        return;
      }
      arrived += 1;
      void gate.promise.then(() => json(response, 200, { results: [] }));
    });
    return {
      stub,
      arrived: () => arrived,
      answerAll: () => {
        gate.resolve();
        gate = deferred();
      },
    };
  }

  it("sends at most maxConcurrency calls at once, starts the others in arrival order, and lets background calls pass", async () => {
    const { stub, arrived, answerAll } = await holdingEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const order: number[] = [];
    const calls = Array.from({ length: 5 }, (_, index) =>
      engine.multiSearch({ queries: [{ q: String(index) }] }, 5_000).then(() => order.push(index)),
    );
    await eventually(() => arrived() === 2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(arrived()).toBe(2);
    // The background lane has its own pool and no limit: the indexer and the admin health check are never queued.
    expect(await engine.documentCount("idx")).toBe(3);
    expect(await engine.health()).toBe(true);
    const sentQueries = (): string[] =>
      stub.requests
        .filter((entry) => entry.url === "/multi-search")
        .map(
          (entry) => (JSON.parse(entry.body) as { queries: { q: string }[] }).queries[0]?.q ?? "",
        );
    expect(sentQueries()).toEqual(["0", "1"]);
    answerAll();
    await eventually(() => arrived() === 4);
    expect(sentQueries()).toEqual(["0", "1", "2", "3"]);
    answerAll();
    await eventually(() => arrived() === 5);
    answerAll();
    await Promise.all(calls);
    expect(order.slice(0, 2).sort()).toEqual([0, 1]);
    expect(stub.connections).toBeLessThanOrEqual(2 + 1);
  });

  it("refuses at once with engine_busy when the queue is full, without asking the engine", async () => {
    const { stub, arrived, answerAll } = await holdingEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 1, maxQueueWaitMs: 5_000 },
    });
    const holding = engine.multiSearch({ queries: [] }, 5_000);
    await eventually(() => arrived() === 1);
    const queued = engine.multiSearch({ queries: [] }, 5_000);
    const started = Date.now();
    const busy = await engineError(() => engine.filterableAttributes("idx", 5_000));
    expect(busy.code).toBe("engine_busy");
    expect(busy.status).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(100);
    expect(stub.requests.filter((entry) => entry.url.includes("filterable"))).toHaveLength(0);
    answerAll();
    await holding;
    await eventually(() => arrived() === 2);
    answerAll();
    await queued;
  });

  it("gives up waiting after maxQueueWaitMs with engine_busy and keeps the slot for the call that holds it", async () => {
    const { stub, arrived, answerAll } = await holdingEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 10, maxQueueWaitMs: 150 },
    });
    const holding = engine.multiSearch({ queries: [] }, 5_000);
    await eventually(() => arrived() === 1);
    const started = Date.now();
    const busy = await engineError(() => engine.multiSearch({ queries: [] }, 5_000));
    expect(busy.code).toBe("engine_busy");
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(arrived()).toBe(1);
    answerAll();
    await holding;
  });

  it("counts the wait for a slot against the call's deadline: the timeout does not restart after waiting", async () => {
    const { stub, arrived, answerAll } = await holdingEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 10, maxQueueWaitMs: 10_000 },
    });
    const holding = engine.multiSearch({ queries: [] }, 5_000);
    await eventually(() => arrived() === 1);
    const started = Date.now();
    // 1 000 ms in all; 800 of them are spent waiting for the slot, the engine then never answers the call.
    const waiting = engineError(() => engine.multiSearch({ queries: [] }, 1_000));
    await new Promise((resolve) => setTimeout(resolve, 800));
    answerAll();
    await holding;
    const error = await waiting;
    const elapsed = Date.now() - started;
    expect(error.code).toBe("engine_timeout");
    expect(arrived()).toBe(2);
    // With a restarted timeout it would end near 800 + 1 000 ms; the bound only has to tell the two apart on a busy machine.
    expect(elapsed).toBeGreaterThanOrEqual(990);
    expect(elapsed).toBeLessThan(1_500);
  });

  it("frees the slot of a call that timed out, failed or was cut, so the next call runs", async () => {
    let mode: "silent" | "cut" | "error" | "ok" = "silent";
    const stub = await stubEngine((_request, response) => {
      if (mode === "silent") return;
      if (mode === "cut") {
        response.socket?.destroy();
        return;
      }
      if (mode === "error") {
        json(response, 500, { code: "internal" });
        return;
      }
      json(response, 200, { results: [] });
    });
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 0, maxQueueWaitMs: 1_000 },
    });
    expect((await engineError(() => engine.multiSearch({ queries: [] }, 100))).code).toBe(
      "engine_timeout",
    );
    mode = "cut";
    expect((await engineError(() => engine.multiSearch({ queries: [] }, 1_000))).code).toBe(
      "engine_unreachable",
    );
    mode = "error";
    expect((await engineError(() => engine.multiSearch({ queries: [] }, 1_000))).code).toBe(
      "engine_unavailable",
    );
    mode = "ok";
    // maxQueue 0: this call is refused unless the earlier calls gave their slot back.
    expect(await engine.multiSearch({ queries: [] }, 1_000)).toEqual({ results: [] });
  });

  it("close() refuses the calls still waiting with engine_busy", async () => {
    const { stub, arrived } = await holdingEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 5, maxQueueWaitMs: 5_000 },
    });
    const holding = engine.multiSearch({ queries: [] }, 5_000).catch((error: unknown) => error);
    await eventually(() => arrived() === 1);
    const waiting = engineError(() => engine.multiSearch({ queries: [] }, 5_000));
    await new Promise((resolve) => setTimeout(resolve, 20));
    engine.close();
    expect((await waiting).code).toBe("engine_busy");
    // The call in flight loses its destroyed connection.
    expect(((await holding) as SearchEngineError).code).toBe("engine_unreachable");
  });
});

describe("SearchEngine admissions: one per search pass (ADR 0042, loopback servers)", () => {
  interface Held {
    readonly query: string;
    readonly response: ServerResponse;
    /** The client gave the request up (its socket closed before an answer). */
    abandoned: boolean;
  }

  /** Holds every `/multi-search` until the spec answers it by index; other paths answer at once. */
  async function controlledEngine(): Promise<{
    stub: Stub;
    held: Held[];
    answer: (index: number, status?: number) => void;
  }> {
    const held: Held[] = [];
    const stub = await stubEngine((request, response, body) => {
      if (request.url !== "/multi-search") {
        json(response, 200, request.url?.includes("/settings/") ? [] : { status: "available" });
        return;
      }
      const entry: Held = {
        query: (JSON.parse(body) as { queries?: { q?: string }[] }).queries?.[0]?.q ?? "",
        response,
        abandoned: false,
      };
      response.on("close", () => {
        entry.abandoned = !response.writableFinished;
      });
      held.push(entry);
    });
    return {
      stub,
      held,
      answer: (index, status = 200) => {
        const entry = held[index];
        if (entry === undefined) throw new Error(`no request ${String(index)}`);
        json(entry.response, status, status === 200 ? { results: [] } : { code: "internal" });
      },
    };
  }

  const body = (q: string) => ({ queries: [{ indexUid: "idx", q }] });

  async function pause(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  it("admits a pass as a whole and never runs more of its calls at once than maxConcurrency", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const pass = engine.withAdmission(3, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["a", "b", "c"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await eventually(() => held.length === 2);
    await pause(50);
    expect(held.map((entry) => entry.query)).toEqual(["a", "b"]);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 2, queued: 0 });
    answer(0);
    await eventually(() => held.length === 3);
    answer(1);
    answer(2);
    expect(await pass).toEqual([{ results: [] }, { results: [] }, { results: [] }]);
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      queued: 0,
      admitted: 1,
      calls: 3,
      inFlightHighWater: 2,
    });
  });

  it("refuses a pass whose slots do not fit in the queue at once: no call of it ever reaches the engine and nothing waits", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 1, maxQueueWaitMs: 5_000 },
    });
    const holders = [engine.multiSearch(body("h1"), 5_000), engine.multiSearch(body("h2"), 5_000)];
    await eventually(() => held.length === 2);
    let worked = false;
    const started = Date.now();
    const refused = await engineError(() =>
      engine.withAdmission(3, { timeoutMs: 5_000 }, (admission) => {
        worked = true;
        return Promise.all(
          ["a", "b", "c"].map((q) => engine.multiSearch(body(q), 5_000, { admission })),
        );
      }),
    );
    expect(refused.code).toBe("engine_busy");
    expect(Date.now() - started).toBeLessThan(100);
    expect(worked).toBe(false);
    expect(engine.interactiveLane()).toMatchObject({ queued: 0, refused: { queueFull: 1 } });
    answer(0);
    answer(1);
    await Promise.all(holders);
    await pause(100);
    expect(held).toHaveLength(2);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("refuses a pass that waited longer than maxQueueWaitMs, and runs nothing of it afterwards", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 100 },
    });
    const holders = [engine.multiSearch(body("h1"), 5_000), engine.multiSearch(body("h2"), 5_000)];
    await eventually(() => held.length === 2);
    const refused = await engineError(() =>
      engine.withAdmission(2, { timeoutMs: 5_000 }, (admission) =>
        Promise.all(["a", "b"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
      ),
    );
    expect(refused.code).toBe("engine_busy");
    expect(engine.interactiveLane()).toMatchObject({ queued: 0, refused: { waitExceeded: 1 } });
    answer(0);
    answer(1);
    await Promise.all(holders);
    await pause(100);
    expect(held).toHaveLength(2);
  });

  it("the first failing call aborts its siblings: a waiting one never starts, a running one is destroyed, then the slots are free", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const pass = engineError(() =>
      engine.withAdmission(3, { timeoutMs: 5_000 }, (admission) =>
        Promise.all(["a", "b", "c"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
      ),
    );
    await eventually(() => held.length === 2);
    answer(0, 500);
    expect((await pass).code).toBe("engine_unavailable");
    // The slots are released only after every call of the pass has settled.
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
    await eventually(() => held[1]?.abandoned === true);
    await pause(100);
    expect(held.map((entry) => entry.query)).toEqual(["a", "b"]);
  });

  it("an abort signal takes a waiting pass out of the queue: nothing of it runs later", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const holder = engine.multiSearch(body("h"), 5_000);
    await eventually(() => held.length === 1);
    const controller = new AbortController();
    const pass = engineError(() =>
      engine.withAdmission(1, { timeoutMs: 5_000, signal: controller.signal }, (admission) =>
        engine.multiSearch(body("a"), 5_000, { admission }),
      ),
    );
    // A call without an admission takes the signal too.
    const single = engineError(() =>
      engine.multiSearch(body("s"), 5_000, { signal: controller.signal }),
    );
    await pause(20);
    expect(engine.interactiveLane().queued).toBe(2);
    controller.abort();
    expect((await pass).code).toBe("engine_aborted");
    expect((await single).code).toBe("engine_aborted");
    expect(engine.interactiveLane().queued).toBe(0);
    answer(0);
    await holder;
    await pause(100);
    expect(held).toHaveLength(1);
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      refused: { queueFull: 0, waitExceeded: 0 },
    });
  });

  it("an abort signal destroys the running calls of an admitted pass and frees its slots", async () => {
    const { stub, held } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const controller = new AbortController();
    const pass = engineError(() =>
      engine.withAdmission(2, { timeoutMs: 5_000, signal: controller.signal }, (admission) =>
        Promise.all(["a", "b"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
      ),
    );
    await eventually(() => held.length === 2);
    controller.abort();
    expect((await pass).code).toBe("engine_aborted");
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
    await eventually(() => held.every((entry) => entry.abandoned));
  });

  it("the admission's deadline bounds its calls: a silent engine ends in engine_timeout and the slots are free", async () => {
    const { stub } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 0, maxQueueWaitMs: 5_000 },
    });
    const started = Date.now();
    const error = await engineError(() =>
      engine.withAdmission(1, { timeoutMs: 200 }, (admission) =>
        engine.multiSearch(body("a"), 5_000, { admission }),
      ),
    );
    expect(error.code).toBe("engine_timeout");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
  });

  it("a call the work left running when it returned is aborted before the slots are released", async () => {
    const { stub, held } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 0, maxQueueWaitMs: 5_000 },
    });
    const left: Promise<SearchEngineError>[] = [];
    const value = await engine.withAdmission(1, { timeoutMs: 5_000 }, async (admission) => {
      left.push(engineError(() => engine.multiSearch(body("a"), 5_000, { admission })));
      await eventually(() => held.length === 1);
      return "done";
    });
    expect(value).toBe("done");
    expect(engine.interactiveLane().inFlight).toBe(0);
    expect(left).toHaveLength(1);
    expect((await Promise.all(left)).map((error) => error.code)).toEqual(["engine_aborted"]);
    await eventually(() => held[0]?.abandoned === true);
  });

  it("close() refuses waiting passes and ends running ones; no slot stays held", async () => {
    const { stub, held } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 1, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    const running = engineError(() =>
      engine.withAdmission(1, { timeoutMs: 5_000 }, (admission) =>
        engine.multiSearch(body("a"), 5_000, { admission }),
      ),
    );
    await eventually(() => held.length === 1);
    const waiting = engineError(() =>
      engine.withAdmission(1, { timeoutMs: 5_000 }, (admission) =>
        engine.multiSearch(body("b"), 5_000, { admission }),
      ),
    );
    await pause(20);
    engine.close();
    expect((await waiting).code).toBe("engine_busy");
    expect((await running).code).toBe("engine_unreachable");
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 0, queued: 0 });
    expect(held).toHaveLength(1);
  });

  it("keeps FIFO across passes: a one-call pass behind a waiting larger pass does not overtake it", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 5_000 },
    });
    // One pass holds both slots and gives them back together when it ends.
    const holder = engine.withAdmission(2, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["h1", "h2"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await eventually(() => held.length === 2);
    const large = engine.withAdmission(2, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["l1", "l2"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await pause(20);
    const small = engine.multiSearch(body("s"), 5_000);
    await pause(50);
    expect(held.map((entry) => entry.query)).toEqual(["h1", "h2"]);
    answer(0);
    answer(1);
    // Both slots free at once: the larger pass came first and takes both.
    await eventually(() => held.length === 4);
    await pause(20);
    expect(held.map((entry) => entry.query)).toEqual(["h1", "h2", "l1", "l2"]);
    answer(2);
    answer(3);
    await eventually(() => held.length === 5);
    answer(4);
    await Promise.all([holder, large, small]);
    expect(held.map((entry) => entry.query)).toEqual(["h1", "h2", "l1", "l2", "s"]);
  });

  it("admits a waiting pass on the first free slot (ADR 0043): no slot idles while it waits, its calls run in series on it, and nobody overtakes it", async () => {
    // The review's scenario: N = 2, two one-call passes hold the slots; a two-call pass waits with a 1 s limit. The first
    // holder ends, the second does not: the old rule (all of the pass's slots at once) idled the freed slot and refused
    // the pass after 1 s.
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 2, maxQueue: 10, maxQueueWaitMs: 1_000 },
    });
    const holders = [engine.multiSearch(body("h1"), 5_000), engine.multiSearch(body("h2"), 5_000)];
    await eventually(() => held.length === 2);
    const large = engine.withAdmission(2, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["l1", "l2"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await pause(20);
    const small = engine.multiSearch(body("s"), 5_000);
    await pause(20);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 2, queued: 3 });
    answer(0);
    // The freed slot goes to the pass at once, well within its 1 s wait.
    await eventually(() => held.length === 3, 500);
    await pause(20);
    expect(held.map((entry) => entry.query)).toEqual(["h1", "h2", "l1"]);
    expect(engine.interactiveLane()).toMatchObject({ inFlight: 2, queued: 1 });
    // Its second call runs on the same slot after the first, not on a slot of the queue.
    answer(2);
    await eventually(() => held.length === 4);
    expect(held[3]?.query).toBe("l2");
    answer(3);
    expect(await large).toEqual([{ results: [] }, { results: [] }]);
    // The one-call pass behind it gets the next slot only now.
    await eventually(() => held.length === 5);
    expect(held[4]?.query).toBe("s");
    answer(1);
    answer(4);
    await Promise.all([...holders, small]);
    expect(engine.interactiveLane()).toMatchObject({
      inFlight: 0,
      queued: 0,
      inFlightHighWater: 2,
      refused: { queueFull: 0, waitExceeded: 0 },
      admitted: 4,
      calls: 5,
    });
  });

  it("interactiveLane() reports the limits, the gauges, the high-water marks, admissions, calls and refusals", async () => {
    const { stub, held, answer } = await controlledEngine();
    const engine = engineFor(stub.url, {
      interactive: { maxConcurrency: 3, maxQueue: 2, maxQueueWaitMs: 5_000 },
    });
    const since = engine.interactiveLane().since;
    expect(Date.parse(since)).not.toBeNaN();
    const first = engine.withAdmission(3, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["a", "b", "c"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await eventually(() => held.length === 3);
    const second = engine.withAdmission(2, { timeoutMs: 5_000 }, (admission) =>
      Promise.all(["d", "e"].map((q) => engine.multiSearch(body(q), 5_000, { admission }))),
    );
    await pause(20);
    expect((await engineError(() => engine.multiSearch(body("x"), 5_000))).code).toBe(
      "engine_busy",
    );
    expect(engine.interactiveLane()).toEqual({
      maxConcurrency: 3,
      maxQueue: 2,
      inFlight: 3,
      queued: 2,
      inFlightHighWater: 3,
      queuedHighWater: 2,
      admitted: 1,
      calls: 3,
      refused: { queueFull: 1, waitExceeded: 0 },
      since,
    });
    answer(0);
    answer(1);
    answer(2);
    await first;
    await eventually(() => held.length === 5);
    answer(3);
    answer(4);
    await second;
    expect(engine.interactiveLane()).toEqual({
      maxConcurrency: 3,
      maxQueue: 2,
      inFlight: 0,
      queued: 0,
      inFlightHighWater: 3,
      queuedHighWater: 2,
      admitted: 2,
      calls: 5,
      refused: { queueFull: 1, waitExceeded: 0 },
      since,
    });
  });

  it("refuses an admission of no calls", async () => {
    const engine = engineFor("http://127.0.0.1:9");
    await expect(engine.withAdmission(0, {}, () => Promise.resolve(1))).rejects.toThrow(RangeError);
  });
});
