/**
 * A small REST client of Meilisearch (ADR 0034): the calls the indexer and the search routes need, with one timeout per
 * request and typed errors. Plain `fetch` on purpose: the wire format is what the spike pinned
 * (`apps/api/src/spikes/search-s1.spec.ts`), including federation `page`/`hitsPerPage`, which the `meilisearch` package
 * types do not carry.
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
  | "engine_task_timeout";

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
  /** Limit of one HTTP request. */
  readonly requestTimeoutMs: number;
}

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
  constructor(private readonly options: SearchEngineOptions) {}

  /** One request; `operation` names it in errors (never the URL). */
  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
    path: string,
    body: unknown,
    operation: string,
    timeoutMs: number = this.options.requestTimeoutMs,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.options.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new SearchEngineError(
        name === "TimeoutError" || name === "AbortError" ? "engine_timeout" : "engine_unreachable",
        { operation },
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new SearchEngineError(
        name === "TimeoutError" || name === "AbortError" ? "engine_timeout" : "engine_unreachable",
        { operation, status: response.status },
      );
    }
    let parsed: unknown = undefined;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new SearchEngineError(response.ok ? "engine_bad_response" : "engine_unavailable", {
          operation,
          status: response.status,
        });
      }
    }
    if (!response.ok) {
      const engineCode =
        typeof parsed === "object" && parsed !== null && "code" in parsed
          ? String((parsed as { code: unknown }).code)
          : undefined;
      throw new SearchEngineError(errorCodeOf(response.status, engineCode), {
        operation,
        status: response.status,
        ...(engineCode === undefined ? {} : { engineCode }),
      });
    }
    return parsed as T;
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

  /** `GET /health`; throws when the engine cannot be reached or does not answer in time. */
  async health(timeoutMs?: number): Promise<true> {
    const answer = await this.request<{ status?: unknown }>(
      "GET",
      "/health",
      undefined,
      "health",
      timeoutMs,
    );
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
    );
    if (typeof stats?.numberOfDocuments !== "number") {
      throw new SearchEngineError("engine_bad_response", { operation: "stats" });
    }
    return stats.numberOfDocuments;
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

  /** One atomic swap of every pair (spike S1, E9). */
  swapIndexes(pairs: readonly (readonly [string, string])[]): Promise<TaskUid> {
    return this.enqueue(
      "POST",
      "/swap-indexes",
      pairs.map((pair) => ({ indexes: [...pair] })),
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

  async multiSearch<T = unknown>(body: object, timeoutMs?: number): Promise<T> {
    return this.request<T>("POST", "/multi-search", body, "search", timeoutMs);
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
          Math.min(this.options.requestTimeoutMs, Math.max(remaining, 1)),
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
