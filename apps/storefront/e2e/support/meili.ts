// The engine side of the e2e setup: a scoped key for this suite's index prefix, created with the master key exactly as an
// operator does (README, "Catalog search"), and the removal of the key and the indexes. Used by `prepare-database.ts` (plain
// Node, no Playwright) and `global-teardown.ts`. Only the setup holds the master key; the API gets the scoped key.
import { rmSync, writeFileSync } from "node:fs";
import {
  E2E_MEILI_KEY_DESCRIPTION,
  E2E_MEILI_KEY_FILE,
  E2E_MEILI_PREFIX,
  readMeiliKey,
  type Env,
  type MeiliKey,
} from "./env.ts";

/** The actions the API needs and nothing else (README, "Catalog search"; the same list as `scripts/feature-matrix.sh`). */
const KEY_ACTIONS = [
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
];

function engine(env: Env): { url: string; master: string } {
  const url = env["MEILI_URL"];
  const master = env["MEILI_MASTER_KEY"];
  if (url === undefined || url === "" || master === undefined || master === "") {
    throw new Error("MEILI_URL and MEILI_MASTER_KEY must be set to run the e2e suite with search.");
  }
  return { url: url.replace(/\/+$/, ""), master };
}

async function call<T>(env: Env, method: string, path: string, body?: unknown): Promise<T> {
  const { url, master } = engine(env);
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${master}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    // The engine's message names no secret; the master key is never part of it.
    throw new Error(`Engine ${method} ${path} answered ${String(response.status)}: ${text}`);
  }
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

async function waitForTask(env: Env, taskUid: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const task = await call<{ status: string; error?: { message: string } }>(
      env,
      "GET",
      `/tasks/${String(taskUid)}`,
    );
    if (task.status === "succeeded") return;
    if (task.status === "failed" || task.status === "canceled") {
      throw new Error(
        `Engine task ${String(taskUid)} ${task.status}: ${task.error?.message ?? ""}`,
      );
    }
    if (Date.now() > deadline)
      throw new Error(`Engine task ${String(taskUid)} did not finish in 30 s.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Deletes every index of the suite's prefix (a run that crashed leaves them) and waits until they are gone. */
export async function removeSuiteIndexes(env: Env): Promise<void> {
  const list = await call<{ results: { uid: string }[] }>(env, "GET", "/indexes?limit=1000");
  for (const { uid } of list.results) {
    if (!uid.startsWith(E2E_MEILI_PREFIX)) continue;
    const task = await call<{ taskUid: number }>(
      env,
      "DELETE",
      `/indexes/${encodeURIComponent(uid)}`,
    );
    await waitForTask(env, task.taskUid);
  }
}

/** Deletes the suite's keys of earlier runs (by description) and the one in the key file. */
export async function removeSuiteKeys(env: Env): Promise<void> {
  const list = await call<{ results: { uid: string; description: string | null }[] }>(
    env,
    "GET",
    "/keys?limit=1000",
  );
  for (const key of list.results) {
    if (key.description === E2E_MEILI_KEY_DESCRIPTION) {
      await call(env, "DELETE", `/keys/${encodeURIComponent(key.uid)}`);
    }
  }
}

/**
 * Starts the suite with nothing of an earlier run in the engine, then creates the suite's scoped key (indexes of the
 * prefix only) and writes it to the key file (mode 0600).
 */
export async function createSuiteKey(env: Env): Promise<MeiliKey> {
  await removeSuiteKeys(env);
  await removeSuiteIndexes(env);
  const created = await call<MeiliKey>(env, "POST", "/keys", {
    description: E2E_MEILI_KEY_DESCRIPTION,
    indexes: [`${E2E_MEILI_PREFIX}*`],
    expiresAt: null,
    actions: KEY_ACTIONS,
  });
  const key: MeiliKey = { key: created.key, uid: created.uid };
  writeFileSync(E2E_MEILI_KEY_FILE, JSON.stringify(key), { mode: 0o600 });
  return key;
}

/** Teardown: the suite's key, its indexes and the key file. */
export async function removeSuiteSearch(env: Env): Promise<void> {
  if (readMeiliKey() === undefined) return;
  await removeSuiteKeys(env);
  await removeSuiteIndexes(env);
  rmSync(E2E_MEILI_KEY_FILE, { force: true });
}
