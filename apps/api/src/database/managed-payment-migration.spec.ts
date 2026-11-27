import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";

const folder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const downPath = `${folder}/0023_managed_payment_credentials.down.sql`;

describe("managed payment credential migration 0023 (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  let client: pg.PoolClient;
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });
  afterEach(async () => {
    await client.query("rollback");
    client.release();
  });

  async function refused(statement: string, values: unknown[], message: RegExp): Promise<void> {
    await client.query("savepoint refused");
    try {
      await expect(client.query(statement, values)).rejects.toThrow(message);
    } finally {
      await client.query("rollback to savepoint refused");
    }
  }
  async function integration(kind = "payment", code = "managed") {
    const id = randomUUID();
    await client.query("insert into integration(id,kind,provider_code) values($1,$2,$3)", [
      id,
      kind,
      code,
    ]);
    return id;
  }
  async function version(integrationId: string, purpose = "outbound", generation = 1) {
    const id = randomUUID();
    await client.query(
      "insert into integration_credential_version(id,integration_id,purpose,generation,state) values($1,$2,$3,$4,'candidate')",
      [id, integrationId, purpose, generation],
    );
    return id;
  }
  async function payment(binding: string | null, code = "managed") {
    const orderId = randomUUID();
    await client.query(
      `insert into sales_order(id,number,status,locale,currency,subtotal_amount,shipping_total,discount_total,tax_total,total_amount,contact_erased_at,idempotency_key,request_fingerprint,expires_at)
      values($1,$2,'awaiting_payment','uk','UAH',100,0,0,0,100,now(),$3,repeat('a',64),now()+interval '1 hour')`,
      [
        orderId,
        `${orderId.slice(0, 4).toUpperCase()}-${orderId.slice(4, 8).toUpperCase()}`,
        randomUUID(),
      ],
    );
    const id = randomUUID();
    await client.query(
      `insert into payment(id,order_id,provider_code,amount,currency,status,expires_at,created_by,integration_credential_version_id,idempotency_key,next_check_at)
      values($1,$2,$3,100,'UAH','creating',now()+interval '1 hour','guest',$4,gen_random_uuid(),now())`,
      [id, orderId, code, binding],
    );
    return id;
  }
  async function baseline(integrationId: string, overrides: Record<string, unknown> = {}) {
    const row = {
      id: randomUUID(),
      integration_id: integrationId,
      kind: "payment",
      provider_code: "managed",
      environment: "default",
      enrollment_source: "first_save",
      key_id: "test",
      nonce: Buffer.alloc(12),
      ciphertext: Buffer.from("merchant"),
      tag: Buffer.alloc(16),
      ...overrides,
    };
    const columns = Object.keys(row);
    await client.query(
      `insert into integration_merchant_baseline(${columns.map((c) => client.escapeIdentifier(c)).join(",")}) values(${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row),
    );
    return row.id;
  }
  async function rollbackRefused() {
    const down = await readFile(downPath, "utf8");
    await refused(
      down.replace(/^BEGIN;/m, "").replace(/COMMIT;\s*$/, ""),
      [],
      /managed_payment_credentials_rollback_incompatible/,
    );
  }

  it("pins only an outbound matching payment version and never replaces a non-null binding", async () => {
    const own = await integration();
    const outbound = await version(own);
    const webhook = await version(own, "webhook", 2);
    const foreign = await version(await integration("shipping", "foreign"));
    const id = await payment(null);
    for (const invalid of [webhook, foreign]) {
      await refused(
        "update payment set integration_credential_version_id=$2 where id=$1",
        [id, invalid],
        /payment_credential_version_mismatch/,
      );
    }
    await refused(
      "update payment set integration_credential_version_id=$2 where id=$1",
      [id, randomUUID()],
      /payment_credential_version_mismatch/,
    );
    await client.query("update payment set integration_credential_version_id=$2 where id=$1", [
      id,
      outbound,
    ]);
    await client.query("update payment set check_attempts=1 where id=$1", [id]);
    await refused(
      "update payment set provider_code='other' where id=$1",
      [id],
      /payment_credential_version_mismatch/,
    );
    await refused(
      "update payment set integration_credential_version_id=null where id=$1",
      [id],
      /payment_credential_binding_immutable/,
    );
    await refused(
      "update payment set integration_credential_version_id=$2 where id=$1",
      [id, webhook],
      /payment_credential_binding_immutable/,
    );
    await refused(
      "delete from integration_credential_version where id=$1",
      [outbound],
      /foreign key/,
    );
    await rollbackRefused();
  });
  it("rejects an invalid binding at insertion and preserves null legacy attempts", async () => {
    const webhook = await version(await integration(), "webhook");
    await client.query("savepoint before_insert");
    await expect(payment(webhook)).rejects.toThrow(/payment_credential_version_mismatch/);
    await client.query("rollback to savepoint before_insert");
    const id = await payment(null);
    expect(
      (
        await client.query("select integration_credential_version_id from payment where id=$1", [
          id,
        ])
      ).rows,
    ).toEqual([{ integration_credential_version_id: null }]);
  });
  it("enrolls one encrypted baseline per provider/environment and restricts identity ownership", async () => {
    const own = await integration();
    await baseline(own);
    await client.query("savepoint duplicate");
    await expect(baseline(own)).rejects.toThrow(/unique/);
    await client.query("rollback to savepoint duplicate");
    await client.query("savepoint mismatch");
    await expect(baseline(own, { environment: "sandbox", provider_code: "other" })).rejects.toThrow(
      /integration_merchant_baseline_identity_mismatch/,
    );
    await client.query("rollback to savepoint mismatch");
    await refused("delete from integration where id=$1", [own], /foreign key/);
    await refused(
      "update integration set provider_code='other' where id=$1",
      [own],
      /integration_merchant_baseline_identity_immutable/,
    );
    await refused(
      "update integration set kind='shipping' where id=$1",
      [own],
      /integration_merchant_baseline_identity_immutable/,
    );
    await rollbackRefused();
  });
  it("rejects baseline changes, deletion and truncation; permits only creator FK nulling", async () => {
    const own = await integration();
    const actor = randomUUID();
    await client.query(
      "insert into admin_user(id,email,password_hash,role) values($1,$2,'test','owner')",
      [actor, `${actor}@example.test`],
    );
    const id = await baseline(own, { created_by: actor });
    for (const [column, value] of Object.entries({
      id: randomUUID(),
      integration_id: randomUUID(),
      kind: "shipping",
      provider_code: "other",
      environment: "sandbox",
      enrollment_source: "env_cutover",
      created_at: new Date(0),
      key_id: "other",
      nonce: Buffer.alloc(12, 1),
      ciphertext: Buffer.from("other"),
      tag: Buffer.alloc(16, 1),
      created_by: randomUUID(),
    })) {
      await refused(
        `update integration_merchant_baseline set ${client.escapeIdentifier(column)}=$2 where id=$1`,
        [id, value],
        /integration_merchant_baseline_immutable/,
      );
    }
    await refused(
      "delete from integration_merchant_baseline where id=$1",
      [id],
      /integration_merchant_baseline_immutable/,
    );
    await refused(
      "truncate integration_merchant_baseline",
      [],
      /integration_merchant_baseline_immutable/,
    );
    await refused(
      "update integration_merchant_baseline set created_by=null where id=$1",
      [id],
      /integration_merchant_baseline_immutable/,
    );
    await client.query("delete from admin_user where id=$1", [actor]);
    expect(
      (await client.query("select created_by from integration_merchant_baseline where id=$1", [id]))
        .rows,
    ).toEqual([{ created_by: null }]);
    await refused(
      "update integration_merchant_baseline set created_by=$2 where id=$1",
      [id, actor],
      /integration_merchant_baseline_immutable/,
    );
  });
  it.each([
    { nonce: Buffer.alloc(11) },
    { tag: Buffer.alloc(15) },
    { ciphertext: Buffer.alloc(0) },
    { ciphertext: Buffer.alloc(257) },
    { key_id: "invalid key" },
    { environment: "Bad" },
    { enrollment_source: "env_cutover" },
  ])("bounds encrypted baseline and enrollment source %j", async (invalid) => {
    await expect(baseline(await integration(), invalid)).rejects.toMatchObject({ code: "23514" });
  });
  it("refuses rollback for managed-payment audit evidence before touching schema", async () => {
    await client.query(
      "insert into admin_audit_event(action,target_kind,target_id,detail) values('integration.activated','integration',$1,'{}')",
      [await integration()],
    );
    await rollbackRefused();
    expect(
      (await client.query("select to_regclass('integration_merchant_baseline') name")).rows[0]
        ?.name,
    ).toBe("integration_merchant_baseline");
  });
});

describe("managed payment migration guarded rollback cycle", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  beforeAll(async () => {
    await ensureMigrated([], { reset: true });
  });
  afterAll(async () => {
    await migrate(drizzle(pool), { migrationsFolder: folder });
    await pool.end();
  });
  it("runs up/down/up/down with exact bookkeeping", async () => {
    const down = await readFile(downPath, "utf8");
    const journal = JSON.parse(await readFile(`${folder}/meta/_journal.json`, "utf8")) as {
      entries: { tag: string; when: number }[];
    };
    const when = journal.entries.find(
      (entry) => entry.tag === "0023_managed_payment_credentials",
    )?.when;
    expect(when).toBeTypeOf("number");
    for (let pass = 0; pass < 2; pass += 1) {
      await pool.query(
        await readFile(`${folder}/0025_integration_baseline_rewrap.down.sql`, "utf8"),
      );
      await pool.query(
        await readFile(`${folder}/0024_managed_shipping_credentials.down.sql`, "utf8"),
      );
      await pool.query(down);
      expect(
        (await pool.query("select to_regclass('integration_merchant_baseline') name")).rows[0]
          ?.name,
      ).toBeNull();
      expect(
        (await pool.query("select 1 from drizzle.__drizzle_migrations where created_at=$1", [when]))
          .rows,
      ).toEqual([]);
      expect(
        (
          await pool.query(
            "select 1 from information_schema.columns where table_name='payment' and column_name='integration_credential_version_id'",
          )
        ).rows,
      ).toEqual([]);
      await migrate(drizzle(pool), { migrationsFolder: folder });
      expect(
        (await pool.query("select to_regclass('integration_merchant_baseline') name")).rows[0]
          ?.name,
      ).toBe("integration_merchant_baseline");
    }
  });
});
