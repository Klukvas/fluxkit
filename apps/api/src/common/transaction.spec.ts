import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brand } from "../database/schema/index.js";
import * as schema from "../database/schema/index.js";
import { ensureMigrated } from "../test/migrate.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { withTransaction } from "./transaction.js";

describe("withTransaction (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const db = drizzle(pool, { schema });
  const slug = `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await ensureMigrated();
  });

  afterAll(async () => {
    await db.delete(brand).where(eq(brand.slug, slug));
    await pool.end();
  });

  it("rolls back every write when the callback throws, and rethrows the same error", async () => {
    const failure = new Error("stop");
    await expect(
      withTransaction(db, async (tx) => {
        await tx.insert(brand).values({ slug, name: { uk: "Tx" } });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.select().from(brand).where(eq(brand.slug, slug))).toHaveLength(0);
  });

  it("commits and returns the callback result", async () => {
    const result = await withTransaction(db, async (tx) => {
      const [row] = await tx
        .insert(brand)
        .values({ slug, name: { uk: "Tx" } })
        .returning();
      return row?.slug;
    });
    expect(result).toBe(slug);
    expect(await db.select().from(brand).where(eq(brand.slug, slug))).toHaveLength(1);
  });
});
