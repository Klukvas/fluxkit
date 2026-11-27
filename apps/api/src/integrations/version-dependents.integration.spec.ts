import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../database/schema/index.js";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import { IntegrationsRepository } from "./integrations.repository.js";
const OLDEST = new Date("2024-01-01T00:00:00Z");
const LATER = new Date("2025-01-01T00:00:00Z");

describe("version retention review counts (real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  const queries: string[] = [];
  const repository = new IntegrationsRepository(
    drizzle(pool, {
      schema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    }),
  );
  beforeEach(() => ensureMigrated([], { reset: true }));
  afterAll(async () => {
    await ensureMigrated([], { reset: true });
    await pool.end();
  });
  async function version(kind: string, generation = 1, owner?: string) {
    const integrationId = owner ?? randomUUID(),
      id = randomUUID();
    if (!owner)
      await pool.query("insert into integration(id,kind,provider_code) values($1,$2,'fixture')", [
        integrationId,
        kind,
      ]);
    await pool.query(
      "insert into integration_credential_version(id,integration_id,purpose,generation,state,revoked_at) values($1,$2,'outbound',$3,'revoked',now())",
      [id, integrationId, generation],
    );
    return { id, integrationId };
  }
  async function order() {
    const id = randomUUID();
    await pool.query(
      "insert into sales_order(id,number,status,locale,currency,subtotal_amount,shipping_total,discount_total,tax_total,total_amount,contact_erased_at,idempotency_key,request_fingerprint,expires_at) values($1,$2,'paid','uk','UAH',100,0,0,0,100,now(),gen_random_uuid(),repeat('a',64),now()+interval '1 hour')",
      [id, `${id.slice(0, 4).toUpperCase()}-${id.slice(4, 8).toUpperCase()}`],
    );
    return id;
  }
  async function payment(version: string | null, status: string, createdAt = LATER) {
    const id = randomUUID();
    await pool.query(
      "insert into payment(id,order_id,provider_code,provider_payment_id,amount,currency,status,expires_at,created_by,integration_credential_version_id,idempotency_key,created_at,redirect_url,next_check_at) values($1::uuid,$2,'fixture',$1::text,100,'UAH',$3,now()+interval '1 hour','guest',$4,gen_random_uuid(),$5,$6,now())",
      [
        id,
        await order(),
        status,
        version,
        createdAt,
        status === "awaiting_customer" ? "https://example.com/pay" : null,
      ],
    );
    return id;
  }
  it("groups all listed IDs in four queries; counts exact status sets/refunds once and excludes null/other-version bindings", async () => {
    const pay = await version("payment"),
      ship = await version("shipping"),
      email = await version("email");
    const unused = await version("payment", 2, pay.integrationId);
    for (const status of [
      "creating",
      "awaiting_customer",
      "processing",
      "create_unknown",
      "failed",
      "expired",
      "invalidated",
      "succeeded",
    ])
      await payment(pay.id, status, status === "creating" ? OLDEST : LATER);
    for (const status of ["requested", "processing", "unknown", "succeeded", "failed"]) {
      const paymentId = await payment(pay.id, "succeeded");
      // Two refunds must not multiply payment totals.
      for (let n = 0; n < 2; n++)
        await pool.query(
          "insert into payment_refund(id,payment_id,amount,currency,status,reason,idempotency_key,payment_amount) values($1,$2,10,'UAH',$3,'admin',gen_random_uuid(),100)",
          [randomUUID(), paymentId, status],
        );
    }
    await payment(null, "creating", new Date("2020-01-01"));
    for (const status of [
      "pending",
      "unknown",
      "created",
      "in_transit",
      "arrived",
      "returning",
      "delivered",
      "returned",
      "cancelled",
      "failed",
    ]) {
      await pool.query(
        "insert into shipment(id,order_id,provider_code,status,client_reference,declared_value_amount,currency,payer,weight_grams,length_mm,width_mm,height_mm,seats,integration_credential_version_id,created_at,provider_ref,tracking_number) values($1::uuid,$2,'fixture',$3,'ABCD-EF01',100,'UAH','sender',1,1,1,1,1,$4,$5,$1::text,$1::text)",
        [randomUUID(), await order(), status, ship.id, status === "pending" ? OLDEST : LATER],
      );
    }
    for (const status of ["pending", "sending", "sent", "failed", "unknown", "cancelled"])
      await pool.query(
        "insert into email_message(template_key,template_version,locale,to_address,recipient_kind,variables,deadline_at,integration_credential_version_id,status,lease_until,provider_code,provider_message_id,sent_at,attempts,last_error_code) values('test.message',1,'uk','fixture@example.com','admin','{}',now()+interval '1 hour',$1,$2,$3,$4,$5,$6,1,'fixture')",
        [
          email.id,
          status,
          status === "sending" ? new Date(Date.now() + 60000) : null,
          status === "sent" ? "fixture" : null,
          status === "sent" ? "message" : null,
          status === "sent" ? new Date() : null,
        ],
      );
    queries.length = 0;
    const rows = await repository.versionHistory([
      pay.integrationId,
      ship.integrationId,
      email.integrationId,
    ]);
    expect(rows.find((r) => r.id === pay.id)?.dependents).toEqual({
      payments: { open: 10, total: 13, oldestOpenAt: OLDEST.toISOString() },
    });
    expect(rows.find((r) => r.id === ship.id)?.dependents).toEqual({
      shipments: { open: 6, total: 10, oldestOpenAt: OLDEST.toISOString() },
    });
    expect(rows.find((r) => r.id === email.id)?.dependents).toEqual({
      emails: { pending: 2, total: 6 },
    });
    expect(rows.find((r) => r.id === unused.id)?.dependents).toEqual({
      payments: { open: 0, total: 0, oldestOpenAt: null },
    });
    expect(queries).toHaveLength(4);
    expect(JSON.stringify(rows)).not.toContain("fixture@example.com");
  });
  it("terminal-only dependencies have a null oldestOpenAt; empty input runs no query", async () => {
    const pay = await version("payment");
    await payment(pay.id, "succeeded");
    expect((await repository.versionHistory([pay.integrationId]))[0]?.dependents).toEqual({
      payments: { open: 0, total: 1, oldestOpenAt: null },
    });
    queries.length = 0;
    expect(await repository.versionHistory([])).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
