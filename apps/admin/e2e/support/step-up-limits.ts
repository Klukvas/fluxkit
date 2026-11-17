// The password re-entry limits (ADR 0058: 5 per 15 minutes per admin, 20 per client address) live in Redis and outlive the
// run, while the database is wiped at every start: without this, a second local run within 15 minutes would be throttled by
// the first one's attempts. Only the keys of the e2e database's own namespace are removed. `ioredis` is the API's existing
// dependency.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { databaseNameOf, requireE2eDatabaseUrl, type Env } from "./env.ts";

interface RedisClient {
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    size: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
}

const apiRoot = resolve(import.meta.dirname, "../../../api");
const { Redis } = createRequire(resolve(apiRoot, "package.json"))("ioredis") as {
  Redis: new (url: string, options: { maxRetriesPerRequest: number }) => RedisClient;
};

/** `KEYS`-style special characters of a Redis glob, so a database name is matched as text. */
const escapeGlob = (text: string) => text.replace(/[\\*?[\]]/g, "\\$&");

/**
 * The namespace the API gives its strict windows: `fluxkit:<database name, percent-encoded>:strict:` (`rateLimitPrefix` in
 * `apps/api/src/rate-limit/window-store.ts`).
 */
export function stepUpKeyPattern(env: Env): string {
  const name = databaseNameOf(requireE2eDatabaseUrl(env));
  if (name === undefined || name === "") throw new Error("The e2e database has no name.");
  return `fluxkit:${escapeGlob(encodeURIComponent(name))}:strict:*`;
}

/** Deletes the step-up limit keys of the e2e database; answers how many there were. */
export async function clearStepUpLimits(env: Env): Promise<number> {
  const url = env["REDIS_URL"];
  if (url === undefined || url === "")
    throw new Error("REDIS_URL must be set (apps/admin/e2e/README.md).");
  const pattern = stepUpKeyPattern(env);
  const redis = new Redis(url, { maxRetriesPerRequest: 1 });
  try {
    let cursor = "0";
    let removed = 0;
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
      if (keys.length > 0) removed += await redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
    return removed;
  } finally {
    await redis.quit();
  }
}
