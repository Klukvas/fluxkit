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
    expect(search?.headers["content-length"]).toBe(String(Buffer.byteLength(search.body)));
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
    // 600 ms in all; 400 of them are spent waiting for the slot, the engine then never answers the call.
    const waiting = engineError(() => engine.multiSearch({ queries: [] }, 600));
    await new Promise((resolve) => setTimeout(resolve, 400));
    answerAll();
    await holding;
    const error = await waiting;
    const elapsed = Date.now() - started;
    expect(error.code).toBe("engine_timeout");
    expect(arrived()).toBe(2);
    // With a restarted timeout it would end near 400 + 600 ms.
    expect(elapsed).toBeGreaterThanOrEqual(590);
    expect(elapsed).toBeLessThan(900);
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
