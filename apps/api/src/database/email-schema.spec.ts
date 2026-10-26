import { createHash, randomUUID } from "node:crypto";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_EMAIL_DEADLINE_MINUTES,
  AUTH_TOKEN_LIFETIME_MINUTES,
  AUTH_TOKEN_PURPOSES,
  EMAIL_CODE_PATTERN,
  EMAIL_DEADLINE_HOURS,
  EMAIL_LIMITS,
  EMAIL_LOCALE_PATTERN,
  EMAIL_MAX_LENGTH,
  EMAIL_MESSAGE_STATUSES,
  EMAIL_PROVIDER_CODE_PATTERN,
  EMAIL_RECIPIENT_KINDS,
  EMAIL_RETENTION_DAYS,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_KEY_MAX_LENGTH,
  EMAIL_TEMPLATE_KEY_PATTERN,
  authTokenExpiresAt,
  buildEmailDedupeKey,
  emailDeadlineAt,
  emailRetentionDays,
  isEmailTemplateKey,
  isFinalEmailStatus,
  validateEmailAddress,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import * as emailSchema from "./schema/email.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;

const sorted = (values: readonly string[]) => [...values].sort();
const MINUTE_MS = 60_000;
/** Every row of a test is created at this instant, so deadlines and expiries are exact. */
const CREATED_AT = new Date("2026-10-26T10:00:00.000Z");
const at = (offsetMs: number) => new Date(CREATED_AT.getTime() + offsetMs).toISOString();
/** A whole number of minutes as Postgres prints an interval in a constraint (`'48:00:00'`). */
const asInterval = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00`;

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

describe("email schema (migration 0007, real Postgres)", () => {
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

  async function count(table: string, where = "true"): Promise<number> {
    const result = await client.query(
      `select count(*)::int as count from "${table}" where ${where}`,
    );
    return must(result.rows[0] as { count: number } | undefined, "count row").count;
  }

  async function selectWhere(table: string, where: string): Promise<Record<string, unknown>> {
    const result = await client.query(`select * from "${table}" where ${where}`);
    return must(result.rows[0] as Record<string, unknown> | undefined, `${table} row ${where}`);
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

  /** A statement that must succeed even though it is a boundary value. */
  async function expectAccepted(run: () => Promise<unknown>): Promise<void> {
    await client.query("savepoint expected_accept");
    try {
      await run();
    } finally {
      await client.query("rollback to savepoint expected_accept");
    }
  }

  /** Every value of `accept` is stored, every value of `reject` violates `constraint`. */
  async function expectBoundaries(
    make: (value: Value) => Promise<unknown>,
    constraint: string,
    accept: Value[],
    reject: Value[],
  ): Promise<void> {
    for (const value of accept) await expectAccepted(() => make(value));
    for (const value of reject) {
      await expectViolation(() => make(value), CHECK_VIOLATION, constraint);
    }
  }

  /** Whether the statement is stored (true) or refused by exactly `constraint` (false); anything else fails the test. */
  async function storedOrRefusedBy(
    run: () => Promise<unknown>,
    constraint: string,
  ): Promise<boolean> {
    await client.query("savepoint stored_or_refused");
    try {
      await run();
      return true;
    } catch (error) {
      if (
        error instanceof pg.DatabaseError &&
        error.code === CHECK_VIOLATION &&
        error.constraint === constraint
      ) {
        return false;
      }
      throw error;
    } finally {
      await client.query("rollback to savepoint stored_or_refused");
    }
  }

  async function constraintDefinition(table: string, constraint: string): Promise<string> {
    const result = await client.query(
      `select pg_get_constraintdef(oid) as definition from pg_constraint
       where conrelid = $1::regclass and conname = $2`,
      [`public.${table}`, constraint],
    );
    return must(
      (result.rows[0] as { definition: string } | undefined)?.definition,
      `${constraint} definition`,
    );
  }

  /** The string literals of a CHECK, sorted: to compare a database list with the list in packages/core. */
  async function constraintLiterals(table: string, constraint: string): Promise<string[]> {
    const definition = await constraintDefinition(table, constraint);
    return [...definition.matchAll(/'([^']+)'/g)].map((match) => must(match[1], "literal")).sort();
  }

  async function indexDefinition(name: string): Promise<string> {
    const result = await client.query(
      `select indexdef from pg_indexes where schemaname = 'public' and indexname = $1`,
      [name],
    );
    return must((result.rows[0] as { indexdef: string } | undefined)?.indexdef, `index ${name}`);
  }

  const indexLiterals = (definition: string) =>
    [...definition.matchAll(/'([^']+)'/g)].map((match) => must(match[1], "literal")).sort();

  let sequence = 0;

  async function createAdmin(): Promise<string> {
    sequence += 1;
    return insertId("admin_user", {
      email: `email-schema-admin-${sequence}@example.com`,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  async function createCustomer(): Promise<{ id: string; email: string }> {
    sequence += 1;
    const email = `email-schema-${sequence}@example.com`;
    const id = await insertId("customer", {
      email,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      first_name: "Ann",
      last_name: "Buyer",
    });
    return { id, email };
  }

  async function createOrder(): Promise<string> {
    sequence += 1;
    const digits = String(sequence).padStart(8, "0");
    return insertId("sales_order", {
      number: `${digits.slice(0, 4)}-${digits.slice(4)}`,
      status: "awaiting_payment",
      email: "buyer@example.com",
      phone: "+380501234567",
      first_name: "Ann",
      last_name: "Buyer",
      locale: "uk",
      currency: "UAH",
      subtotal_amount: 2000,
      shipping_total: 0,
      discount_total: 0,
      tax_total: 0,
      total_amount: 2000,
      idempotency_key: randomUUID(),
      request_fingerprint: "a".repeat(64),
      expires_at: "2099-01-01T00:00:00Z",
    });
  }

  /** A guest order mail as an event handler would enqueue it (deadline: created + 12 hours). */
  const messageRow = (extra: Row = {}): Row => ({
    template_key: "order.placed",
    template_version: 1,
    locale: "uk",
    to_address: "buyer@example.com",
    recipient_kind: "guest",
    variables: JSON.stringify({ number: "0000-0001" }),
    created_at: CREATED_AT.toISOString(),
    deadline_at: emailDeadlineAt({ createdAt: CREATED_AT }).toISOString(),
    ...extra,
  });
  const createMessage = (extra: Row = {}) => insertId("email_message", messageRow(extra));

  /** A row in a status with every column that status needs. */
  const inStatus = (status: string, extra: Row = {}): Row => {
    const needs: Record<string, Row> = {
      pending: {},
      sending: { attempts: 1, lease_until: at(2 * MINUTE_MS), provider_code: "resend" },
      sent: {
        attempts: 1,
        provider_code: "resend",
        provider_message_id: randomUUID(),
        sent_at: at(MINUTE_MS),
      },
      failed: { attempts: 1, last_error_code: "rejected" },
      unknown: { attempts: 2, last_error_code: "idempotency_conflict" },
      cancelled: {},
    };
    return { status, ...must(needs[status], `status ${status}`), ...extra };
  };

  const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

  const tokenRow = (customerId: string, email: string, extra: Row = {}): Row => ({
    customer_id: customerId,
    purpose: "password_reset",
    token_hash: sha256Hex(randomUUID()),
    email,
    created_at: CREATED_AT.toISOString(),
    expires_at: authTokenExpiresAt("password_reset", CREATED_AT).toISOString(),
    ...extra,
  });

  describe("lists, patterns and limits equal packages/core", () => {
    it("has the statuses, recipient kinds and token purposes of core", async () => {
      expect(await constraintLiterals("email_message", "email_message_status_check")).toEqual(
        sorted(EMAIL_MESSAGE_STATUSES),
      );
      expect(
        await constraintLiterals("email_message", "email_message_recipient_kind_check"),
      ).toEqual(sorted(EMAIL_RECIPIENT_KINDS));
      expect(
        await constraintLiterals("customer_auth_token", "customer_auth_token_purpose_check"),
      ).toEqual(sorted(AUTH_TOKEN_PURPOSES));
    });

    it("uses the template key, locale and code patterns of core", async () => {
      const quoted = (pattern: RegExp) => `'${pattern.source}'`;
      expect(
        await constraintDefinition("email_message", "email_message_template_key_check"),
      ).toContain(quoted(EMAIL_TEMPLATE_KEY_PATTERN));
      expect(await constraintDefinition("email_message", "email_message_locale_check")).toContain(
        quoted(EMAIL_LOCALE_PATTERN),
      );
      expect(
        await constraintDefinition("email_message", "email_message_provider_code_check"),
      ).toContain(quoted(EMAIL_PROVIDER_CODE_PATTERN));
      for (const constraint of [
        "email_message_provider_message_id_check",
        "email_message_last_error_code_check",
      ]) {
        expect(await constraintDefinition("email_message", constraint), constraint).toContain(
          quoted(EMAIL_CODE_PATTERN),
        );
      }
    });

    it("takes every built-in template key and refuses a key that core refuses, up to the core length", async () => {
      const candidates = [
        ...EMAIL_TEMPLATE_KEYS,
        "a.b",
        `a.${"b".repeat(EMAIL_TEMPLATE_KEY_MAX_LENGTH - 2)}`,
        `a.${"b".repeat(EMAIL_TEMPLATE_KEY_MAX_LENGTH - 1)}`,
        "order",
        "Order.placed",
        "order.",
        ".order",
        "order..placed",
        "order.placed-x",
        "1order.placed",
        "order.1placed",
        "",
      ];
      for (const key of candidates) {
        const stored = await storedOrRefusedBy(
          () => createMessage({ template_key: key }),
          "email_message_template_key_check",
        );
        expect(stored, key).toBe(isEmailTemplateKey(key));
      }
    });

    it("stores exactly the recipient addresses that core validates, in the normalized form", async () => {
      const local64 = "l".repeat(EMAIL_LIMITS.localPartMaxLength);
      const label63 = "d".repeat(EMAIL_LIMITS.domainLabelMaxLength);
      const longDomain = (total: number) => {
        // `x@` + labels of 63 joined by dots + a tail, to reach exactly `total` characters.
        let domain = "";
        while (2 + domain.length + 1 + 63 < total - 3) domain += `${label63}.`;
        return `x@${domain}${"e".repeat(total - 2 - domain.length - 3)}.ua`;
      };
      const candidates = [
        "a@b.co",
        "buyer@example.com",
        "first.last+tag@sub.example.com.ua",
        "o'brien@example.com",
        "a!#$%&*+/=?^_`{|}~-@example.com",
        "a@xn--bcher-kva.example",
        "a@1example.com",
        `${local64}@example.com`,
        `${local64}l@example.com`,
        `a@${label63}.com`,
        `a@${label63}d.com`,
        longDomain(EMAIL_MAX_LENGTH),
        longDomain(EMAIL_MAX_LENGTH + 1),
        "A@b.co",
        "a@B.co",
        " a@b.co",
        "a@b.co ",
        "a b@c.de",
        "a,b@c.de",
        "<a>@c.de",
        "a<b@c.de",
        '"a"@c.de',
        "a(b)@c.de",
        "a;b@c.de",
        "a\\b@c.de",
        "a@b.co\r\nBcc: x@y.z",
        "a@b.co\n",
        "a\t@b.co",
        "a\u0085@b.co",
        "a @b.co",
        "ä@c.de",
        "a@bücher.de",
        "a..b@c.de",
        ".a@c.de",
        "a.@c.de",
        "a@@c.de",
        "a@c..de",
        "a@c.de.",
        "a@.c.de",
        "a@-c.de",
        "a@c-.de",
        "a@c_d.de",
        "a@localhost",
        "a@b.123",
        "a@127.0.0.1",
        "@c.de",
        "a@",
        "",
      ];
      for (const address of candidates) {
        const core = validateEmailAddress(address);
        const expected = core.ok && core.address === address;
        const stored = await storedOrRefusedBy(
          () => createMessage({ to_address: address }),
          "email_message_to_address_check",
        );
        expect(stored, JSON.stringify(address)).toBe(expected);
      }
    });

    it("stores the dedupe key core builds, tied to the row's template key", async () => {
      const eventId = randomUUID();
      await expectBoundaries(
        (dedupeKey) => createMessage({ dedupe_key: dedupeKey }),
        "email_message_dedupe_key_check",
        [null, buildEmailDedupeKey(eventId, "order.placed")],
        [
          buildEmailDedupeKey(eventId, "order.paid"),
          `${eventId.toUpperCase()}:order.placed`,
          `${eventId}order.placed`,
          `${eventId}:`,
          "order.placed",
          `x${eventId}:order.placed`,
          "",
        ],
      );
    });

    it("caps the variables at the core byte limit, measured by pg_column_size", async () => {
      const sizeOf = async (json: string) =>
        must(
          (
            (await client.query("select pg_column_size($1::jsonb)::int as size", [json]))
              .rows[0] as { size: number } | undefined
          )?.size,
          "size",
        );
      const padded = (length: number) => JSON.stringify({ p: "x".repeat(length) });
      const base = await sizeOf(padded(100));
      const atLimit = padded(100 + EMAIL_LIMITS.variablesMaxBytes - base);
      expect(await sizeOf(atLimit)).toBe(EMAIL_LIMITS.variablesMaxBytes);
      const overLimit = padded(101 + EMAIL_LIMITS.variablesMaxBytes - base);
      expect(await sizeOf(overLimit)).toBe(EMAIL_LIMITS.variablesMaxBytes + 1);
      await expectBoundaries(
        (variables) => createMessage({ variables }),
        "email_message_variables_check",
        ["{}", JSON.stringify({ tokenId: randomUUID() }), atLimit],
        // A highly compressible value is measured before compression, so it is refused as well.
        [overLimit, padded(4 * EMAIL_LIMITS.variablesMaxBytes), "[]", '"x"', "1", "null"],
      );
      await expectViolation(
        () => createMessage({ variables: null }),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });

    it("bounds the deadline by the core deadline: after creation, at most 12 hours later", async () => {
      expect(await constraintDefinition("email_message", "email_message_deadline_check")).toContain(
        `'${asInterval(EMAIL_DEADLINE_HOURS * 60)}'::interval`,
      );
      const authDeadline = emailDeadlineAt({
        createdAt: CREATED_AT,
        authTokenExpiresAt: authTokenExpiresAt("email_verification", CREATED_AT),
      });
      expect(authDeadline.getTime() - CREATED_AT.getTime()).toBe(
        AUTH_EMAIL_DEADLINE_MINUTES * MINUTE_MS,
      );
      await expectBoundaries(
        (deadlineAt) => createMessage({ deadline_at: deadlineAt }),
        "email_message_deadline_check",
        [
          emailDeadlineAt({ createdAt: CREATED_AT }).toISOString(),
          authDeadline.toISOString(),
          at(1),
        ],
        [
          at(0),
          at(-1),
          at(EMAIL_DEADLINE_HOURS * 60 * MINUTE_MS + 1),
          at(2 * EMAIL_DEADLINE_HOURS * 60 * MINUTE_MS),
        ],
      );
      await expectViolation(
        () => createMessage({ deadline_at: null }),
        NOT_NULL_VIOLATION,
        undefined,
      );
    });

    it("bounds a token's expiry by the core lifetime of its purpose", async () => {
      const definition = await constraintDefinition(
        "customer_auth_token",
        "customer_auth_token_expires_at_check",
      );
      for (const purpose of AUTH_TOKEN_PURPOSES) {
        expect(definition, purpose).toContain(
          `(purpose <> '${purpose}'::text) OR (expires_at <= (created_at + '${asInterval(AUTH_TOKEN_LIFETIME_MINUTES[purpose])}'::interval))`,
        );
      }
      const { id, email } = await createCustomer();
      for (const purpose of AUTH_TOKEN_PURPOSES) {
        const lifetimeMs = AUTH_TOKEN_LIFETIME_MINUTES[purpose] * MINUTE_MS;
        await expectBoundaries(
          (expiresAt) =>
            insert("customer_auth_token", tokenRow(id, email, { purpose, expires_at: expiresAt })),
          "customer_auth_token_expires_at_check",
          [authTokenExpiresAt(purpose, CREATED_AT).toISOString(), at(1)],
          [at(0), at(-MINUTE_MS), at(lifetimeMs + 1), at(lifetimeMs + 24 * 60 * MINUTE_MS)],
        );
      }
      // The verification lifetime is not a reset lifetime: the bound follows the purpose.
      await expectViolation(
        () =>
          insert(
            "customer_auth_token",
            tokenRow(id, email, {
              purpose: "password_reset",
              expires_at: authTokenExpiresAt("email_verification", CREATED_AT).toISOString(),
            }),
          ),
        CHECK_VIOLATION,
        "customer_auth_token_expires_at_check",
      );
    });

    it("has the claim index over the open statuses and the retention index over the final ones", async () => {
      const claim = await indexDefinition("email_message_next_attempt_at_idx");
      expect(claim).toContain("(next_attempt_at)");
      expect(indexLiterals(claim)).toEqual(
        sorted(EMAIL_MESSAGE_STATUSES.filter((status) => !isFinalEmailStatus(status))),
      );

      const retention = await indexDefinition("email_message_status_updated_at_idx");
      expect(retention).toContain("(status, updated_at)");
      const purged = EMAIL_MESSAGE_STATUSES.filter((status) => emailRetentionDays(status) !== null);
      expect(sorted(purged)).toEqual(sorted(Object.keys(EMAIL_RETENTION_DAYS)));
      expect(indexLiterals(retention)).toEqual(sorted(purged));
    });
  });

  describe("email_message", () => {
    it("accepts a pending mail and applies the defaults", async () => {
      const created = await insert("email_message", messageRow());
      expect(created).toMatchObject({
        status: "pending",
        attempts: 0,
        customer_id: null,
        order_id: null,
        admin_user_id: null,
        dedupe_key: null,
        lease_until: null,
        provider_code: null,
        provider_message_id: null,
        last_error_code: null,
        resend_of: null,
        created_by_admin_id: null,
        sent_at: null,
      });
      expect(created.variables).toEqual({ number: "0000-0001" });
      expect(created.next_attempt_at).toBeInstanceOf(Date);
      expect(created.updated_at).toBeInstanceOf(Date);
      // next_attempt_at defaults to now(): a new mail is due at once.
      const due = await client.query(
        "select next_attempt_at = now() as due from email_message where id = $1",
        [created.id],
      );
      expect(due.rows[0]).toEqual({ due: true });
    });

    it("needs a whole template version of at least 1 and a locale of the core pattern", async () => {
      await expectBoundaries(
        (version) => createMessage({ template_version: version }),
        "email_message_template_version_check",
        [1, 2_147_483_647],
        [0, -1],
      );
      await expectBoundaries(
        (locale) => createMessage({ locale }),
        "email_message_locale_check",
        ["uk", "en", "pt-br"],
        ["UK", "u", "en_US", "en-", ""],
      );
      for (const locale of ["uk", "pt-br", "UK", "en_US"]) {
        const stored = await storedOrRefusedBy(
          () => createMessage({ locale }),
          "email_message_locale_check",
        );
        expect(stored, locale).toBe(EMAIL_LOCALE_PATTERN.test(locale));
      }
    });

    it("accepts every status of core with the columns it needs and refuses others", async () => {
      for (const status of EMAIL_MESSAGE_STATUSES) {
        await expectAccepted(() => createMessage(inStatus(status)));
      }
      for (const status of ["queued", "", "Pending", "delivered"]) {
        await expectViolation(
          () => createMessage({ status }),
          CHECK_VIOLATION,
          "email_message_status_check",
        );
      }
    });

    it("needs a lease while sending (a NULL lease is refused)", async () => {
      await expectViolation(
        () => createMessage(inStatus("sending", { lease_until: null })),
        CHECK_VIOLATION,
        "email_message_lease_check",
      );
      // A lease left on a row that went back to pending is harmless (the claim reads it only for sending rows).
      await expectAccepted(() => createMessage({ lease_until: at(MINUTE_MS) }));
    });

    it("has sent_at and a provider message id exactly when sent, and a provider code when sent", async () => {
      for (const missing of ["sent_at", "provider_message_id", "provider_code"]) {
        await expectViolation(
          () => createMessage(inStatus("sent", { [missing]: null })),
          CHECK_VIOLATION,
          "email_message_sent_check",
        );
      }
      for (const status of ["pending", "sending", "failed", "unknown", "cancelled"]) {
        await expectViolation(
          () => createMessage(inStatus(status, { sent_at: at(MINUTE_MS) })),
          CHECK_VIOLATION,
          "email_message_sent_check",
        );
        await expectViolation(
          () => createMessage(inStatus(status, { provider_message_id: randomUUID() })),
          CHECK_VIOLATION,
          "email_message_sent_check",
        );
      }
    });

    it("has an error code when failed or unknown (a NULL code is refused)", async () => {
      for (const status of ["failed", "unknown"]) {
        await expectViolation(
          () => createMessage(inStatus(status, { last_error_code: null })),
          CHECK_VIOLATION,
          "email_message_last_error_check",
        );
      }
      // A pending row keeps the code of its last failed attempt.
      await expectAccepted(() => createMessage({ attempts: 1, last_error_code: "unavailable" }));
    });

    it("counts attempts from 0; a sending, sent or unknown mail has made at least one", async () => {
      await expectBoundaries(
        (attempts) => createMessage({ attempts }),
        "email_message_attempts_check",
        [0, 1, 1000],
        [-1],
      );
      for (const status of ["sending", "sent", "unknown"]) {
        await expectViolation(
          () => createMessage(inStatus(status, { attempts: 0 })),
          CHECK_VIOLATION,
          "email_message_attempts_check",
        );
      }
      // A mail failed before any attempt (deadline passed while pending) or cancelled has none.
      await expectAccepted(() => createMessage(inStatus("failed", { attempts: 0 })));
      await expectAccepted(() => createMessage(inStatus("cancelled", { attempts: 0 })));
    });

    it("keeps provider codes, provider message ids and error codes to codes (no message text)", async () => {
      await expectBoundaries(
        (code) => createMessage(inStatus("sending", { provider_code: code })),
        "email_message_provider_code_check",
        [null, "resend", "fake", `a${"b".repeat(63)}`],
        ["", "Resend", "re-send", "1resend", `a${"b".repeat(64)}`],
      );
      await expectBoundaries(
        (id) => createMessage(inStatus("sent", { provider_message_id: id })),
        "email_message_provider_message_id_check",
        [randomUUID(), "msg_1.2:3-x", "x".repeat(64)],
        ["", "x".repeat(65), "has space", "a/b", "Лист"],
      );
      await expectBoundaries(
        (code) => createMessage(inStatus("failed", { last_error_code: code })),
        "email_message_last_error_code_check",
        ["deadline_passed", "validation_error", "http:429", "x".repeat(64)],
        ["", "x".repeat(65), "Invalid `to` field: a@b.c", "bad\ncode"],
      );
    });

    it("keeps the dedupe key unique; mails without one (auth, resends) are not limited", async () => {
      const dedupeKey = buildEmailDedupeKey(randomUUID(), "order.placed");
      await createMessage({ dedupe_key: dedupeKey });
      await expectViolation(
        () => createMessage({ dedupe_key: dedupeKey }),
        UNIQUE_VIOLATION,
        "email_message_dedupe_key_key",
      );
      // ON CONFLICT DO NOTHING on the dedupe key: a redelivered event inserts no second row.
      const columns = messageRow({ dedupe_key: dedupeKey });
      const names = Object.keys(columns);
      const again = await client.query(
        `insert into email_message (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")})
         on conflict (dedupe_key) do nothing returning id`,
        Object.values(columns),
      );
      expect(again.rowCount).toBe(0);
      await createMessage();
      await createMessage();
      expect(await count("email_message", "dedupe_key is null")).toBe(2);
    });

    it("links a recipient kind only to the records it may have", async () => {
      const customer = await createCustomer();
      const orderId = await createOrder();
      const adminId = await createAdmin();
      const allowed: Row[] = [
        { recipient_kind: "customer", customer_id: customer.id, order_id: orderId },
        { recipient_kind: "customer", customer_id: customer.id },
        { recipient_kind: "customer" },
        { recipient_kind: "guest", order_id: orderId },
        { recipient_kind: "guest" },
        { recipient_kind: "admin", admin_user_id: adminId },
        { recipient_kind: "admin" },
      ];
      for (const row of allowed) {
        await expectAccepted(() => createMessage(row));
      }
      const refused: Row[] = [
        { recipient_kind: "guest", customer_id: customer.id },
        { recipient_kind: "admin", customer_id: customer.id },
        { recipient_kind: "admin", order_id: orderId },
        { recipient_kind: "customer", admin_user_id: adminId },
        { recipient_kind: "guest", admin_user_id: adminId },
      ];
      for (const row of refused) {
        await expectViolation(
          () => createMessage(row),
          CHECK_VIOLATION,
          "email_message_recipient_check",
        );
      }
      await expectViolation(
        () => createMessage({ recipient_kind: "staff" }),
        CHECK_VIOLATION,
        "email_message_recipient_kind_check",
      );
    });

    it("keeps the mail and nulls the link when the customer, the order or the admin user is deleted", async () => {
      const customer = await createCustomer();
      const orderId = await createOrder();
      const forCustomer = await createMessage({
        recipient_kind: "customer",
        customer_id: customer.id,
        order_id: orderId,
      });
      const adminId = await createAdmin();
      const forAdmin = await createMessage({
        recipient_kind: "admin",
        admin_user_id: adminId,
        created_by_admin_id: adminId,
      });
      const before = await selectWhere("email_message", `id = '${forCustomer}'`);
      await client.query('delete from "customer" where id = $1', [customer.id]);
      expect(await selectWhere("email_message", `id = '${forCustomer}'`)).toEqual({
        ...before,
        customer_id: null,
      });
      await client.query('delete from "sales_order" where id = $1', [orderId]);
      expect(await selectWhere("email_message", `id = '${forCustomer}'`)).toMatchObject({
        customer_id: null,
        order_id: null,
      });
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      expect(await selectWhere("email_message", `id = '${forAdmin}'`)).toMatchObject({
        admin_user_id: null,
        created_by_admin_id: null,
      });
    });

    it("rejects unknown linked records", async () => {
      for (const [column, constraint] of [
        ["customer_id", "email_message_customer_id_fkey"],
        ["order_id", "email_message_order_id_fkey"],
        ["admin_user_id", "email_message_admin_user_id_fkey"],
        ["created_by_admin_id", "email_message_created_by_admin_id_fkey"],
        ["resend_of", "email_message_resend_of_fkey"],
      ] as const) {
        const kind = column === "admin_user_id" ? "admin" : "customer";
        await expectViolation(
          () => createMessage({ recipient_kind: kind, [column]: randomUUID() }),
          FOREIGN_KEY_VIOLATION,
          constraint,
        );
      }
    });

    it("links a resend to its original, never to itself, and keeps it when the original is purged", async () => {
      const original = await createMessage(inStatus("unknown"));
      const adminId = await createAdmin();
      const resend = await createMessage({ resend_of: original, created_by_admin_id: adminId });
      const selfId = randomUUID();
      await expectViolation(
        () => createMessage({ id: selfId, resend_of: selfId }),
        CHECK_VIOLATION,
        "email_message_resend_of_check",
      );
      await client.query('delete from "email_message" where id = $1', [original]);
      expect(await selectWhere("email_message", `id = '${resend}'`)).toMatchObject({
        resend_of: null,
        created_by_admin_id: adminId,
      });
    });

    it("lets the claim statement use the partial index", async () => {
      await createMessage();
      await client.query("set local enable_seqscan = off");
      const plan = await client.query(
        `explain select id from email_message
         where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and lease_until < now())
         for update skip locked limit 20`,
      );
      const text = plan.rows.map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"]).join("\n");
      expect(text).toContain("email_message_next_attempt_at_idx");
    });
  });

  describe("customer_auth_token", () => {
    it("accepts a token and applies the defaults", async () => {
      const { id, email } = await createCustomer();
      const created = await insert("customer_auth_token", tokenRow(id, email));
      expect(created).toMatchObject({ customer_id: id, email, used_at: null });
      expect(created.created_at).toEqual(CREATED_AT);
    });

    it("stores only a SHA-256 hex hash, unique", async () => {
      const { id, email } = await createCustomer();
      const hash = sha256Hex("token");
      await expectBoundaries(
        (tokenHash) =>
          insert(
            "customer_auth_token",
            tokenRow(id, email, { token_hash: tokenHash, used_at: at(1) }),
          ),
        "customer_auth_token_token_hash_check",
        [hash, "0".repeat(64)],
        [hash.toUpperCase(), hash.slice(1), `${hash}0`, "x".repeat(43), ""],
      );
      await insert(
        "customer_auth_token",
        tokenRow(id, email, { token_hash: hash, used_at: at(1) }),
      );
      const other = await createCustomer();
      await expectViolation(
        () => insert("customer_auth_token", tokenRow(other.id, other.email, { token_hash: hash })),
        UNIQUE_VIOLATION,
        "customer_auth_token_token_hash_key",
      );
    });

    it("accepts the purposes of core only", async () => {
      const { id, email } = await createCustomer();
      await expectBoundaries(
        (purpose) =>
          insert(
            "customer_auth_token",
            tokenRow(id, email, {
              purpose,
              expires_at: at(MINUTE_MS),
            }),
          ),
        "customer_auth_token_purpose_check",
        [...AUTH_TOKEN_PURPOSES],
        ["login", "", "Password_reset"],
      );
    });

    it("stores the address normalized", async () => {
      const { id } = await createCustomer();
      await expectBoundaries(
        (email) => insert("customer_auth_token", tokenRow(id, email as string)),
        "customer_auth_token_email_check",
        ["a@b.co", "x".repeat(EMAIL_MAX_LENGTH)],
        ["A@b.co", " a@b.co", "ab", "x".repeat(EMAIL_MAX_LENGTH + 1)],
      );
    });

    it("keeps one unused token per customer and purpose; a used one does not count", async () => {
      const { id, email } = await createCustomer();
      const first = await insertId("customer_auth_token", tokenRow(id, email));
      await expectViolation(
        () => insert("customer_auth_token", tokenRow(id, email)),
        UNIQUE_VIOLATION,
        "customer_auth_token_customer_id_purpose_unused_key",
      );
      await expectAccepted(() =>
        insert(
          "customer_auth_token",
          tokenRow(id, email, {
            purpose: "email_verification",
            expires_at: authTokenExpiresAt("email_verification", CREATED_AT).toISOString(),
          }),
        ),
      );
      const other = await createCustomer();
      await expectAccepted(() => insert("customer_auth_token", tokenRow(other.id, other.email)));
      // A newer token invalidates the older one first (used_at), then the new one is stored.
      await client.query("update customer_auth_token set used_at = $2 where id = $1", [
        first,
        at(MINUTE_MS),
      ]);
      await insert("customer_auth_token", tokenRow(id, email));
      expect(await count("customer_auth_token", `customer_id = '${id}'`)).toBe(2);
    });

    it("is deleted with its customer and rejects an unknown customer", async () => {
      const { id, email } = await createCustomer();
      await insert("customer_auth_token", tokenRow(id, email));
      await client.query('delete from "customer" where id = $1', [id]);
      expect(await count("customer_auth_token", `customer_id = '${id}'`)).toBe(0);
      await expectViolation(
        () => insert("customer_auth_token", tokenRow(randomUUID(), "a@b.co")),
        FOREIGN_KEY_VIOLATION,
        "customer_auth_token_customer_id_fkey",
      );
    });
  });

  describe("triggers and indexes", () => {
    const tables = ["email_message", "customer_auth_token"];

    it("has no triggers on the email tables (rows change through the outbox and token rules)", async () => {
      const result = await client.query(
        `select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relname = any($1)`,
        [tables],
      );
      expect(result.rows).toEqual([]);
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
        [tables],
      );
      expect(result.rows).toEqual([]);
    });

    it("has the list, address and per-customer token indexes", async () => {
      expect(await indexDefinition("email_message_created_at_idx")).toContain("(created_at)");
      expect(await indexDefinition("email_message_to_address_idx")).toContain("(to_address)");
      expect(
        await indexDefinition("customer_auth_token_customer_id_purpose_created_at_idx"),
      ).toContain("(customer_id, purpose, created_at)");
      const unused = await indexDefinition("customer_auth_token_customer_id_purpose_unused_key");
      expect(unused).toContain("CREATE UNIQUE INDEX");
      expect(unused).toContain("(customer_id, purpose) WHERE (used_at IS NULL)");
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const all: PgTable[] = [emailSchema.emailMessage, emailSchema.customerAuthToken];
      for (const table of all) {
        const config = getTableConfig(table);
        const names = [
          config.name,
          ...config.checks.map((item) => item.name),
          ...config.indexes.map((item) => item.config.name ?? ""),
          ...config.uniqueConstraints.map((item) => item.name ?? ""),
          ...config.foreignKeys.map((item) => item.getName()),
          ...config.primaryKeys.map((item) => item.getName() ?? ""),
        ];
        for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
      }
    });
  });
});
