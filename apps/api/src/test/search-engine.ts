import { randomBytes } from "node:crypto";
import { requireEnv } from "./env.js";

/**
 * Test helpers for the real Meilisearch (CI service container, local binary): a unique index prefix per spec, a key scoped
 * to it with exactly the actions of ADR 0034 decision 9 (made with the master key, as an operator would), and cleanup.
 * The master key is used here only; the code under test only ever sees the scoped key.
 */

/** The actions of the API's key (ADR 0034 decision 9, README "Search"). */
export const SCOPED_KEY_ACTIONS = [
  "search",
  "documents.add",
  "documents.delete",
  "indexes.create",
  "indexes.delete",
  "indexes.swap",
  "settings.update",
  "settings.get",
  "tasks.get",
  "tasks.delete",
  "stats.get",
] as const;

export function meiliUrl(): string {
  return requireEnv("MEILI_URL").replace(/\/+$/, "");
}

async function master<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${meiliUrl()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${requireEnv("MEILI_MASTER_KEY")}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Test setup: ${method} ${path} answered ${response.status}: ${text}`);
  }
  return (text === "" ? {} : JSON.parse(text)) as T;
}

/** A fresh prefix such as `t3fa9c1e2_`, unique per call, valid for `MEILI_INDEX_PREFIX`. */
export function testIndexPrefix(label = "t"): string {
  return `${label}${randomBytes(5).toString("hex")}_`;
}

/** Creates a key limited to `<prefix>*` with the API's actions (or others) and returns its secret. */
export async function createScopedKey(
  prefix: string,
  actions: readonly string[] = SCOPED_KEY_ACTIONS,
): Promise<{ key: string; uid: string }> {
  const created = await master<{ key: string; uid: string }>("POST", "/keys", {
    description: `fluxkit test key for ${prefix}`,
    actions,
    indexes: [`${prefix}*`],
    expiresAt: null,
  });
  return { key: created.key, uid: created.uid };
}

export async function deleteKey(uid: string): Promise<void> {
  await master("DELETE", `/keys/${uid}`);
}

/** Deletes every index whose uid starts with `prefix` and waits for the deletions. */
export async function deleteIndexesWithPrefix(prefix: string): Promise<void> {
  const listed = await master<{ results: { uid: string }[] }>("GET", "/indexes?limit=1000");
  for (const { uid } of listed.results.filter((index) => index.uid.startsWith(prefix))) {
    const task = await master<{ taskUid: number }>("DELETE", `/indexes/${uid}`);
    await waitForMasterTask(task.taskUid);
  }
}

export async function listIndexUids(prefix: string): Promise<string[]> {
  const listed = await master<{ results: { uid: string }[] }>("GET", "/indexes?limit=1000");
  return listed.results
    .map((index) => index.uid)
    .filter((uid) => uid.startsWith(prefix))
    .sort();
}

/** All documents of an index (master key, every field, not only the displayed ones). */
export async function allDocuments(uid: string): Promise<Record<string, unknown>[]> {
  const page = await master<{ results: Record<string, unknown>[] }>(
    "POST",
    `/indexes/${uid}/documents/fetch`,
    { limit: 10_000 },
  );
  return page.results;
}

export async function indexSettings(uid: string): Promise<Record<string, unknown>> {
  return master("GET", `/indexes/${uid}/settings`);
}

/** Changes settings of an index behind the API's back (master key) and waits: a spec that simulates drift. */
export async function updateIndexSettingsAsMaster(uid: string, settings: object): Promise<void> {
  const task = await master<{ taskUid: number }>("PATCH", `/indexes/${uid}/settings`, settings);
  await waitForMasterTask(task.taskUid);
}

/** Tasks the engine still keeps for one index (master key). */
export async function countTasksOf(uid: string): Promise<number> {
  const page = await master<{ total: number }>(
    "GET",
    `/tasks?indexUids=${encodeURIComponent(uid)}&limit=1`,
  );
  return page.total;
}

export async function waitForMasterTask(taskUid: number): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const task = await master<{ status: string }>("GET", `/tasks/${taskUid}`);
    if (task.status === "succeeded" || task.status === "failed" || task.status === "canceled") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Test setup: task ${taskUid} did not finish`);
}
