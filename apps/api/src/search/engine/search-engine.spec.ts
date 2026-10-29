import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  countTasksOf,
  createScopedKey,
  deleteIndexesWithPrefix,
  deleteKey,
  meiliUrl,
  testIndexPrefix,
  waitForMasterTask,
} from "../../test/search-engine.js";
import { SearchEngine, SearchEngineError } from "./index.js";

/** Real Meilisearch with a key scoped to a fresh prefix (ADR 0034 decision 9), as the API runs it. */
describe("SearchEngine (real Meilisearch)", () => {
  const prefix = testIndexPrefix("eng");
  const uid = `${prefix}catalog_uk`;
  let key: { key: string; uid: string };
  let engine: SearchEngine;

  beforeAll(async () => {
    key = await createScopedKey(prefix);
    engine = new SearchEngine({ url: meiliUrl(), apiKey: key.key, requestTimeoutMs: 2_000 });
  });

  afterAll(async () => {
    await deleteIndexesWithPrefix(prefix);
    await deleteKey(key.uid);
  });

  async function expectEngineError(
    run: () => Promise<unknown>,
    code: string,
  ): Promise<SearchEngineError> {
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error, `expected ${code}`).toBeInstanceOf(SearchEngineError);
    const engineError = error as SearchEngineError;
    expect(engineError.code).toBe(code);
    return engineError;
  }

  it("reports health and creates, fills, configures, reads and deletes an index of its prefix", async () => {
    expect(await engine.health()).toBe(true);
    await engine.waitForTask(await engine.createIndex(uid), 10_000);
    await engine.waitForTask(
      await engine.updateSettings(uid, { filterableAttributes: ["productId"] }),
      10_000,
    );
    await engine.waitForTask(
      await engine.addDocuments(uid, [
        { id: "a", productId: "p1", title: "Сорочка" },
        { id: "b", productId: "p2", title: "Футболка" },
      ]),
      10_000,
    );
    expect(await engine.documentCount(uid)).toBe(2);
    await engine.waitForTask(await engine.deleteDocumentsByFilter(uid, 'productId = "p1"'), 10_000);
    expect(await engine.documentCount(uid)).toBe(1);
    const result = await engine.multiSearch({ queries: [{ indexUid: uid, q: "футболка" }] });
    expect(result).toMatchObject({ results: [{ hits: [{ id: "b" }] }] });
    await engine.waitForTask(await engine.deleteIndex(uid), 10_000);
    await expectEngineError(() => engine.documentCount(uid), "engine_index_missing");
  });

  it("maps a failed task to engine_task_failed with the engine's code, never its message", async () => {
    await engine.waitForTask(await engine.createIndex(`${prefix}bad`), 10_000);
    // A document without the primary key is refused by the task, not by the request.
    const task = await engine.addDocuments(`${prefix}bad`, [{ title: "no id" }]);
    const error = await expectEngineError(
      () => engine.waitForTask(task, 10_000),
      "engine_task_failed",
    );
    expect(error.engineCode).toBe("missing_document_id");
    expect(error.message).not.toMatch(/no id|doesn't have|primary key/i);
  });

  it("gives up waiting for a task after the deadline with engine_task_timeout", async () => {
    await expectEngineError(
      () => engine.waitForTask(Number.MAX_SAFE_INTEGER - 1, 1),
      "engine_task_timeout",
    );
  });

  it("is refused outside its prefix (the key scope) with engine_unauthorized", async () => {
    const error = await expectEngineError(
      () => engine.createIndex("someone_elses_index"),
      "engine_unauthorized",
    );
    expect(error.status).toBe(403);
    await expectEngineError(
      () => engine.swapIndexes([{ indexes: [`${prefix}x`, "someone_elses_index"] }]),
      "engine_unauthorized",
    );
  });

  it("refuses a wrong key without ever putting the key into the error", async () => {
    const wrong = new SearchEngine({
      url: meiliUrl(),
      apiKey: "wrong-key-0123456789-secret",
      requestTimeoutMs: 2_000,
    });
    const error = await expectEngineError(() => wrong.documentCount(uid), "engine_unauthorized");
    expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(
      "wrong-key-0123456789-secret",
    );
    expect(error.message).not.toContain(key.key);
  });

  it("maps an unreachable engine to engine_unreachable and a silent one to engine_timeout", async () => {
    const closed = new SearchEngine({
      url: "http://127.0.0.1:9",
      apiKey: key.key,
      requestTimeoutMs: 2_000,
    });
    await expectEngineError(() => closed.health(), "engine_unreachable");
    expect(await closed.isHealthy()).toBe(false);

    const silent: Server = createServer(() => {
      // never answers
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    try {
      const port = (silent.address() as AddressInfo).port;
      const hanging = new SearchEngine({
        url: `http://127.0.0.1:${port}`,
        apiKey: key.key,
        requestTimeoutMs: 200,
      });
      const started = Date.now();
      await expectEngineError(() => hanging.health(), "engine_timeout");
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it("KNOWN LIMITATION: a key scoped to indexes can not read the swap task; a later task of the index ends after it", async () => {
    const left = `${prefix}swap_a`;
    const right = `${prefix}swap_b`;
    await engine.waitForTask(await engine.createIndex(left), 10_000);
    await engine.waitForTask(await engine.createIndex(right), 10_000);
    await engine.waitForTask(
      await engine.addDocuments(right, [{ id: "x", productId: "p" }]),
      10_000,
    );
    const swap = await engine.swapIndexes([{ indexes: [left, right] }]);
    await expectEngineError(() => engine.waitForTask(swap, 300), "engine_task_timeout");
    await engine.waitForTask(await engine.updateSettings(left, {}), 10_000);
    expect(await engine.documentCount(left)).toBe(1);
    expect(await engine.documentCount(right)).toBe(0);
  });

  it("prunes the finished tasks of its own indexes (tasks.delete in the key)", async () => {
    await engine.waitForTask(await engine.createIndex(`${prefix}prune`), 10_000);
    expect(await countTasksOf(`${prefix}prune`)).toBe(1);
    const pruneTask = await engine.pruneFinishedTasks(new Date(Date.now() + 60_000));
    // KNOWN LIMITATION (v1.55.0): a key scoped to indexes cannot read the task-deletion task itself (it belongs to no
    // index), so the indexer does not wait for it; the master key can.
    await expectEngineError(() => engine.waitForTask(pruneTask, 300), "engine_task_timeout");
    await waitForMasterTask(pruneTask);
    expect(await countTasksOf(`${prefix}prune`)).toBe(0);
  });
});
