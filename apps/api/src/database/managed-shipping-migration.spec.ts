import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
describe("managed shipping migration 0024", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });
  it("enforces kind, provider, purpose, immutable binding and guarded rollback", async () => {
    const client = await pool.connect();
    await client.query("begin");
    try {
      const owner = randomUUID(),
        wrongKind = randomUUID(),
        wrongProvider = randomUUID();
      for (const [id, kind, code] of [
        [owner, "shipping", "managed"],
        [wrongKind, "payment", "managed"],
        [wrongProvider, "shipping", "other"],
      ])
        await client.query("insert into integration(id,kind,provider_code) values($1,$2,$3)", [
          id,
          kind,
          code,
        ]);
      const outbound = randomUUID(),
        webhook = randomUUID(),
        foreign = randomUUID(),
        other = randomUUID();
      for (const [id, integration, purpose, generation] of [
        [outbound, owner, "outbound", 1],
        [webhook, owner, "webhook", 2],
        [foreign, wrongKind, "outbound", 1],
        [other, wrongProvider, "outbound", 1],
      ])
        await client.query(
          "insert into integration_credential_version(id,integration_id,purpose,generation,state) values($1,$2,$3,$4,'candidate')",
          [id, integration, purpose, generation],
        );
      const order = randomUUID(),
        shipment = randomUUID();
      await client.query(
        "insert into sales_order(id,number,status,locale,currency,subtotal_amount,shipping_total,discount_total,tax_total,total_amount,contact_erased_at,idempotency_key,request_fingerprint,expires_at) values($1,'ABCD-EF01','paid','uk','UAH',100,0,0,0,100,now(),gen_random_uuid(),repeat('a',64),now()+interval '1 hour')",
        [order],
      );
      await client.query(
        "insert into shipment(id,order_id,provider_code,status,client_reference,declared_value_amount,currency,payer,weight_grams,length_mm,width_mm,height_mm,seats) values($1,$2,'managed','pending','ABCD-EF01',100,'UAH','sender',1,1,1,1,1)",
        [shipment, order],
      );
      const refuses = async (statement: string, values: unknown[], message: RegExp) => {
        await client.query("savepoint refused");
        await expect(client.query(statement, values)).rejects.toThrow(message);
        await client.query("rollback to savepoint refused");
      };
      for (const invalid of [webhook, foreign, other, randomUUID()])
        await refuses(
          "update shipment set integration_credential_version_id=$2 where id=$1",
          [shipment, invalid],
          /shipment_credential_version_mismatch/,
        );
      await client.query("update shipment set integration_credential_version_id=$2 where id=$1", [
        shipment,
        outbound,
      ]);
      await client.query("update shipment set tracking_attempts=1 where id=$1", [shipment]);
      for (const invalid of [null, webhook])
        await refuses(
          "update shipment set integration_credential_version_id=$2 where id=$1",
          [shipment, invalid],
          /shipment_credential_binding_immutable/,
        );
      await refuses(
        "update shipment set provider_code='other' where id=$1",
        [shipment],
        /shipment_credential_version_mismatch/,
      );
      await refuses(
        "delete from integration_credential_version where id=$1",
        [outbound],
        /foreign key/,
      );
      await refuses(
        "update integration set provider_code='renamed' where id=$1",
        [owner],
        /shipment_credential_binding_immutable/,
      );
      const down = (await readFile(`${folder}/0024_managed_shipping_credentials.down.sql`, "utf8"))
        .replace(/^BEGIN;/m, "")
        .replace(/COMMIT;\s*$/, "");
      await refuses(down, [], /managed_shipping_credentials_rollback_incompatible/);
      expect(
        (
          await client.query("select integration_credential_version_id from shipment where id=$1", [
            shipment,
          ])
        ).rows,
      ).toEqual([{ integration_credential_version_id: outbound }]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
  it("runs up/down/up/down and removes only its journal entry", async () => {
    const down = await readFile(`${folder}/0024_managed_shipping_credentials.down.sql`, "utf8");
    const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const when = journal.entries.find(
      (entry) => entry.tag === "0024_managed_shipping_credentials",
    )?.when;
    expect(when).toBeTypeOf("number");
    for (let pass = 0; pass < 2; pass++) {
      await pool.query(down);
      expect(
        (
          await pool.query(
            "select 1 from information_schema.columns where table_name='shipment' and column_name='integration_credential_version_id'",
          )
        ).rows,
      ).toEqual([]);
      expect(
        (await pool.query("select 1 from drizzle.__drizzle_migrations where created_at=$1", [when]))
          .rows,
      ).toEqual([]);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(
        (
          await pool.query(
            "select 1 from information_schema.columns where table_name='shipment' and column_name='integration_credential_version_id'",
          )
        ).rows,
      ).toHaveLength(1);
    }
  });
});
