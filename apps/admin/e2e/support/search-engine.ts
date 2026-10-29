// The search engine of the admin e2e run: a key scoped to this suite's index prefix, created with the master key the way an
// operator does it (README, "Catalog search"), so the API never sees the master key and a leaked key cannot touch other
// indexes. `prepare-database.ts` creates it before anything starts and writes the key to a file only the API's start command
// reads; `global-teardown.ts` deletes the key and every index of the prefix. Plain `fetch`, no dependency.
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { ADMIN_E2E_SEARCH_KEY_FILE, ADMIN_E2E_SEARCH_PREFIX, type Env } from "./env.ts";

/** What the API's search module does with the engine (`docs/contracts/config.md`, `MEILI_API_KEY`). */
const ACTIONS = [
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

const UID_FILE = `${ADMIN_E2E_SEARCH_KEY_FILE}.uid`;

function master(env: Env): { url: string; key: string } {
  const url = env["MEILI_URL"];
  const key = env["MEILI_MASTER_KEY"];
  if (url === undefined || url === "" || key === undefined || key === "") {
    throw new Error("MEILI_URL and MEILI_MASTER_KEY must be set to run the admin e2e suite.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

async function call(env: Env, method: string, path: string, body?: unknown): Promise<unknown> {
  const { url, key } = master(env);
  const response = await fetch(`${url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Meilisearch ${method} ${path} answered ${String(response.status)}.`);
  }
  return response.status === 204 || response.status === 404 ? null : response.json();
}

async function deleteIndexesOfPrefix(env: Env): Promise<void> {
  const list = (await call(env, "GET", "/indexes?limit=1000")) as {
    results: { uid: string }[];
  } | null;
  for (const index of list?.results ?? []) {
    if (index.uid.startsWith(ADMIN_E2E_SEARCH_PREFIX)) {
      await call(env, "DELETE", `/indexes/${encodeURIComponent(index.uid)}`);
    }
  }
}

/** Removes the key and the indexes a previous or the current run created (idempotent). */
export async function removeSearchKeyAndIndexes(env: Env): Promise<void> {
  try {
    const uid = readFileSync(UID_FILE, "utf8").trim();
    if (uid !== "") await call(env, "DELETE", `/keys/${encodeURIComponent(uid)}`);
  } catch (error) {
    // No uid file: nothing was created by a run that left it behind.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await deleteIndexesOfPrefix(env);
  rmSync(ADMIN_E2E_SEARCH_KEY_FILE, { force: true });
  rmSync(UID_FILE, { force: true });
}

/**
 * Creates the scoped key (fresh engine state first), writes it to `ADMIN_E2E_SEARCH_KEY_FILE` (mode 0600) and returns it for
 * the processes `prepare-database.ts` runs itself. The API's start command reads the same file.
 */
export async function createSearchKey(env: Env): Promise<string> {
  await removeSearchKeyAndIndexes(env);
  const created = (await call(env, "POST", "/keys", {
    description: "fluxkit admin e2e",
    indexes: [`${ADMIN_E2E_SEARCH_PREFIX}*`],
    expiresAt: null,
    actions: ACTIONS,
  })) as { key: string; uid: string };
  writeFileSync(UID_FILE, created.uid, { mode: 0o600 });
  writeFileSync(ADMIN_E2E_SEARCH_KEY_FILE, created.key, { mode: 0o600 });
  chmodSync(ADMIN_E2E_SEARCH_KEY_FILE, 0o600);
  return created.key;
}
