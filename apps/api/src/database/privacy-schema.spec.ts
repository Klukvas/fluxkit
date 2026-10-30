import { randomUUID } from "node:crypto";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_DETAIL_MAX_BYTES,
  ADMIN_AUDIT_TARGET_KINDS,
  AUDIT_EVENT_RETENTION_DAYS,
  PRIVACY_REQUEST_CHANNELS,
  PRIVACY_REQUEST_KINDS,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_SUBJECT_KINDS,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import * as ordersSchema from "./schema/orders.js";
import * as privacySchema from "./schema/privacy.js";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
const NOT_NULL_VIOLATION = "23502";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

const FUTURE = "2099-01-01T00:00:00Z";
const sorted = (values: readonly string[]) => [...values].sort();

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("privacy schema (migration 0009, real Postgres)", () => {
  const pool = new pg.Pool({ connectionString: requireTestDatabaseUrl() });
  // Every test runs in its own transaction that is rolled back, so tests never see each other's rows.
  let client: pg.PoolClient;

  beforeAll(async () => {
    await ensureMigrated();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    try {
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  async function insert(table: string, row: Row): Promise<Record<string, unknown>> {
    const columns = Object.keys(row);
    const result = await client.query(
      `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) ` +
        `values (${columns.map((_, index) => `$${index + 1}`).join(", ")}) returning *`,
      Object.values(row),
    );
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row`);
  }

  async function insertId(table: string, row: Row): Promise<string> {
    const created = await insert(table, row);
    if (typeof created.id !== "string") throw new Error(`Test setup bug: ${table} has no id`);
    return created.id;
  }

  async function selectById(table: string, id: string): Promise<Record<string, unknown>> {
    const result = await client.query(`select * from "${table}" where id = $1`, [id]);
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} ${id}`);
  }

  async function count(table: string, where = "true"): Promise<number> {
    const result = await client.query(
      `select count(*)::int as count from "${table}" where ${where}`,
    );
    return must(result.rows[0] as { count: number } | undefined, "count row").count;
  }

  /** Runs one statement that must fail; asserts SQLSTATE and constraint name, then undoes the failed statement. */
  async function expectViolation(
    run: () => Promise<unknown>,
    code: string,
    constraint: string | undefined,
  ): Promise<void> {
    await client.query("savepoint expected_violation");
    const error = await run().then(
      () => undefined,
      (reason: unknown) => reason,
    );
    await client.query("rollback to savepoint expected_violation");
    expect(
      error,
      `expected "${constraint ?? code}" to be violated, but the statement succeeded`,
    ).toBeInstanceOf(pg.DatabaseError);
    if (!(error instanceof pg.DatabaseError)) throw new Error("unreachable");
    expect({ code: error.code, constraint: error.constraint }).toEqual({ code, constraint });
  }

  async function expectAccepted(run: () => Promise<unknown>): Promise<void> {
    await client.query("savepoint expected_accept");
    try {
      await run();
    } finally {
      await client.query("rollback to savepoint expected_accept");
    }
  }

  async function constraintLiterals(table: string, constraint: string): Promise<string[]> {
    const result = await client.query(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`public.${table}`, constraint],
    );
    const definition = must(
      (result.rows[0] as { definition: string } | undefined)?.definition,
      `${constraint} definition`,
    );
    return [...definition.matchAll(/'([^']+)'/g)].map((match) => must(match[1], "literal")).sort();
  }

  let probeSequence = 0;
  /** Runs `statement` from a trigger body, so the trigger under test sees `pg_trigger_depth()` of 2 (as a foreign key action). */
  async function runAtDepthTwo(statement: string): Promise<void> {
    probeSequence += 1;
    await client.query(
      `create function pg_temp.privacy_tamper_${probeSequence}() returns trigger language plpgsql as $$
       begin
         ${statement};
         return new;
       end;
       $$`,
    );
    await client.query(`create temp table privacy_probe_${probeSequence} (id int)`);
    await client.query(
      `create trigger privacy_probe_${probeSequence}_insert after insert on privacy_probe_${probeSequence}
         for each row execute function pg_temp.privacy_tamper_${probeSequence}()`,
    );
    await client.query(`insert into privacy_probe_${probeSequence} (id) values (1)`);
  }

  let sequence = 0;

  async function createAdmin(): Promise<string> {
    sequence += 1;
    return insertId("admin_user", {
      email: `privacy-schema-${sequence}@example.com`,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  function nextOrderNumber(): string {
    sequence += 1;
    const digits = String(sequence).padStart(8, "0");
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  const orderRow = (extra: Row = {}): Row => ({
    number: nextOrderNumber(),
    status: "fulfilled",
    email: "buyer@example.com",
    phone: "+380501234567",
    first_name: "Ann",
    last_name: "Buyer",
    locale: "uk",
    currency: "UAH",
    subtotal_amount: 2000,
    shipping_total: 500,
    discount_total: 0,
    tax_total: 0,
    total_amount: 2500,
    idempotency_key: randomUUID(),
    request_fingerprint: "a".repeat(64),
    expires_at: FUTURE,
    fulfilled_at: "2026-10-01T00:00:00Z",
    ...extra,
  });

  /** The values an anonymisation writes (core planOrderAnonymisation), as SQL assignments. */
  const ERASED: Row = {
    email: null,
    phone: null,
    first_name: null,
    last_name: null,
    access_token_hash: null,
    access_expires_at: null,
    contact_erased_at: "2026-10-29T10:00:00Z",
  };

  describe("sales_order: erased contact (ADR 0033 decision 5)", () => {
    it("adds contact_erased_at, NULL for every existing kind of order", async () => {
      const id = await insertId("sales_order", orderRow());
      expect(await selectById("sales_order", id)).toMatchObject({ contact_erased_at: null });
    });

    it("stores an erased order: all four contact columns NULL and contact_erased_at set", async () => {
      const id = await insertId(
        "sales_order",
        orderRow({ ...ERASED, shipping_address: '{"countryCode":"UA"}' }),
      );
      expect(await selectById("sales_order", id)).toMatchObject({
        email: null,
        phone: null,
        first_name: null,
        last_name: null,
      });
    });

    it("anonymises a live order with an UPDATE (sales_order is not immutable)", async () => {
      const id = await insertId("sales_order", orderRow());
      await client.query(
        `update "sales_order" set email = null, phone = null, first_name = null, last_name = null,
           contact_erased_at = now() where id = $1`,
        [id],
      );
      expect(await selectById("sales_order", id)).toMatchObject({ email: null, phone: null });
    });

    it("refuses a NULL contact column on an order that is not erased, column by column", async () => {
      for (const column of ["email", "phone", "first_name", "last_name"]) {
        await expectViolation(
          () => insert("sales_order", orderRow({ [column]: null })),
          CHECK_VIOLATION,
          "sales_order_contact_check",
        );
      }
    });

    it("refuses an erased order that still holds any contact column, column by column", async () => {
      const values: Row = {
        email: "buyer@example.com",
        phone: "+380501234567",
        first_name: "Ann",
        last_name: "Buyer",
      };
      for (const [column, value] of Object.entries(values)) {
        await expectViolation(
          () => insert("sales_order", orderRow({ ...ERASED, [column]: value })),
          CHECK_VIOLATION,
          "sales_order_contact_check",
        );
      }
    });

    it("refuses an erased order that keeps its guest access", async () => {
      await expectViolation(
        () =>
          insert(
            "sales_order",
            orderRow({
              ...ERASED,
              access_token_hash: "b".repeat(64),
              access_expires_at: FUTURE,
            }),
          ),
        CHECK_VIOLATION,
        "sales_order_erased_access_check",
      );
      const id = await insertId(
        "sales_order",
        orderRow({ access_token_hash: "c".repeat(64), access_expires_at: FUTURE }),
      );
      await expectViolation(
        () =>
          client.query(
            `update "sales_order" set email = null, phone = null, first_name = null, last_name = null,
               contact_erased_at = now() where id = $1`,
            [id],
          ),
        CHECK_VIOLATION,
        "sales_order_erased_access_check",
      );
    });

    it("keeps the format CHECKs for non-NULL contact values", async () => {
      await expectViolation(
        () => insert("sales_order", orderRow({ email: "Buyer@Example.com" })),
        CHECK_VIOLATION,
        "sales_order_email_check",
      );
      await expectViolation(
        () => insert("sales_order", orderRow({ phone: "12" })),
        CHECK_VIOLATION,
        "sales_order_phone_check",
      );
      await expectViolation(
        () => insert("sales_order", orderRow({ first_name: "" })),
        CHECK_VIOLATION,
        "sales_order_first_name_check",
      );
      await expectViolation(
        () => insert("sales_order", orderRow({ last_name: "x".repeat(101) })),
        CHECK_VIOLATION,
        "sales_order_last_name_check",
      );
    });
  });

  describe("lists and limits equal packages/core", () => {
    it("privacy_request kinds, subject kinds, channels and statuses", async () => {
      expect(await constraintLiterals("privacy_request", "privacy_request_kind_check")).toEqual(
        sorted(PRIVACY_REQUEST_KINDS),
      );
      expect(
        await constraintLiterals("privacy_request", "privacy_request_subject_kind_check"),
      ).toEqual(sorted(PRIVACY_REQUEST_SUBJECT_KINDS));
      expect(await constraintLiterals("privacy_request", "privacy_request_channel_check")).toEqual(
        sorted(PRIVACY_REQUEST_CHANNELS),
      );
      expect(await constraintLiterals("privacy_request", "privacy_request_status_check")).toEqual(
        sorted(PRIVACY_REQUEST_STATUSES),
      );
    });

    it("audit target kinds", async () => {
      expect(
        await constraintLiterals("admin_audit_event", "admin_audit_event_target_kind_check"),
      ).toEqual(sorted(ADMIN_AUDIT_TARGET_KINDS));
    });

    it("accepts every core audit action and the detail size limit of core", async () => {
      expect(privacySchema.ADMIN_AUDIT_DETAIL_MAX_BYTES).toBe(ADMIN_AUDIT_DETAIL_MAX_BYTES);
      expect(privacySchema.AUDIT_EVENT_RETENTION_DAYS).toBe(AUDIT_EVENT_RETENTION_DAYS);
      for (const action of ADMIN_AUDIT_ACTIONS) {
        await expectAccepted(() => insert("admin_audit_event", auditRow({ action })));
      }
    });
  });

  const requestRow = (extra: Row = {}): Row => ({
    kind: "export",
    subject_kind: "email",
    subject_email_hash: "d".repeat(64),
    channel: "admin",
    status: "received",
    received_at: "2026-10-29T10:00:00Z",
    due_at: "2026-11-28T10:00:00Z",
    ...extra,
  });

  describe("privacy_request", () => {
    it("stores an admin request by email and a self-service erasure of a customer", async () => {
      const adminId = await createAdmin();
      const byEmail = await insert(
        "privacy_request",
        requestRow({ handled_by: adminId, note: "Identity checked by a reply." }),
      );
      expect(byEmail).toMatchObject({
        kind: "export",
        status: "received",
        completed_at: null,
        result: null,
        subject_customer_id: null,
      });
      const customerId = randomUUID();
      await insert(
        "privacy_request",
        requestRow({
          kind: "erasure",
          subject_kind: "customer",
          subject_customer_id: customerId,
          subject_email_hash: null,
          channel: "self_service",
          status: "completed",
          completed_at: "2026-10-29T10:00:01Z",
          result: '{"ordersAnonymised":2,"mailDeleted":3,"orderNumbers":["0000-0001"]}',
        }),
      );
      // No foreign key: the customer was deleted by the request itself.
      expect(await count("customer", `id = '${customerId}'`)).toBe(0);
    });

    it("refuses an unknown kind, subject kind, channel or status", async () => {
      for (const [column, constraint] of [
        ["kind", "privacy_request_kind_check"],
        ["subject_kind", "privacy_request_subject_kind_check"],
        ["channel", "privacy_request_channel_check"],
        ["status", "privacy_request_status_check"],
      ] as const) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ [column]: "access" })),
          CHECK_VIOLATION,
          constraint,
        );
      }
    });

    it("needs the customer id for a customer subject", async () => {
      await expectViolation(
        () => insert("privacy_request", requestRow({ subject_kind: "customer" })),
        CHECK_VIOLATION,
        "privacy_request_subject_customer_check",
      );
    });

    it("needs the email hash for an open email subject, and lets a closed one drop it", async () => {
      await expectViolation(
        () => insert("privacy_request", requestRow({ subject_email_hash: null })),
        CHECK_VIOLATION,
        "privacy_request_subject_email_check",
      );
      await expectAccepted(() =>
        insert(
          "privacy_request",
          requestRow({
            subject_email_hash: null,
            status: "rejected",
            completed_at: "2026-10-30T00:00:00Z",
          }),
        ),
      );
    });

    it("stores the email only as a SHA-256 hex HMAC", async () => {
      for (const value of ["buyer@example.com", "D".repeat(64), "d".repeat(63)]) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ subject_email_hash: value })),
          CHECK_VIOLATION,
          "privacy_request_subject_email_hash_check",
        );
      }
    });

    it("lets self-service only for the signed-in customer, without an admin", async () => {
      const adminId = await createAdmin();
      await expectViolation(
        () => insert("privacy_request", requestRow({ channel: "self_service" })),
        CHECK_VIOLATION,
        "privacy_request_self_service_check",
      );
      await expectViolation(
        () =>
          insert(
            "privacy_request",
            requestRow({
              channel: "self_service",
              subject_kind: "customer",
              subject_customer_id: randomUUID(),
              handled_by: adminId,
            }),
          ),
        CHECK_VIOLATION,
        "privacy_request_self_service_check",
      );
    });

    it("has completed_at exactly when the request is closed, not before it was received", async () => {
      for (const status of ["completed", "rejected"]) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ status })),
          CHECK_VIOLATION,
          "privacy_request_completed_at_check",
        );
      }
      for (const status of ["received", "in_progress"]) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ status, completed_at: FUTURE })),
          CHECK_VIOLATION,
          "privacy_request_completed_at_check",
        );
      }
      await expectViolation(
        () =>
          insert(
            "privacy_request",
            requestRow({ status: "completed", completed_at: "2026-10-29T09:59:59Z" }),
          ),
        CHECK_VIOLATION,
        "privacy_request_completed_after_received_check",
      );
    });

    it("has a due date after the received time", async () => {
      await expectViolation(
        () => insert("privacy_request", requestRow({ due_at: "2026-10-29T10:00:00Z" })),
        CHECK_VIOLATION,
        "privacy_request_due_at_check",
      );
    });

    it("keeps the note within 1 to 500 characters and the result a JSON object", async () => {
      await expectAccepted(() => insert("privacy_request", requestRow({ note: "x".repeat(500) })));
      for (const note of ["", "x".repeat(501)]) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ note })),
          CHECK_VIOLATION,
          "privacy_request_note_check",
        );
      }
      for (const result of ["[]", '"x"', "1"]) {
        await expectViolation(
          () => insert("privacy_request", requestRow({ result })),
          CHECK_VIOLATION,
          "privacy_request_result_check",
        );
      }
    });

    it("sets handled_by to NULL when the admin user is deleted", async () => {
      const adminId = await createAdmin();
      const id = await insertId("privacy_request", requestRow({ handled_by: adminId }));
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      expect(await selectById("privacy_request", id)).toMatchObject({ handled_by: null });
      await expectViolation(
        () => insert("privacy_request", requestRow({ handled_by: randomUUID() })),
        FOREIGN_KEY_VIOLATION,
        "privacy_request_handled_by_fkey",
      );
    });

    it("can be updated (a request has a lifecycle) and deleted (job 12 purges it)", async () => {
      const id = await insertId("privacy_request", requestRow());
      await client.query(
        `update "privacy_request" set status = 'completed', completed_at = received_at + interval '1 day'
         where id = $1`,
        [id],
      );
      await client.query('delete from "privacy_request" where id = $1', [id]);
      expect(await count("privacy_request", `id = '${id}'`)).toBe(0);
    });
  });

  function auditRow(extra: Row = {}): Row {
    return {
      action: "privacy.lookup",
      target_kind: "privacy_request",
      target_id: randomUUID(),
      ...extra,
    };
  }

  describe("admin_audit_event", () => {
    it("stores an event with the defaults: clock time and an empty detail", async () => {
      const adminId = await createAdmin();
      const row = await insert("admin_audit_event", auditRow({ admin_user_id: adminId }));
      expect(row).toMatchObject({ admin_user_id: adminId, detail: {} });
      expect(row.created_at).toBeInstanceOf(Date);
    });

    it("refuses an action that is not a code, an unknown target kind, a missing target", async () => {
      for (const action of ["Privacy.lookup", "privacy", "privacy lookup", "a@b.c", ""]) {
        await expectViolation(
          () => insert("admin_audit_event", auditRow({ action })),
          CHECK_VIOLATION,
          "admin_audit_event_action_check",
        );
      }
      await expectViolation(
        () => insert("admin_audit_event", auditRow({ target_kind: "email" })),
        CHECK_VIOLATION,
        "admin_audit_event_target_kind_check",
      );
      await expectViolation(
        () => insert("admin_audit_event", auditRow({ target_id: null })),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });

    it("keeps the detail a JSON object of at most 2 KiB in its stored text form", async () => {
      // jsonb prints `{"c": "..."}` (a space after the colon): 9 bytes around the value. That form is never shorter than
      // the JSON.stringify form core measures, so every row the database accepts also passes the core rule.
      const fits = JSON.stringify({ c: "x".repeat(ADMIN_AUDIT_DETAIL_MAX_BYTES - 9) });
      const stored = await client.query("select octet_length($1::jsonb::text) as length", [fits]);
      expect(stored.rows[0]).toEqual({ length: ADMIN_AUDIT_DETAIL_MAX_BYTES });
      await expectAccepted(() => insert("admin_audit_event", auditRow({ detail: fits })));
      const tooBig = JSON.stringify({ c: "x".repeat(ADMIN_AUDIT_DETAIL_MAX_BYTES - 8) });
      await expectViolation(
        () => insert("admin_audit_event", auditRow({ detail: tooBig })),
        CHECK_VIOLATION,
        "admin_audit_event_detail_check",
      );
      for (const detail of ["[]", '"x"', "null"]) {
        await expectViolation(
          () => insert("admin_audit_event", auditRow({ detail })),
          CHECK_VIOLATION,
          "admin_audit_event_detail_check",
        );
      }
    });

    describe("append-only trigger", () => {
      it("rejects a direct UPDATE of any column, also nulling the admin", async () => {
        const adminId = await createAdmin();
        const id = await insertId("admin_audit_event", auditRow({ admin_user_id: adminId }));
        const before = await selectById("admin_audit_event", id);
        for (const assignment of [
          "action = 'customer.unlocked'",
          "detail = '{}'",
          "target_id = gen_random_uuid()",
          "admin_user_id = NULL",
          "created_at = now() - interval '400 days'",
          "action = action",
        ]) {
          await expectViolation(
            () => client.query(`update "admin_audit_event" set ${assignment} where id = $1`, [id]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        expect(await selectById("admin_audit_event", id)).toEqual(before);
      });

      it("rejects a DELETE of a row inside the retention period, also at the boundary", async () => {
        const fresh = await insertId("admin_audit_event", auditRow());
        const boundary = await insertId(
          "admin_audit_event",
          auditRow({
            created_at: new Date(
              Date.now() - AUDIT_EVENT_RETENTION_DAYS * 86_400_000 + 60_000,
            ).toISOString(),
          }),
        );
        for (const id of [fresh, boundary]) {
          await expectViolation(
            () => client.query('delete from "admin_audit_event" where id = $1', [id]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await expectViolation(
          () => client.query('delete from "admin_audit_event"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => runAtDepthTwo(`delete from "admin_audit_event" where id = '${fresh}'`),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await count("admin_audit_event", `id in ('${fresh}', '${boundary}')`)).toBe(2);
      });

      it("allows the purge DELETE of a row older than the retention period", async () => {
        const old = await insertId(
          "admin_audit_event",
          auditRow({
            created_at: new Date(
              Date.now() - AUDIT_EVENT_RETENTION_DAYS * 86_400_000 - 60_000,
            ).toISOString(),
          }),
        );
        await client.query('delete from "admin_audit_event" where id = $1', [old]);
        expect(await count("admin_audit_event", `id = '${old}'`)).toBe(0);
      });

      it("allows the SET NULL of admin_user_id when the admin user is deleted, and nothing else changes", async () => {
        const adminId = await createAdmin();
        const id = await insertId("admin_audit_event", auditRow({ admin_user_id: adminId }));
        const before = await selectById("admin_audit_event", id);
        await client.query('delete from "admin_user" where id = $1', [adminId]);
        expect(await selectById("admin_audit_event", id)).toEqual({
          ...before,
          admin_user_id: null,
        });
      });

      it("rejects at depth 2 an UPDATE that changes more than nulling the admin, or sets an admin", async () => {
        const adminId = await createAdmin();
        const id = await insertId("admin_audit_event", auditRow({ admin_user_id: adminId }));
        for (const assignment of [
          "admin_user_id = NULL, action = 'customer.unlocked'",
          "admin_user_id = NULL, detail = '{\"n\":1}'",
          "action = 'customer.unlocked'",
        ]) {
          await expectViolation(
            () => runAtDepthTwo(`update "admin_audit_event" set ${assignment} where id = '${id}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        const other = await createAdmin();
        const orphan = await insertId("admin_audit_event", auditRow());
        await expectViolation(
          () =>
            runAtDepthTwo(
              `update "admin_audit_event" set admin_user_id = '${other}' where id = '${orphan}'`,
            ),
          RESTRICT_VIOLATION,
          undefined,
        );
      });
    });
  });

  describe("triggers and indexes", () => {
    it("has exactly the append-only trigger on the new tables", async () => {
      const result = await client.query<{ table: string; name: string; definition: string }>(
        `select c.relname as "table", t.tgname as name, pg_get_triggerdef(t.oid) as definition
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relname = any($1) order by c.relname, t.tgname`,
        [["privacy_request", "admin_audit_event", "sales_order"]],
      );
      expect(result.rows.map((row) => [row.table, row.name])).toEqual([
        ["admin_audit_event", "admin_audit_event_append_only"],
        // Migration 0011 (statement level, BEFORE TRUNCATE; migration-0011-schema.spec.ts).
        ["admin_audit_event", "admin_audit_event_no_truncate"],
      ]);
      expect(result.rows[0]?.definition).toContain("BEFORE DELETE OR UPDATE");
      expect(result.rows[0]?.definition).toContain("FOR EACH ROW");
    });

    it("covers every foreign key of the new tables with an index that starts with its columns", async () => {
      const result = await client.query(
        `select c.conrelid::regclass::text as table_name, c.conname, a.attname as column_name
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.conrelid::regclass::text = any($1)
           and not exists (
             select 1 from pg_index i
             where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1] and i.indpred is null
           )`,
        [["privacy_request", "admin_audit_event"]],
      );
      expect(result.rows).toEqual([]);
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const tables: PgTable[] = [
        privacySchema.privacyRequest,
        privacySchema.adminAuditEvent,
        ordersSchema.salesOrder,
      ];
      for (const table of tables) {
        const config = getTableConfig(table);
        const names = [
          config.name,
          ...config.checks.map((item) => item.name),
          ...config.indexes.map((item) => item.config.name ?? ""),
          ...config.uniqueConstraints.map((item) => item.name ?? ""),
          ...config.foreignKeys.map((item) => item.getName()),
        ];
        for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
      }
    });
  });
});
