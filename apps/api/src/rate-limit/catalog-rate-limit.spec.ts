import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProblemBody } from "../common/problem.filter.js";
import { startApp, type RunningApp } from "../test/app.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { FakeClock } from "../test/fake-clock.js";
import { http, type HttpResult } from "../test/http.js";
import { ensureMigrated } from "../test/migrate.js";
import { SearchWorld } from "../test/search-world.js";
import { RATE_LIMITS } from "./rate-limiter.js";

// Plan docs/plans/2026-11-14-catalog-rate-limits.md: the plain catalog reads of `/store/*` share the `catalogRead` window
// per client address; the storefront's own server reads (straight to the API, no forwarded hop) are not counted.

const START = "2030-04-01T08:00:00.000Z";
const CATALOG_READS = ["/store/config", "/store/categories", "/store/products", "/store/banners"];
const LIMIT = RATE_LIMITS.catalogRead.maxAttempts;

const forwardedFor = (address: string) => ({ "x-forwarded-for": address });
const read = (running: RunningApp, path: string, address?: string): Promise<HttpResult> =>
  http(running.baseUrl, "GET", path, {
    headers: address === undefined ? {} : forwardedFor(address),
  });

/** Uses up the window of `address` across all four routes; every read before the limit is a plain 200. */
async function exhaust(running: RunningApp, address?: string): Promise<void> {
  for (let attempt = 0; attempt < LIMIT; attempt += 1) {
    const path = CATALOG_READS[attempt % CATALOG_READS.length] ?? "/store/config";
    expect((await read(running, path, address)).status, `${path}, attempt ${attempt + 1}`).toBe(
      200,
    );
  }
}

describe("catalogRead behind one trusted proxy (TRUST_PROXY=1)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const clock = new FakeClock(START);
  let search: SearchWorld;
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    search = await SearchWorld.create("catalog-limit");
    running = await startApp({
      clock,
      trustProxy: 1,
      search: search.env,
      rateLimits: { search: { maxAttempts: 2, windowMinutes: 1 } },
    });
  });

  beforeEach(() => {
    clock.set(new Date(clock.now().getTime() + 24 * 3_600_000));
  });

  afterAll(async () => {
    await running.app.close();
    await search.dispose(pool);
    await pool.end();
  });

  it("shares one window across the catalog routes and answers 429 too_many_requests with Retry-After", async () => {
    await exhaust(running, "203.0.113.1");
    for (const path of CATALOG_READS) {
      const refused = await read(running, path, "203.0.113.1");
      expect(refused.status, path).toBe(429);
      expect(refused.headers.get("content-type")).toContain("application/problem+json");
      expect((refused.body as ProblemBody).code).toBe("too_many_requests");
      expect(refused.headers.get("retry-after")).toBe("60");
    }
    expect((await read(running, "/store/products/no-such-product", "203.0.113.1")).status).toBe(
      429,
    );
  });

  it("counts before validation: a refused read with a bad query is 429, not 400", async () => {
    await exhaust(running, "203.0.113.6");
    expect((await read(running, "/store/products?limit=999", "203.0.113.6")).status).toBe(429);
    expect((await read(running, "/store/products?limit=999", "203.0.113.7")).status).toBe(400);
  });

  it("counts each forwarded address in its own window", async () => {
    await exhaust(running, "203.0.113.1");
    expect((await read(running, "/store/config", "203.0.113.2")).status).toBe(200);
    expect((await read(running, "/store/config", "203.0.113.1")).status).toBe(429);
  });

  it("opens a new window after a minute", async () => {
    await exhaust(running, "203.0.113.3");
    expect((await read(running, "/store/config", "203.0.113.3")).status).toBe(429);
    clock.advanceMinutes(1);
    expect((await read(running, "/store/config", "203.0.113.3")).status).toBe(200);
  });

  it("does not count reads that reached the API without a forwarded hop (the storefront's Next server)", async () => {
    for (let attempt = 0; attempt < LIMIT + 50; attempt += 1) {
      const path = CATALOG_READS[attempt % CATALOG_READS.length] ?? "/store/config";
      expect((await read(running, path)).status, `${path}, attempt ${attempt + 1}`).toBe(200);
    }
  });

  it("leaves search alone: its own window, untouched by a used-up catalog window", async () => {
    await exhaust(running, "203.0.113.4");
    // The engine may have no index here; only the limiter's answer matters.
    expect((await read(running, "/store/search", "203.0.113.4")).status).not.toBe(429);
    expect((await read(running, "/store/search", "203.0.113.4")).status).not.toBe(429);
    expect((await read(running, "/store/search", "203.0.113.4")).status).toBe(429);
    // A used-up search window does not touch the catalog window of a fresh address.
    expect((await read(running, "/store/config", "203.0.113.5")).status).toBe(200);
  });
});

describe("catalogRead behind a CDN and an appending edge (TRUST_PROXY=2)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ clock, trustProxy: 2 });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("counts the client the CDN saw, so an address the client invented opens no new window", async () => {
    await exhaust(running, "198.51.100.1, 203.0.113.1, 192.0.2.10");
    expect(
      (await read(running, "/store/config", "198.51.100.2, 203.0.113.1, 192.0.2.11")).status,
    ).toBe(429);
    expect((await read(running, "/store/config", "203.0.113.2, 192.0.2.10")).status).toBe(200);
  });
});

describe("catalogRead with no trusted proxy (the default TRUST_PROXY=0)", () => {
  const clock = new FakeClock(START);
  let running: RunningApp;

  beforeAll(async () => {
    await ensureMigrated();
    running = await startApp({ clock });
  });

  afterAll(async () => {
    await running.app.close();
  });

  it("counts every read by the socket address and ignores a spoofed X-Forwarded-For", async () => {
    await exhaust(running);
    expect((await read(running, "/store/config")).status).toBe(429);
    expect((await read(running, "/store/config", "203.0.113.9")).status).toBe(429);
  });
});
