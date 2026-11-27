import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));

describe("baseline rewrap migration 0025 (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  beforeAll(() => ensureMigrated([], { reset: true }));
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });
  async function assertGuard(allowed: boolean) {
    const client = await pool.connect();
    await client.query("begin");
    try {
      const integration = randomUUID(),
        id = randomUUID();
      await client.query(
        "insert into integration(id,kind,provider_code) values($1,'payment','testpay')",
        [integration],
      );
      await client.query(
        "insert into integration_merchant_baseline(id,integration_id,kind,provider_code,environment,enrollment_source,key_id,nonce,ciphertext,tag) values($1,$2,'payment','testpay','default','first_save','old',$3,$4,$5)",
        [id, integration, Buffer.alloc(12), Buffer.from("encrypted"), Buffer.alloc(16)],
      );
      const refuses = async (query: string) => {
        await client.query("savepoint refused");
        await expect(client.query(query, [id])).rejects.toThrow(
          "integration_merchant_baseline_immutable",
        );
        await client.query("rollback to savepoint refused");
      };
      await refuses("update integration_merchant_baseline set key_id='new' where id=$1");
      await client.query("set local fluxkit.baseline_rewrap='on'");
      for (const assignment of [
        "id=gen_random_uuid()",
        "integration_id=gen_random_uuid()",
        "kind='shipping'",
        "provider_code='other'",
        "environment='production'",
        "enrollment_source='changed'",
        "created_at=now()+interval '1 day'",
        "created_by=gen_random_uuid()",
      ])
        await refuses(`update integration_merchant_baseline set ${assignment} where id=$1`);
      await refuses("delete from integration_merchant_baseline where id=$1");
      if (allowed) {
        await client.query(
          "update integration_merchant_baseline set key_id='new',nonce=$2,ciphertext=$3,tag=$4 where id=$1",
          [id, Buffer.alloc(12, 1), Buffer.from("rewrapped"), Buffer.alloc(16, 1)],
        );
        expect(
          (await client.query("select key_id from integration_merchant_baseline where id=$1", [id]))
            .rows,
        ).toEqual([{ key_id: "new" }]);
      } else await refuses("update integration_merchant_baseline set key_id='new' where id=$1");
    } finally {
      await client.query("rollback");
      client.release();
    }
  }
  it("requires the transaction flag for envelope changes and always refuses identity updates/delete", async () =>
    assertGuard(true));
  it("runs up/down/up/down, restores the strict trigger and deletes only its own journal row", async () => {
    const down = await readFile(`${folder}/0025_integration_baseline_rewrap.down.sql`, "utf8");
    const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const when = journal.entries.find((e) => e.tag === "0025_integration_baseline_rewrap")?.when;
    for (let pass = 0; pass < 2; pass++) {
      const before = (
        await pool.query<{ created_at: string }>(
          "select created_at from drizzle.__drizzle_migrations order by created_at",
        )
      ).rows;
      await pool.query(down);
      const after = (
        await pool.query<{ created_at: string }>(
          "select created_at from drizzle.__drizzle_migrations order by created_at",
        )
      ).rows;
      expect(after).toEqual(before.filter((r) => Number(r.created_at) !== when));
      await assertGuard(false);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      await assertGuard(true);
    }
  });
});
