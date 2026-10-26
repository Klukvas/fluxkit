import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestCustomer, deleteTestCustomers } from "../test/customer-fixtures.js";
import { EmailWorld, TEST_RECIPIENT } from "../test/email-world.js";
import { JobsRunner } from "./jobs-runner.js";
import {
  AUTH_TOKEN_RETENTION_DAYS,
  PURGEABLE_EMAIL_STATUSES,
  purgeEmailMessages,
} from "./purge-email-messages.job.js";

const DAY = 24 * 60 * 60 * 1000;

describe("purge-email-messages (job 10; real Postgres, injected time)", () => {
  let world: EmailWorld;
  const customers: string[] = [];

  beforeAll(async () => {
    world = await EmailWorld.start();
  });

  beforeEach(async () => {
    await world.clear();
    await world.pool.query("delete from customer_auth_token");
  });

  afterAll(async () => {
    await world.pool.query("delete from customer_auth_token");
    await deleteTestCustomers(world.database, customers);
    await world.stop();
  });

  const now = () => world.clock.now();
  const run = (limits = { batchSize: 500, maxBatches: 100 }) =>
    purgeEmailMessages({ database: world.database, outbox: world.repository }, now(), limits);

  /** A row in `status` whose last change was `ageMs` before now (the columns its status needs). */
  async function row(status: string, ageMs: number): Promise<string> {
    const changed = new Date(now().getTime() - ageMs);
    const created = new Date(changed.getTime() - 60_000);
    const result = await world.pool.query<{ id: string }>(
      `insert into email_message (template_key, template_version, locale, to_address, recipient_kind, variables,
         status, attempts, lease_until, deadline_at, provider_code, provider_message_id, last_error_code,
         created_at, sent_at, updated_at, next_attempt_at)
       values ('admin.test', 1, 'en', $1, 'admin', '{"providerCode":"fake"}', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $9)
       returning id`,
      [
        TEST_RECIPIENT,
        status,
        status === "pending" || status === "cancelled" || status === "failed" ? 0 : 1,
        status === "sending" ? new Date(changed.getTime() + 120_000) : null,
        new Date(created.getTime() + 12 * 60 * 60 * 1000),
        status === "sent" ? "fake" : null,
        status === "sent" ? "test-id" : null,
        status === "failed" || status === "unknown" ? "rejected" : null,
        created,
        status === "sent" ? changed : null,
        changed,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error("Test setup: no row");
    }
    return id;
  }

  async function exists(id: string): Promise<boolean> {
    const result = await world.pool.query("select 1 from email_message where id = $1", [id]);
    return result.rows.length === 1;
  }

  it("deletes final mails strictly older than 30 days (failed and unknown 90), keeps the boundary and younger", async () => {
    const cases: [string, number, boolean][] = [
      ["sent", 30 * DAY + 1, true],
      ["sent", 30 * DAY, false],
      ["cancelled", 30 * DAY + 1, true],
      ["cancelled", 29 * DAY, false],
      ["failed", 31 * DAY, false],
      ["failed", 90 * DAY, false],
      ["failed", 90 * DAY + 1, true],
      ["unknown", 89 * DAY, false],
      ["unknown", 90 * DAY + 1, true],
    ];
    const ids = await Promise.all(cases.map(([status, age]) => row(status, age)));
    const result = await run();
    expect(result).toEqual({ deleted: 4, tokensDeleted: 0, truncated: false });
    for (const [index, [status, age, deleted]] of cases.entries()) {
      expect({ status, age, gone: !(await exists(ids[index] ?? "")) }).toEqual({
        status,
        age,
        gone: deleted,
      });
    }
  });

  it("never deletes a pending or sending mail, however old", async () => {
    const pending = await row("pending", 400 * DAY);
    const sending = await row("sending", 400 * DAY);
    expect((await run()).deleted).toBe(0);
    expect(await exists(pending)).toBe(true);
    expect(await exists(sending)).toBe(true);
    expect(PURGEABLE_EMAIL_STATUSES).toEqual(["sent", "failed", "unknown", "cancelled"]);
  });

  it("works in bounded batches and reports truncated when rows may be left", async () => {
    for (let index = 0; index < 5; index += 1) {
      await row("sent", 40 * DAY + index);
    }
    expect(await run({ batchSize: 2, maxBatches: 2 })).toEqual({
      deleted: 4,
      tokensDeleted: 0,
      truncated: true,
    });
    expect((await run({ batchSize: 2, maxBatches: 2 })).deleted).toBe(1);
  });

  it("deletes customer auth tokens that expired more than the retention window ago, and no others", async () => {
    const customer = await createTestCustomer(world.database);
    customers.push(customer.id);
    const token = async (purpose: string, expiredAgoMs: number, used: boolean) => {
      const expires = new Date(now().getTime() - expiredAgoMs);
      const created = new Date(expires.getTime() - 30 * 60_000);
      const result = await world.pool.query<{ id: string }>(
        `insert into customer_auth_token (customer_id, purpose, token_hash, email, created_at, expires_at, used_at)
         values ($1, $2, encode(sha256(gen_random_uuid()::text::bytea), 'hex'), $3, $4, $5, $6) returning id`,
        [customer.id, purpose, customer.email, created, expires, used ? created : null],
      );
      return result.rows[0]?.id ?? "";
    };
    const old = await token("password_reset", AUTH_TOKEN_RETENTION_DAYS * DAY + 1, true);
    const boundary = await token("password_reset", AUTH_TOKEN_RETENTION_DAYS * DAY, true);
    const unused = await token("email_verification", -60_000, false);
    expect((await run()).tokensDeleted).toBe(1);
    const left = await world.pool.query<{ id: string }>("select id from customer_auth_token");
    expect(left.rows.map((entry) => entry.id).sort()).toEqual([boundary, unused].sort());
    expect(left.rows.map((entry) => entry.id)).not.toContain(old);
  });

  it("is job 10 of the tick", async () => {
    const id = await row("sent", 31 * DAY);
    const reports = await world.get(JobsRunner).runAll(now());
    expect(reports.map((report) => report.name).slice(-2)).toEqual([
      "send-emails",
      "purge-email-messages",
    ]);
    expect(reports.at(-1)).toMatchObject({ ok: true, result: { deleted: 1 } });
    expect(await exists(id)).toBe(false);
  });
});
