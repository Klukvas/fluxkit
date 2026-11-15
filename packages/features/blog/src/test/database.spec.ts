import pg from "pg";
import { describe, expect, it } from "vitest";
import { closePool, createScratchDatabase } from "./database.js";

/*
 * Regression: `pool.end()` of pg-pool resolves once its client list is empty, before each client's socket has closed. The
 * forced `drop database` that followed could then terminate a still-open backend, and that client raised an unhandled
 * FATAL 57P01 ("terminating connection due to administrator command") that failed whichever blog spec file was running.
 */
describe("the scratch database helper", () => {
  it("closes the pool only once every pooled connection has closed", async () => {
    const database = await createScratchDatabase();
    const pool = new pg.Pool({ connectionString: database.url });
    let closedConnections = 0;
    pool.on("remove", () => {
      closedConnections += 1;
    });
    try {
      await Promise.all([1, 2, 3].map(() => pool.query("select pg_sleep(0.05)")));
      const openConnections = pool.totalCount;
      expect(openConnections).toBeGreaterThan(1);

      await closePool(pool);

      expect(closedConnections).toBe(openConnections);
    } finally {
      await database.drop();
    }
  });
});
