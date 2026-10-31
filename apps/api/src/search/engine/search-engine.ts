import http from "node:http";
import https from "node:https";
import {
  DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY,
  DEFAULT_SEARCH_ENGINE_MAX_QUEUE,
} from "@fluxkit/config";
import { ConcurrencyLimiter, LimiterRejection, type Release } from "./concurrency-limiter.js";

/**
 * A small REST client of Meilisearch (ADR 0034): the calls the indexer and the search routes need, with one deadline per
 * call and typed errors. Plain `node:http`/`node:https` with keep-alive agents on purpose (ADR 0041): the wire format is
 * what the spike pinned (`apps/api/src/spikes/search-s1.spec.ts`), including federation `page`/`hitsPerPage`, which the
 * `meilisearch` package types do not carry, and global `fetch` added about 40 ms to every answer above about 1.4 KB
 * (search plan, "Measurements at scale", F1).
 *
 * Two lanes, each with its own connection pool: `interactive` (store search, suggest and their settings reads) goes
 * through a FIFO concurrency limit and fails fast with `engine_busy` when it cannot start in time; `background` (indexer
 * writes, task polling, stats, the admin health check) is never queued behind shoppers.
 *
 * Errors carry a CODE, the HTTP status and the engine's own error code (a snake_case identifier such as
 * `index_not_found`), never the engine's message, the URL with a query or the key: they are stored in the database and
 * logged (AGENTS.md section 11).
 */

export type SearchEngineErrorCode =
  | "engine_unreachable"
  | "engine_timeout"
  | "engine_unauthorized"
  | "engine_index_missing"
  | "engine_rejected"
  | "engine_unavailable"
  | "engine_bad_response"
  | "engine_task_failed"
  | "engine_task_timeout"
  /** The interactive lane is full (queue full or no slot within the wait): the engine was not asked. Never stored. */
  | "engine_busy";

const ENGINE_CODE = /^[a-z][a-z0-9_]{0,63}$/;

export class SearchEngineError extends Error {
  readonly code: SearchEngineErrorCode;
  readonly status: number | undefined;
  /** The engine's error code, when it sent one that looks like a code. */
  readonly engineCode: string | undefined;

  constructor(
    code: SearchEngineErrorCode,
    detail: { status?: number; engineCode?: string; operation: string },
  ) {
    const engineCode =
      detail.engineCode !== undefined && ENGINE_CODE.test(detail.engineCode)
        ? detail.engineCode
        : undefined;
    super(
      `Search engine ${detail.operation} failed: ${code}` +
        (detail.status === undefined ? "" : ` (HTTP ${String(detail.status)})`) +
        (engineCode === undefined ? "" : ` [${engineCode}]`),
    );
    this.name = "SearchEngineError";
    this.code = code;
    this.status = detail.status;
    this.engineCode = engineCode;
  }
}

export interface SearchEngineOptions {
  /** Base URL without a trailing slash. */
  readonly url: string;
  readonly apiKey: string;
  /** Limit of one call (queue wait, connection, request and the whole answer). */
  readonly requestTimeoutMs: number;
  /** Limits of the interactive lane; each missing value takes its `DEFAULT_INTERACTIVE_LIMITS` value. */
  readonly interactive?: Partial<InteractiveLimits>;
}

/** The interactive lane (ADR 0041): store search, suggest and their settings reads. */
export interface InteractiveLimits {
  /** Calls in flight at once (and sockets of the lane's pool). */
  readonly maxConcurrency: number;
  /** Calls that may wait for a slot; one more is refused at once with `engine_busy`. */
  readonly maxQueue: number;
  /** Longest wait for a slot (never longer than the call's own deadline, which the wait uses up). */
  readonly maxQueueWaitMs: number;
}

export const DEFAULT_INTERACTIVE_LIMITS: InteractiveLimits = Object.freeze({
  maxConcurrency: DEFAULT_SEARCH_ENGINE_MAX_CONCURRENCY,
  maxQueue: DEFAULT_SEARCH_ENGINE_MAX_QUEUE,
  maxQueueWaitMs: 1_000,
});

/** Sockets of the background lane: the indexer works one batch at a time, so a few are plenty. */
const BACKGROUND_MAX_SOCKETS = 8;
/** An idle kept-alive socket is closed after this (undici's default, below the engine's own idle limit). */
const IDLE_SOCKET_TIMEOUT_MS = 4_000;
/** What `fetch` with `redirect: "error"` refused as a network error (the Fetch standard's "redirect status"). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type Lane = "interactive" | "background";
type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  readonly timeoutMs?: number | undefined;
  readonly lane?: Lane;
  /** A read: safe to send again when a reused keep-alive socket turned out closed before any answer. */
  readonly idempotent?: boolean;
}

type Attempt =
  | { readonly kind: "answer"; readonly status: number; readonly text: string }
  | {
      readonly kind: "failed";
      readonly code: "engine_timeout" | "engine_unreachable";
      readonly status: number | undefined;
      /** A reused keep-alive socket was reset before any answer. */
      readonly staleSocket: boolean;
    };

/** A task the engine enqueued. */
export type TaskUid = number;

export interface EngineTask {
  readonly uid: number;
  readonly status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  readonly error?: { readonly code?: string } | null;
}

const POLL_START_MS = 25;
const POLL_MAX_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SearchEngine {
  private readonly client: typeof http | typeof https;
  private readonly agents: Readonly<Record<Lane, http.Agent>>;
  private readonly limits: InteractiveLimits;
  private readonly limiter: ConcurrencyLimiter;

  constructor(private readonly options: SearchEngineOptions) {
    const secure = new URL(options.url).protocol === "https:";
    this.client = secure ? https : http;
    this.limits = { ...DEFAULT_INTERACTIVE_LIMITS, ...options.interactive };
    this.limiter = new ConcurrencyLimiter({
      maxInFlight: this.limits.maxConcurrency,
      maxQueue: this.limits.maxQueue,
    });
    const agentOf = (maxSockets: number): http.Agent => {
      const settings = {
        keepAlive: true,
        maxSockets,
        maxFreeSockets: maxSockets,
        // Applies to idle sockets only: the agent destroys a FREE socket after it; a call in flight has its own deadline.
        timeout: IDLE_SOCKET_TIMEOUT_MS,
      };
      return secure ? new https.Agent(settings) : new http.Agent(settings);
    };
    this.agents = {
      interactive: agentOf(this.limits.maxConcurrency),
      background: agentOf(BACKGROUND_MAX_SOCKETS),
    };
  }

  /**
   * Closes every pooled connection and refuses the calls still waiting for a slot (`engine_busy`). Calls already sent end
   * as their destroyed sockets make them end (usually `engine_unreachable`). Idempotent.
   */
  close(): void {
    this.limiter.close();
    this.agents.interactive.destroy();
    this.agents.background.destroy();
  }

  /**
   * One call; `operation` names it in errors (never the URL). One deadline covers the wait for an interactive slot, the
   * connection, the request and the whole answer: a call that waited gets only what is left of its time.
   */
  private async request<T>(
    method: Method,
    path: string,
    body: unknown,
    operation: string,
    {
      timeoutMs = this.options.requestTimeoutMs,
      lane = "background",
      idempotent = false,
    }: RequestOptions = {},
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let release: Release | undefined;
    if (lane === "interactive") {
      try {
        release = await this.limiter.acquire(Math.min(this.limits.maxQueueWaitMs, timeoutMs));
      } catch (error) {
        if (error instanceof LimiterRejection) {
          throw new SearchEngineError("engine_busy", { operation });
        }
        throw error;
      }
    }
    try {
      if (deadline - Date.now() <= 0) {
        throw new SearchEngineError("engine_busy", { operation });
      }
      const answer = await this.send(method, path, body, operation, deadline, lane, idempotent);
      return interpret<T>(answer, operation);
    } finally {
      release?.();
    }
  }

  /** The exchange, tried once more for a read whose reused keep-alive socket the engine had already closed. */
  private async send(
    method: Method,
    path: string,
    body: unknown,
    operation: string,
    deadline: number,
    lane: Lane,
    idempotent: boolean,
  ): Promise<{ status: number; text: string }> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await this.attempt(
        method,
        path,
        payload,
        Math.max(deadline - Date.now(), 1),
        lane,
      );
      if (outcome.kind === "answer") {
        return outcome;
      }
      if (outcome.staleSocket && idempotent && attempt === 1 && Date.now() < deadline) {
        continue;
      }
      throw new SearchEngineError(outcome.code, {
        operation,
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
      });
    }
  }

  /**
   * One HTTP exchange; never throws, the outcome says what happened. On timeout the request and its socket are destroyed,
   * so a late answer can never be read by the next call on that socket.
   */
  private attempt(
    method: Method,
    path: string,
    payload: Buffer | undefined,
    timeoutMs: number,
    lane: Lane,
  ): Promise<Attempt> {
    return new Promise<Attempt>((resolve) => {
      let settled = false;
      let timedOut = false;
      let status: number | undefined;
      const finish = (outcome: Attempt): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        }
      };
      const failed = (staleSocket = false): Attempt => ({
        kind: "failed",
        code: timedOut ? "engine_timeout" : "engine_unreachable",
        status,
        staleSocket,
      });
      // Appended, not resolved: `new URL(path, base)` would drop a path prefix of the base URL.
      const request = this.client.request(
        new URL(`${this.options.url}${path}`),
        {
          method,
          agent: this.agents[lane],
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            ...(payload === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": String(payload.byteLength),
                }),
          },
        },
        (response) => {
          const code = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(code)) {
            // Never followed; refused like `fetch` with `redirect: "error"` did: a network error, so no status.
            finish(failed());
            response.destroy();
            return;
          }
          status = code;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            // `TextDecoder` is what `Response.text()` used: UTF-8, a leading BOM dropped, bad bytes replaced.
            finish({
              kind: "answer",
              status: code,
              text: new TextDecoder().decode(Buffer.concat(chunks)),
            });
          });
          response.on("error", () => finish(failed()));
          response.on("close", () => {
            if (!response.complete) {
              finish(failed());
            }
          });
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        const reset = error.code === "ECONNRESET" || error.code === "EPIPE";
        finish(failed(status === undefined && request.reusedSocket && reset && !timedOut));
      });
      const timer = setTimeout(() => {
        timedOut = true;
        finish(failed());
        request.destroy();
      }, timeoutMs);
      request.end(payload);
    });
  }

  private async enqueue(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    operation: string,
  ): Promise<TaskUid> {
    const answer = await this.request<{ taskUid?: unknown }>(method, path, body, operation);
    if (typeof answer?.taskUid !== "number") {
      throw new SearchEngineError("engine_bad_response", { operation });
    }
    return answer.taskUid;
  }

  /** `GET /health` (background lane); throws when the engine cannot be reached or does not answer in time. */
  async health(timeoutMs?: number): Promise<true> {
    const answer = await this.request<{ status?: unknown }>("GET", "/health", undefined, "health", {
      timeoutMs,
      idempotent: true,
    });
    if (answer?.status !== "available") {
      throw new SearchEngineError("engine_unavailable", { operation: "health" });
    }
    return true;
  }

  async isHealthy(timeoutMs?: number): Promise<boolean> {
    try {
      return await this.health(timeoutMs);
    } catch (error) {
      if (error instanceof SearchEngineError) {
        return false;
      }
      throw error;
    }
  }

  /** Number of documents of an index (`stats.get`); `engine_index_missing` when it does not exist. */
  async documentCount(uid: string): Promise<number> {
    const stats = await this.request<{ numberOfDocuments?: unknown }>(
      "GET",
      `/indexes/${encodeURIComponent(uid)}/stats`,
      undefined,
      "stats",
      { idempotent: true },
    );
    if (typeof stats?.numberOfDocuments !== "number") {
      throw new SearchEngineError("engine_bad_response", { operation: "stats" });
    }
    return stats.numberOfDocuments;
  }

  /**
   * The `filterableAttributes` the index has APPLIED (`settings.get`); `engine_index_missing` when it does not exist. The
   * store asks only for facets in this list (review F1). Only plain field names count: the API never writes the
   * object form, so an object entry (set by someone else) offers nothing. Interactive lane (the store's call).
   */
  async filterableAttributes(uid: string, timeoutMs?: number): Promise<string[]> {
    const answer = await this.request<unknown>(
      "GET",
      `/indexes/${encodeURIComponent(uid)}/settings/filterable-attributes`,
      undefined,
      "settings",
      { timeoutMs, lane: "interactive", idempotent: true },
    );
    if (!Array.isArray(answer)) {
      throw new SearchEngineError("engine_bad_response", { operation: "settings" });
    }
    return answer.filter((entry): entry is string => typeof entry === "string");
  }

  /**
   * The `sortableAttributes` the index has APPLIED (`settings.get`); `engine_index_missing` when it does not exist. The
   * store asks for the product id tie-break of `newest` only when it is in this list (review F2 of the search finish).
   * Interactive lane (the store's call).
   */
  async sortableAttributes(uid: string, timeoutMs?: number): Promise<string[]> {
    const answer = await this.request<unknown>(
      "GET",
      `/indexes/${encodeURIComponent(uid)}/settings/sortable-attributes`,
      undefined,
      "settings",
      { timeoutMs, lane: "interactive", idempotent: true },
    );
    if (!Array.isArray(answer)) {
      throw new SearchEngineError("engine_bad_response", { operation: "settings" });
    }
    return answer.filter((entry): entry is string => typeof entry === "string");
  }

  createIndex(uid: string): Promise<TaskUid> {
    return this.enqueue("POST", "/indexes", { uid, primaryKey: "id" }, "create index");
  }

  deleteIndex(uid: string): Promise<TaskUid> {
    return this.enqueue("DELETE", `/indexes/${encodeURIComponent(uid)}`, undefined, "delete index");
  }

  updateSettings(uid: string, settings: object): Promise<TaskUid> {
    return this.enqueue(
      "PATCH",
      `/indexes/${encodeURIComponent(uid)}/settings`,
      settings,
      "update settings",
    );
  }

  /** Adds or fully replaces documents by `id`. */
  addDocuments(uid: string, documents: readonly object[]): Promise<TaskUid> {
    return this.enqueue(
      "POST",
      `/indexes/${encodeURIComponent(uid)}/documents?primaryKey=id`,
      documents,
      "add documents",
    );
  }

  /** Deletes the documents matching a filter built by core `buildSearchFilter`-style quoting (never client text). */
  deleteDocumentsByFilter(uid: string, filter: string): Promise<TaskUid> {
    return this.enqueue(
      "POST",
      `/indexes/${encodeURIComponent(uid)}/documents/delete`,
      { filter },
      "delete documents",
    );
  }

  /**
   * One atomic swap of every pair (spike S1, E9). `rename: true` gives the FIRST (existing) index the second uid, which
   * must not exist yet (a first build); without it a missing uid fails the task.
   */
  swapIndexes(
    pairs: readonly { readonly indexes: readonly [string, string]; readonly rename?: boolean }[],
  ): Promise<TaskUid> {
    return this.enqueue(
      "POST",
      "/swap-indexes",
      pairs.map((pair) => ({
        indexes: [...pair.indexes],
        ...(pair.rename === true ? { rename: true } : {}),
      })),
      "swap indexes",
    );
  }

  /** Deletes finished tasks that ended before `before` (the engine keeps them for ever, spike S1, E11). */
  pruneFinishedTasks(before: Date): Promise<TaskUid> {
    const query = new URLSearchParams({
      statuses: "succeeded,failed,canceled",
      beforeFinishedAt: before.toISOString(),
    });
    return this.enqueue("DELETE", `/tasks?${query.toString()}`, undefined, "prune tasks");
  }

  /** `POST /multi-search` on the interactive lane: a read, so safe to resend on a stale keep-alive socket. */
  async multiSearch<T = unknown>(body: object, timeoutMs?: number): Promise<T> {
    return this.request<T>("POST", "/multi-search", body, "search", {
      timeoutMs,
      lane: "interactive",
      idempotent: true,
    });
  }

  /**
   * Waits until a task finished. `succeeded` returns; `failed` or `canceled` throws `engine_task_failed` with the engine's
   * error code; no end before the deadline throws `engine_task_timeout` (the task may still finish later: callers treat
   * that as "unknown" and retry idempotently).
   */
  async waitForTask(taskUid: TaskUid, timeoutMs: number): Promise<EngineTask> {
    const deadline = Date.now() + timeoutMs;
    let pause = POLL_START_MS;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new SearchEngineError("engine_task_timeout", { operation: "wait for task" });
      }
      let task: EngineTask;
      try {
        task = await this.request<EngineTask>(
          "GET",
          `/tasks/${String(taskUid)}`,
          undefined,
          "wait for task",
          {
            timeoutMs: Math.min(this.options.requestTimeoutMs, Math.max(remaining, 1)),
            idempotent: true,
          },
        );
      } catch (error) {
        // A task the engine does not know (yet) is not finished; anything else is a real failure.
        if (
          error instanceof SearchEngineError &&
          (error.engineCode === "task_not_found" || error.code === "engine_timeout")
        ) {
          if (Date.now() >= deadline) {
            throw new SearchEngineError("engine_task_timeout", { operation: "wait for task" });
          }
          await delay(Math.min(pause, Math.max(deadline - Date.now(), 0)));
          pause = Math.min(pause * 2, POLL_MAX_MS);
          continue;
        }
        throw error;
      }
      if (task.status === "succeeded") {
        return task;
      }
      if (task.status === "failed" || task.status === "canceled") {
        const engineCode =
          task.status === "canceled" ? "task_canceled" : (task.error?.code ?? undefined);
        throw new SearchEngineError("engine_task_failed", {
          operation: "task",
          ...(engineCode === undefined ? {} : { engineCode }),
        });
      }
      await delay(Math.min(pause, Math.max(deadline - Date.now(), 0)));
      pause = Math.min(pause * 2, POLL_MAX_MS);
    }
  }
}

function errorCodeOf(status: number, engineCode: string | undefined): SearchEngineErrorCode {
  if (status === 401 || status === 403) {
    return "engine_unauthorized";
  }
  if (status === 404 && engineCode === "index_not_found") {
    return "engine_index_missing";
  }
  if (status >= 500) {
    return "engine_unavailable";
  }
  return "engine_rejected";
}

/** Status and body to the call's value, or the typed error (unchanged from the `fetch` client). */
function interpret<T>(answer: { status: number; text: string }, operation: string): T {
  const ok = answer.status >= 200 && answer.status <= 299;
  let parsed: unknown = undefined;
  if (answer.text !== "") {
    try {
      parsed = JSON.parse(answer.text);
    } catch {
      throw new SearchEngineError(ok ? "engine_bad_response" : "engine_unavailable", {
        operation,
        status: answer.status,
      });
    }
  }
  if (!ok) {
    const engineCode =
      typeof parsed === "object" && parsed !== null && "code" in parsed
        ? String((parsed as { code: unknown }).code)
        : undefined;
    throw new SearchEngineError(errorCodeOf(answer.status, engineCode), {
      operation,
      status: answer.status,
      ...(engineCode === undefined ? {} : { engineCode }),
    });
  }
  return parsed as T;
}
