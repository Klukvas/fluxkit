import { createHash, randomUUID } from "node:crypto";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENCY_CODES,
  LIVE_PAYMENT_STATUSES,
  MAX_AMOUNT,
  PAYMENT_ATTENTION_CODES,
  PAYMENT_CARD_LAST4_PATTERN,
  PAYMENT_CARD_SYSTEM_PATTERN,
  PAYMENT_CODE_PATTERN,
  PAYMENT_CREATED_BY,
  PAYMENT_EVENT_SOURCES,
  PAYMENT_LIMITS,
  PAYMENT_ORDER_OUTCOMES,
  PAYMENT_PROVIDER_CODE_PATTERN,
  PAYMENT_PROVIDER_STATUS_PATTERN,
  PAYMENT_STATUSES,
  PROVIDER_PAYMENT_ID_PATTERN,
  REFUND_REASONS,
  REFUND_STATUSES,
  TEXT_LIMITS,
  buildPollDedupeKey,
  buildWebhookDedupeKey,
  type PaymentStatus,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import { requireTestDatabaseUrl } from "../test/env.js";
import { ensureMigrated } from "../test/migrate.js";
import * as paymentsSchema from "./schema/payments.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";

type Value = string | number | boolean | null | Value[];
type Row = Record<string, Value>;

const sorted = (values: readonly string[]) => [...values].sort();
const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const FUTURE = "2099-01-01T00:00:00Z";
const LIVE: readonly PaymentStatus[] = LIVE_PAYMENT_STATUSES;
const FINAL = PAYMENT_STATUSES.filter((status) => !LIVE.includes(status));

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Test setup bug: ${what} is missing`);
  return value;
}

/** A well-formed provider fact, as core would accept it. */
function providerFact(overrides: Partial<ProviderPaymentFact> = {}): ProviderPaymentFact {
  return {
    providerPaymentId: "p2_9ZgpZVsl3",
    reference: randomUUID(),
    status: "succeeded",
    providerStatus: "success",
    amount: { amount: 2500, currency: "UAH" },
    finalAmount: { amount: 2500, currency: "UAH" },
    modifiedAt: new Date("2026-10-26T10:00:00.000Z"),
    failureCode: null,
    refunds: [],
    card: { system: "visa", last4: "4242" },
    ...overrides,
  };
}

describe("payments schema (migration 0008, real Postgres)", () => {
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

  let probeSequence = 0;
  /**
   * Runs `statement` from the body of a trigger on a temporary table, created inside the test transaction (its rollback
   * drops it): the trigger under test then sees `pg_trigger_depth()` of 2, like a foreign key action does (the technique
   * of cart-orders-schema.spec.ts).
   */
  async function runAtDepthTwo(statement: string): Promise<void> {
    probeSequence += 1;
    await client.query(
      `create function pg_temp.tamper_${probeSequence}() returns trigger language plpgsql as $$
       begin
         ${statement};
         return new;
       end;
       $$`,
    );
    await client.query(`create temp table tamper_probe_${probeSequence} (id int)`);
    await client.query(
      `create trigger tamper_probe_${probeSequence}_insert after insert on tamper_probe_${probeSequence}
         for each row execute function pg_temp.tamper_${probeSequence}()`,
    );
    await client.query(`insert into tamper_probe_${probeSequence} (id) values (1)`);
  }

  let sequence = 0;

  async function createAdmin(): Promise<string> {
    sequence += 1;
    return insertId("admin_user", {
      email: `payments-schema-${sequence}@example.com`,
      password_hash: "scrypt$16384$8$1$c2FsdA$aGFzaA",
      role: "owner",
    });
  }

  /** A valid order number per call (digits only, which the Crockford alphabet contains). */
  function nextOrderNumber(): string {
    sequence += 1;
    const digits = String(sequence).padStart(8, "0");
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  async function createOrder(): Promise<string> {
    return insertId("sales_order", {
      number: nextOrderNumber(),
      status: "awaiting_payment",
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
      access_token_hash: randomUUID().replaceAll("-", "").repeat(2),
      access_expires_at: FUTURE,
      idempotency_key: randomUUID(),
      request_fingerprint: "a".repeat(64),
      expires_at: FUTURE,
    });
  }

  /** A fresh `creating` attempt (the row written before the provider call). */
  const paymentRow = (orderId: string, extra: Row = {}): Row => ({
    order_id: orderId,
    provider_code: "fake",
    amount: 2500,
    currency: "UAH",
    status: "creating",
    expires_at: FUTURE,
    next_check_at: FUTURE,
    idempotency_key: randomUUID(),
    created_by: "guest",
    ...extra,
  });

  /** Columns a row of `status` needs to satisfy the consistency CHECKs (ADR 0032 decision 5). */
  function statusColumns(status: PaymentStatus): Row {
    sequence += 1;
    const invoice = `inv_${sequence}`;
    switch (status) {
      case "creating":
      case "create_unknown":
        return { status };
      case "awaiting_customer":
        return {
          status,
          provider_payment_id: invoice,
          redirect_url: `https://pay.example.com/${invoice}`,
        };
      case "processing":
        return { status, provider_payment_id: invoice };
      case "failed":
        return { status, next_check_at: null };
      default:
        return { status, provider_payment_id: invoice, next_check_at: null };
    }
  }

  async function createPayment(extra: Row = {}): Promise<{ id: string; orderId: string }> {
    const orderId = await createOrder();
    const id = await insertId("payment", paymentRow(orderId, extra));
    return { id, orderId };
  }

  const createSucceeded = (extra: Row = {}) =>
    createPayment({ ...statusColumns("succeeded"), ...extra });

  const eventRow = (paymentId: string, extra: Row = {}): Row => ({
    payment_id: paymentId,
    source: "system",
    applied: true,
    from_status: null,
    to_status: "creating",
    ...extra,
  });

  /** A journal row of a verified provider fact (normalized fields only). */
  const factEventRow = (paymentId: string, extra: Row = {}): Row => ({
    payment_id: paymentId,
    source: "webhook",
    dedupe_key: buildWebhookDedupeKey(sha256Hex(randomUUID())),
    provider_status: "success",
    provider_modified_at: "2026-10-26T10:00:00Z",
    amount: 2500,
    final_amount: 2500,
    currency: "UAH",
    applied: false,
    ...extra,
  });

  const refundRow = (paymentId: string, extra: Row = {}): Row => ({
    payment_id: paymentId,
    amount: 1000,
    currency: "UAH",
    payment_amount: 2500,
    reason: "admin",
    ...extra,
  });

  describe("lists, patterns and limits equal packages/core", () => {
    it("has the statuses, sources, reasons, outcomes, attention codes and creators of core", async () => {
      expect(await constraintLiterals("payment", "payment_status_check")).toEqual(
        sorted(PAYMENT_STATUSES),
      );
      expect(await constraintLiterals("payment", "payment_order_outcome_check")).toEqual(
        sorted(PAYMENT_ORDER_OUTCOMES),
      );
      expect(await constraintLiterals("payment", "payment_attention_code_check")).toEqual(
        sorted(PAYMENT_ATTENTION_CODES),
      );
      expect(await constraintLiterals("payment", "payment_created_by_check")).toEqual(
        sorted(PAYMENT_CREATED_BY),
      );
      expect(await constraintLiterals("payment_event", "payment_event_source_check")).toEqual(
        sorted(PAYMENT_EVENT_SOURCES),
      );
      expect(await constraintLiterals("payment_event", "payment_event_from_status_check")).toEqual(
        sorted(PAYMENT_STATUSES),
      );
      expect(await constraintLiterals("payment_event", "payment_event_to_status_check")).toEqual(
        sorted(PAYMENT_STATUSES),
      );
      expect(await constraintLiterals("payment_refund", "payment_refund_status_check")).toEqual(
        sorted(REFUND_STATUSES),
      );
      expect(await constraintLiterals("payment_refund", "payment_refund_reason_check")).toEqual(
        sorted(REFUND_REASONS),
      );
    });

    it("uses the provider code, provider id, provider status, code and card patterns of core", async () => {
      const quoted = (pattern: RegExp) => `'${pattern.source}'`;
      const expectations: [string, string, RegExp][] = [
        ["payment", "payment_provider_code_check", PAYMENT_PROVIDER_CODE_PATTERN],
        ["payment", "payment_provider_payment_id_check", PROVIDER_PAYMENT_ID_PATTERN],
        ["payment", "payment_provider_status_check", PAYMENT_PROVIDER_STATUS_PATTERN],
        ["payment", "payment_failure_code_check", PAYMENT_CODE_PATTERN],
        ["payment", "payment_card_system_check", PAYMENT_CARD_SYSTEM_PATTERN],
        ["payment", "payment_card_last4_check", PAYMENT_CARD_LAST4_PATTERN],
        ["payment_event", "payment_event_provider_status_check", PAYMENT_PROVIDER_STATUS_PATTERN],
        ["payment_event", "payment_event_failure_code_check", PAYMENT_CODE_PATTERN],
        ["payment_refund", "payment_refund_failure_code_check", PAYMENT_CODE_PATTERN],
      ];
      for (const [table, constraint, pattern] of expectations) {
        expect(await constraintDefinition(table, constraint), constraint).toContain(
          quoted(pattern),
        );
      }
    });

    it("has the one-live-attempt index over exactly the live statuses of core", async () => {
      const live = await indexDefinition("payment_order_id_live_key");
      expect(live).toContain("CREATE UNIQUE INDEX");
      expect(live).toContain("(order_id)");
      expect([...live.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()).toEqual(
        sorted(LIVE_PAYMENT_STATUSES),
      );
    });

    it("bounds amounts by MAX_AMOUNT, the page URL by TEXT_LIMITS.url and the note by the core note limit", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (amount) => insert("payment", paymentRow(orderId, { amount })),
        "payment_amount_check",
        [1, MAX_AMOUNT],
        [0, -1, MAX_AMOUNT + 1],
      );
      const prefix = "https://pay.example.com/";
      await expectBoundaries(
        (redirect_url) =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("awaiting_customer"), redirect_url }),
          ),
        "payment_redirect_url_check",
        [prefix + "x".repeat(TEXT_LIMITS.url - prefix.length)],
        [prefix + "x".repeat(TEXT_LIMITS.url - prefix.length + 1)],
      );
      const { id: paymentId } = await createSucceeded();
      await expectBoundaries(
        (note) => insert("payment_refund", refundRow(paymentId, { note })),
        "payment_refund_note_check",
        [
          null,
          "x".repeat(PAYMENT_LIMITS.refundNoteMinLength),
          "ї".repeat(PAYMENT_LIMITS.refundNoteMaxLength),
        ],
        ["", "x".repeat(PAYMENT_LIMITS.refundNoteMaxLength + 1)],
      );
    });

    it("stores every currency core supports and rejects other shapes", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (currency) => insert("payment", paymentRow(orderId, { currency })),
        "payment_currency_check",
        [...CURRENCY_CODES],
        ["uah", "UA", "UAHH", ""],
      );
    });

    it("stores the webhook and poll dedupe keys core builds", async () => {
      const { id: paymentId } = await createSucceeded();
      const webhookKey = buildWebhookDedupeKey(sha256Hex("raw body"));
      await insert("payment_event", factEventRow(paymentId, { dedupe_key: webhookKey }));
      for (const fact of [
        providerFact(),
        providerFact({ finalAmount: null, providerStatus: "processing", status: "processing" }),
        providerFact({ finalAmount: { amount: 0, currency: "UAH" }, providerStatus: "reversed" }),
        providerFact({
          amount: { amount: MAX_AMOUNT, currency: "UAH" },
          finalAmount: { amount: MAX_AMOUNT, currency: "UAH" },
          refunds: [
            {
              refundId: randomUUID(),
              status: "succeeded",
              amount: { amount: 1, currency: "UAH" },
              modifiedAt: new Date("2026-10-26T11:00:00.000Z"),
            },
          ],
        }),
      ]) {
        const key = buildPollDedupeKey(fact, sha256Hex);
        await insert(
          "payment_event",
          factEventRow(paymentId, {
            source: "poll",
            dedupe_key: key,
            provider_status: fact.providerStatus,
            amount: fact.amount.amount,
            final_amount: fact.finalAmount?.amount ?? null,
          }),
        );
      }
      expect(await count("payment_event", `payment_id = '${paymentId}'`)).toBe(5);
    });

    it("has the reconcile index on next_check_at and the claim statement uses it", async () => {
      const due = await indexDefinition("payment_next_check_at_idx");
      expect(due).toContain("(next_check_at)");
      expect(due).toContain("WHERE (next_check_at IS NOT NULL)");
      await createPayment();
      await client.query("set local enable_seqscan = off");
      const plan = await client.query(
        `explain select id from payment where next_check_at <= now()
         order by next_check_at for update skip locked limit 50`,
      );
      const text = plan.rows.map((row: { "QUERY PLAN": string }) => row["QUERY PLAN"]).join("\n");
      expect(text).toContain("payment_next_check_at_idx");
    });
  });

  describe("payment", () => {
    it("accepts a creating attempt and applies the defaults", async () => {
      const orderId = await createOrder();
      const created = await insert("payment", paymentRow(orderId));
      expect(created).toMatchObject({
        order_id: orderId,
        provider_payment_id: null,
        amount: "2500",
        refunded_amount: "0",
        final_amount: null,
        redirect_url: null,
        order_outcome: null,
        needs_attention: false,
        attention_code: null,
        failure_code: null,
        card_system: null,
        card_last4: null,
        check_attempts: 0,
        provider_status: null,
        provider_modified_at: null,
      });
    });

    it("accepts a row in every status with the columns that status needs", async () => {
      for (const status of PAYMENT_STATUSES) {
        const orderId = await createOrder();
        await insert("payment", paymentRow(orderId, statusColumns(status)));
      }
      const orderId = await createOrder();
      await expectViolation(
        () => insert("payment", paymentRow(orderId, { status: "paid" })),
        CHECK_VIOLATION,
        "payment_status_check",
      );
    });

    it("checks the provider code, provider id, provider status, failure code and card patterns", async () => {
      const orderId = await createOrder();
      const make = (extra: Row) => () => insert("payment", paymentRow(orderId, extra));
      await expectBoundaries(
        (provider_code) => make({ provider_code })(),
        "payment_provider_code_check",
        ["monobank", "fake", "a".repeat(64)],
        ["Monobank", "1bank", "a".repeat(65), ""],
      );
      await expectBoundaries(
        (provider_payment_id) => make({ provider_payment_id })(),
        "payment_provider_payment_id_check",
        [null, "p2_9ZgpZVsl3", "a".repeat(64)],
        ["", "a:b", "a b", "a".repeat(65)],
      );
      await expectBoundaries(
        (provider_status) =>
          make({
            provider_status,
            provider_modified_at: provider_status === null ? null : FUTURE,
          })(),
        "payment_provider_status_check",
        [null, "success", "a".repeat(32)],
        ["", "a:b", "a".repeat(33)],
      );
      await expectBoundaries(
        (failure_code) => make({ failure_code })(),
        "payment_failure_code_check",
        [null, "1077", "LIMIT_EXCEEDED", "a:b.c-d_e"],
        ["", "Card declined by bank", "a".repeat(65)],
      );
      await expectBoundaries(
        (card_system) => make({ card_system, card_last4: card_system === null ? null : "4242" })(),
        "payment_card_system_check",
        [null, "visa", "MASTERCARD"],
        ["4", "", "a".repeat(33)],
      );
      await expectBoundaries(
        (card_last4) => make({ card_last4, card_system: card_last4 === null ? null : "visa" })(),
        "payment_card_last4_check",
        [null, "0000", "4242"],
        ["424", "42424", "abcd", "537541******4242"],
      );
    });

    it("takes only https page URLs without spaces", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (redirect_url) =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("awaiting_customer"), redirect_url }),
          ),
        "payment_redirect_url_check",
        ["https://pay.mbnk.biz/p2_9ZgpZVsl3"],
        ["http://pay.mbnk.biz/x", "javascript:alert(1)", "https://", "https://a b", " https://a"],
      );
    });

    it("needs a provider id once the provider created or settled the invoice", async () => {
      for (const status of PAYMENT_STATUSES) {
        const orderId = await createOrder();
        const row = paymentRow(orderId, { ...statusColumns(status), provider_payment_id: null });
        if (["creating", "create_unknown", "failed"].includes(status)) {
          await expectAccepted(() => insert("payment", row));
        } else {
          await expectViolation(
            () => insert("payment", row),
            CHECK_VIOLATION,
            status === "awaiting_customer"
              ? "payment_awaiting_customer_check"
              : "payment_provider_payment_id_status_check",
          );
        }
      }
    });

    it("needs a page URL while awaiting the customer and keeps one only on a live attempt", async () => {
      const orderId = await createOrder();
      await expectViolation(
        () =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("awaiting_customer"), redirect_url: null }),
          ),
        CHECK_VIOLATION,
        "payment_awaiting_customer_check",
      );
      for (const status of PAYMENT_STATUSES) {
        const row = paymentRow(orderId, {
          ...statusColumns(status),
          redirect_url: "https://pay.example.com/x",
        });
        if (LIVE.includes(status)) {
          await expectAccepted(() => insert("payment", row));
        } else {
          await expectViolation(
            () => insert("payment", row),
            CHECK_VIOLATION,
            "payment_redirect_url_status_check",
          );
        }
      }
    });

    it("keeps refunded_amount within 0 and the amount, and above 0 only for a succeeded attempt", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (refunded_amount) =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("succeeded"), refunded_amount }),
          ),
        "payment_refunded_amount_check",
        [0, 1, 2500],
        [-1, 2501],
      );
      for (const status of PAYMENT_STATUSES.filter((value) => value !== "succeeded")) {
        await expectViolation(
          () =>
            insert(
              "payment",
              paymentRow(orderId, { ...statusColumns(status), refunded_amount: 1 }),
            ),
          CHECK_VIOLATION,
          "payment_refunded_amount_check",
        );
      }
    });

    it("keeps final_amount NULL or within 0 and the amount", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (final_amount) => insert("payment", paymentRow(orderId, { final_amount })),
        "payment_final_amount_check",
        [null, 0, 2500],
        [-1, 2501],
      );
    });

    it("stores the provider status and its time together or neither", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (provider_modified_at) =>
          insert(
            "payment",
            paymentRow(orderId, { provider_status: "success", provider_modified_at }),
          ),
        "payment_provider_fact_check",
        [FUTURE],
        [null],
      );
      await expectViolation(
        () =>
          insert(
            "payment",
            paymentRow(orderId, { provider_status: null, provider_modified_at: FUTURE }),
          ),
        CHECK_VIOLATION,
        "payment_provider_fact_check",
      );
    });

    it("stores markPaid's outcome only on a succeeded attempt", async () => {
      const orderId = await createOrder();
      for (const outcome of PAYMENT_ORDER_OUTCOMES) {
        await expectAccepted(() =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("succeeded"), order_outcome: outcome }),
          ),
        );
      }
      await expectViolation(
        () =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("succeeded"), order_outcome: "paid" }),
          ),
        CHECK_VIOLATION,
        "payment_order_outcome_check",
      );
      for (const status of PAYMENT_STATUSES.filter((value) => value !== "succeeded")) {
        await expectViolation(
          () =>
            insert(
              "payment",
              paymentRow(orderId, { ...statusColumns(status), order_outcome: "applied" }),
            ),
          CHECK_VIOLATION,
          "payment_order_outcome_status_check",
        );
      }
    });

    it("needs an attention code while the attempt needs attention; a cleared item may keep its code", async () => {
      const orderId = await createOrder();
      await expectViolation(
        () =>
          insert("payment", paymentRow(orderId, { needs_attention: true, attention_code: null })),
        CHECK_VIOLATION,
        "payment_needs_attention_check",
      );
      await expectAccepted(() =>
        insert(
          "payment",
          paymentRow(orderId, { needs_attention: true, attention_code: "late_payment" }),
        ),
      );
      await expectAccepted(() =>
        insert(
          "payment",
          paymentRow(orderId, { needs_attention: false, attention_code: "late_payment" }),
        ),
      );
      await expectViolation(
        () =>
          insert("payment", paymentRow(orderId, { needs_attention: true, attention_code: "oops" })),
        CHECK_VIOLATION,
        "payment_attention_code_check",
      );
    });

    it("stores the card system and last 4 digits together or neither", async () => {
      const orderId = await createOrder();
      await expectAccepted(() =>
        insert("payment", paymentRow(orderId, { card_system: "visa", card_last4: "4242" })),
      );
      for (const extra of [
        { card_system: "visa", card_last4: null },
        { card_system: null, card_last4: "4242" },
      ]) {
        await expectViolation(
          () => insert("payment", paymentRow(orderId, extra)),
          CHECK_VIOLATION,
          "payment_card_check",
        );
      }
    });

    it("schedules every live attempt for the reconcile job; a closed one may have no schedule", async () => {
      for (const status of PAYMENT_STATUSES) {
        const orderId = await createOrder();
        const row = paymentRow(orderId, { ...statusColumns(status), next_check_at: null });
        if (LIVE.includes(status)) {
          await expectViolation(
            () => insert("payment", row),
            CHECK_VIOLATION,
            "payment_next_check_at_check",
          );
        } else {
          await expectAccepted(() => insert("payment", row));
        }
      }
      const orderId = await createOrder();
      await expectAccepted(() =>
        insert(
          "payment",
          paymentRow(orderId, { ...statusColumns("succeeded"), next_check_at: FUTURE }),
        ),
      );
    });

    it("needs an invoice end after creation and non-negative check attempts", async () => {
      const orderId = await createOrder();
      await expectBoundaries(
        (expires_at) => insert("payment", paymentRow(orderId, { expires_at })),
        "payment_expires_at_check",
        [FUTURE],
        ["2000-01-01T00:00:00Z"],
      );
      await expectViolation(
        () =>
          client.query(
            `insert into payment (order_id, provider_code, amount, currency, status, expires_at, next_check_at,
               idempotency_key, created_by, created_at)
             values ($1, 'fake', 1, 'UAH', 'creating', $2, $2, gen_random_uuid(), 'guest', $2)`,
            [orderId, FUTURE],
          ),
        CHECK_VIOLATION,
        "payment_expires_at_check",
      );
      await expectBoundaries(
        (check_attempts) => insert("payment", paymentRow(orderId, { check_attempts })),
        "payment_check_attempts_check",
        [0, 53],
        [-1],
      );
    });

    it("needs the store route's Idempotency-Key for a shopper's attempt; unique per order", async () => {
      const orderId = await createOrder();
      for (const created_by of ["customer", "guest"]) {
        await expectViolation(
          () => insert("payment", paymentRow(orderId, { created_by, idempotency_key: null })),
          CHECK_VIOLATION,
          "payment_idempotency_key_check",
        );
      }
      await expectViolation(
        () => insert("payment", paymentRow(orderId, { created_by: "system" })),
        CHECK_VIOLATION,
        "payment_created_by_check",
      );
      // An admin-created attempt (a payment link, later) may come without a key, more than once.
      await insert(
        "payment",
        paymentRow(orderId, {
          ...statusColumns("failed"),
          created_by: "admin",
          idempotency_key: null,
        }),
      );
      await insert(
        "payment",
        paymentRow(orderId, {
          ...statusColumns("failed"),
          created_by: "admin",
          idempotency_key: null,
        }),
      );
      const key = randomUUID();
      await insert(
        "payment",
        paymentRow(orderId, { ...statusColumns("failed"), idempotency_key: key }),
      );
      await expectViolation(
        () =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("failed"), idempotency_key: key }),
          ),
        UNIQUE_VIOLATION,
        "payment_order_id_idempotency_key_key",
      );
      const otherOrderId = await createOrder();
      await insert(
        "payment",
        paymentRow(otherOrderId, { ...statusColumns("failed"), idempotency_key: key }),
      );
    });

    it("allows at most one live attempt per order, in every pair of live statuses", async () => {
      for (const first of LIVE) {
        for (const second of LIVE) {
          const orderId = await createOrder();
          await insert("payment", paymentRow(orderId, statusColumns(first)));
          await expectViolation(
            () => insert("payment", paymentRow(orderId, statusColumns(second))),
            UNIQUE_VIOLATION,
            "payment_order_id_live_key",
          );
        }
      }
    });

    it("lets closed attempts pile up next to the live one, and a closed attempt never becomes live again beside it", async () => {
      const orderId = await createOrder();
      for (const status of FINAL) {
        await insert("payment", paymentRow(orderId, statusColumns(status)));
        await insert("payment", paymentRow(orderId, statusColumns(status)));
      }
      await insert("payment", paymentRow(orderId, statusColumns("awaiting_customer")));
      const closedId = await insertId("payment", paymentRow(orderId, statusColumns("failed")));
      await expectViolation(
        () =>
          client.query(
            `update payment set status = 'create_unknown', next_check_at = $2 where id = $1`,
            [closedId, FUTURE],
          ),
        UNIQUE_VIOLATION,
        "payment_order_id_live_key",
      );
      // Another order is independent.
      const otherOrderId = await createOrder();
      await insert("payment", paymentRow(otherOrderId));
    });

    it("keeps provider invoice ids unique per provider; many attempts may have none yet", async () => {
      const orderId = await createOrder();
      await insert(
        "payment",
        paymentRow(orderId, { ...statusColumns("failed"), provider_payment_id: "inv_x" }),
      );
      await insert(
        "payment",
        paymentRow(orderId, {
          ...statusColumns("failed"),
          provider_code: "other",
          provider_payment_id: "inv_x",
        }),
      );
      await expectViolation(
        () =>
          insert(
            "payment",
            paymentRow(orderId, { ...statusColumns("failed"), provider_payment_id: "inv_x" }),
          ),
        UNIQUE_VIOLATION,
        "payment_provider_code_provider_payment_id_key",
      );
      await insert(
        "payment",
        paymentRow(orderId, { ...statusColumns("failed"), provider_payment_id: null }),
      );
      await insert(
        "payment",
        paymentRow(orderId, { ...statusColumns("failed"), provider_payment_id: null }),
      );
    });

    it("keeps an order with payments from being deleted, and rejects an unknown order", async () => {
      const { orderId } = await createPayment();
      await expectViolation(
        () => client.query('delete from "sales_order" where id = $1', [orderId]),
        FOREIGN_KEY_VIOLATION,
        "payment_order_id_fkey",
      );
      await expectViolation(
        () => insert("payment", paymentRow(randomUUID())),
        FOREIGN_KEY_VIOLATION,
        "payment_order_id_fkey",
      );
    });
  });

  describe("payment_event", () => {
    it("accepts a system row and a fact row, applies the defaults and takes the time of the statement", async () => {
      const { id: paymentId } = await createPayment();
      const first = await insert("payment_event", eventRow(paymentId));
      const second = await insert("payment_event", factEventRow(paymentId));
      expect(first).toMatchObject({ dedupe_key: null, actor_admin_id: null, amount: null });
      expect(second).toMatchObject({ amount: "2500", final_amount: "2500", currency: "UAH" });
      // Compared in the database: clock_timestamp() differs by microseconds, which a JS Date drops.
      const order = await client.query<{ later: boolean; now: boolean }>(
        `select b.created_at > a.created_at as later, a.created_at = now() as now
         from payment_event a, payment_event b where a.id = $1 and b.id = $2`,
        [first.id, second.id],
      );
      expect(order.rows[0]).toEqual({ later: true, now: false });
    });

    it("has no column for a raw body, a card mask, a provider message or a bank reference", async () => {
      const result = await client.query<{ column_name: string; data_type: string }>(
        `select column_name, data_type from information_schema.columns
         where table_schema = 'public' and table_name = 'payment_event' order by ordinal_position`,
      );
      expect(result.rows.map((row) => row.column_name)).toEqual([
        "id",
        "payment_id",
        "source",
        "dedupe_key",
        "provider_status",
        "provider_modified_at",
        "amount",
        "final_amount",
        "currency",
        "failure_code",
        "applied",
        "from_status",
        "to_status",
        "actor_admin_id",
        "created_at",
      ]);
      expect(
        result.rows.filter((row) => ["jsonb", "json", "bytea"].includes(row.data_type)),
      ).toEqual([]);
    });

    it("checks the source, the statuses and the codes", async () => {
      const { id: paymentId } = await createPayment();
      await expectBoundaries(
        (source) => insert("payment_event", eventRow(paymentId, { source })),
        "payment_event_source_check",
        ["create", "admin", "system"],
        ["provider", ""],
      );
      await expectBoundaries(
        (to_status) => insert("payment_event", eventRow(paymentId, { to_status })),
        "payment_event_to_status_check",
        [null, "processing"],
        ["paid"],
      );
      await expectBoundaries(
        (from_status) =>
          insert("payment_event", eventRow(paymentId, { from_status, to_status: "failed" })),
        "payment_event_from_status_check",
        [null, "creating"],
        ["paid"],
      );
      await expectBoundaries(
        (failure_code) => insert("payment_event", factEventRow(paymentId, { failure_code })),
        "payment_event_failure_code_check",
        [null, "1077"],
        ["Declined by bank", ""],
      );
      await expectBoundaries(
        (provider_status) => insert("payment_event", factEventRow(paymentId, { provider_status })),
        "payment_event_provider_status_check",
        ["success", "a".repeat(32)],
        ["a".repeat(33), "a:b"],
      );
    });

    it("needs the exact webhook and poll key shapes, and a key prefixed with the source otherwise", async () => {
      const { id: paymentId } = await createPayment();
      const digest = sha256Hex("body");
      await expectBoundaries(
        (dedupe_key) => insert("payment_event", factEventRow(paymentId, { dedupe_key })),
        "payment_event_webhook_dedupe_key_check",
        [`webhook:${digest}`],
        [
          null,
          `webhook:${digest.toUpperCase()}`,
          `webhook:${digest}x`,
          `webhook:${digest.slice(1)}`,
        ],
      );
      const pollKey = buildPollDedupeKey(providerFact(), sha256Hex);
      await expectBoundaries(
        (dedupe_key) =>
          insert("payment_event", factEventRow(paymentId, { source: "poll", dedupe_key })),
        "payment_event_poll_dedupe_key_check",
        [pollKey],
        [
          null,
          pollKey.replace("2026-10-26T10:00:00.000Z", "2026-10-26T10:00Z"),
          pollKey.replace(":2500:", ":-1:"),
          pollKey.slice(0, -1),
          "poll:anything",
        ],
      );
      await expectBoundaries(
        (dedupe_key) => insert("payment_event", eventRow(paymentId, { dedupe_key })),
        "payment_event_dedupe_key_check",
        [null, "system:defer:1", `system:${"a".repeat(190)}`],
        [`webhook:${digest}`, "admin:x", "system:", "system:a b", `system:${"a".repeat(250)}`],
      );
      await expectBoundaries(
        (dedupe_key) => insert("payment_event", factEventRow(paymentId, { dedupe_key })),
        "payment_event_dedupe_key_check",
        [`webhook:${sha256Hex("other")}`],
        [`poll:${digest}`],
      );
    });

    it("keeps dedupe keys unique, so a replayed webhook is one row", async () => {
      const { id: paymentId } = await createPayment();
      const key = buildWebhookDedupeKey(sha256Hex("same body"));
      await insert("payment_event", factEventRow(paymentId, { dedupe_key: key }));
      await expectViolation(
        () => insert("payment_event", factEventRow(paymentId, { dedupe_key: key })),
        UNIQUE_VIOLATION,
        "payment_event_dedupe_key_key",
      );
      const { id: otherPaymentId } = await createPayment();
      await expectViolation(
        () => insert("payment_event", factEventRow(otherPaymentId, { dedupe_key: key })),
        UNIQUE_VIOLATION,
        "payment_event_dedupe_key_key",
      );
      const conflict = await client.query(
        `insert into payment_event (payment_id, source, dedupe_key, provider_status, provider_modified_at, amount,
           currency, applied)
         values ($1, 'webhook', $2, 'success', now(), 2500, 'UAH', false) on conflict (dedupe_key) do nothing`,
        [paymentId, key],
      );
      expect(conflict.rowCount).toBe(0);
    });

    it("needs the normalized fact of a webhook or poll row", async () => {
      const { id: paymentId } = await createPayment();
      for (const source of ["webhook", "poll"] as const) {
        const key =
          source === "webhook"
            ? buildWebhookDedupeKey(sha256Hex(randomUUID()))
            : buildPollDedupeKey(
                providerFact({
                  reference: randomUUID(),
                  modifiedAt: new Date(Date.UTC(2026, 9, 26, 10, sequence++)),
                }),
                sha256Hex,
              );
        const missingParts: readonly Row[] = [
          { provider_status: null, provider_modified_at: null },
          { amount: null, final_amount: null, currency: null },
        ];
        for (const missing of missingParts) {
          await expectViolation(
            () =>
              insert(
                "payment_event",
                factEventRow(paymentId, { source, dedupe_key: key, ...missing }),
              ),
            CHECK_VIOLATION,
            "payment_event_fact_check",
          );
        }
      }
    });

    it("stores a provider status with its time, an amount with its currency and a final amount only with an amount", async () => {
      const { id: paymentId } = await createPayment();
      for (const [extra, constraint] of [
        [
          { provider_status: "success", provider_modified_at: null },
          "payment_event_provider_fact_check",
        ],
        [
          { provider_status: null, provider_modified_at: FUTURE },
          "payment_event_provider_fact_check",
        ],
        [{ amount: 1, currency: null }, "payment_event_money_check"],
        [{ amount: null, currency: "UAH" }, "payment_event_money_check"],
        [{ final_amount: 1, amount: null, currency: null }, "payment_event_money_check"],
      ] as const) {
        await expectViolation(
          () => insert("payment_event", eventRow(paymentId, extra)),
          CHECK_VIOLATION,
          constraint,
        );
      }
      await expectBoundaries(
        (amount) =>
          insert("payment_event", factEventRow(paymentId, { amount, final_amount: null })),
        "payment_event_amount_check",
        [1, MAX_AMOUNT],
        [0, -1, MAX_AMOUNT + 1],
      );
      await expectBoundaries(
        (final_amount) => insert("payment_event", factEventRow(paymentId, { final_amount })),
        "payment_event_final_amount_check",
        [null, 0, MAX_AMOUNT],
        [-1, MAX_AMOUNT + 1],
      );
      await expectBoundaries(
        (currency) => insert("payment_event", factEventRow(paymentId, { currency })),
        "payment_event_currency_check",
        ["UAH", "EUR"],
        ["uah", "UA"],
      );
    });

    it("records a status change only as an applied change between two different statuses", async () => {
      const { id: paymentId } = await createPayment();
      for (const extra of [
        { applied: false, from_status: null, to_status: "creating" },
        { applied: true, from_status: "creating", to_status: null },
        { applied: true, from_status: "creating", to_status: "creating" },
      ]) {
        await expectViolation(
          () => insert("payment_event", eventRow(paymentId, extra)),
          CHECK_VIOLATION,
          "payment_event_status_change_check",
        );
      }
      await expectAccepted(() =>
        insert(
          "payment_event",
          eventRow(paymentId, { applied: false, from_status: null, to_status: null }),
        ),
      );
      await expectAccepted(() =>
        insert(
          "payment_event",
          eventRow(paymentId, { applied: true, from_status: "creating", to_status: "failed" }),
        ),
      );
    });

    it("names an admin only on an admin row; rejects an unknown payment or admin", async () => {
      const adminId = await createAdmin();
      const { id: paymentId } = await createPayment();
      await insert(
        "payment_event",
        eventRow(paymentId, { source: "admin", actor_admin_id: adminId }),
      );
      for (const source of ["system", "create"]) {
        await expectViolation(
          () => insert("payment_event", eventRow(paymentId, { source, actor_admin_id: adminId })),
          CHECK_VIOLATION,
          "payment_event_actor_check",
        );
      }
      await expectViolation(
        () => insert("payment_event", eventRow(randomUUID())),
        FOREIGN_KEY_VIOLATION,
        "payment_event_payment_id_fkey",
      );
      await expectViolation(
        () =>
          insert(
            "payment_event",
            eventRow(paymentId, { source: "admin", actor_admin_id: randomUUID() }),
          ),
        FOREIGN_KEY_VIOLATION,
        "payment_event_actor_admin_id_fkey",
      );
    });

    describe("append-only trigger", () => {
      async function createEvent(extra: Row = {}): Promise<{ eventId: string; paymentId: string }> {
        const { id: paymentId } = await createPayment();
        const eventId = await insertId("payment_event", eventRow(paymentId, extra));
        return { eventId, paymentId };
      }
      const event = (id: string) => selectWhere("payment_event", `id = '${id}'`);
      const updateAtDepthTwo = (id: string, assignments: string) =>
        runAtDepthTwo(`update "payment_event" set ${assignments} where id = '${id}'`);

      it("rejects a direct UPDATE of any column, also nulling the admin, and a direct DELETE", async () => {
        const adminId = await createAdmin();
        const { eventId } = await createEvent({ source: "admin", actor_admin_id: adminId });
        const before = await event(eventId);
        for (const assignment of [
          "applied = false, to_status = NULL",
          "to_status = 'failed'",
          "source = 'system', actor_admin_id = NULL",
          "dedupe_key = 'admin:x'",
          "failure_code = '1'",
          "actor_admin_id = NULL",
          "created_at = now()",
          "applied = applied",
        ]) {
          await expectViolation(
            () => client.query(`update "payment_event" set ${assignment} where id = $1`, [eventId]),
            RESTRICT_VIOLATION,
            undefined,
          );
        }
        await expectViolation(
          () => client.query('delete from "payment_event" where id = $1', [eventId]),
          RESTRICT_VIOLATION,
          undefined,
        );
        await expectViolation(
          () => client.query('delete from "payment_event"'),
          RESTRICT_VIOLATION,
          undefined,
        );
        expect(await event(eventId)).toEqual(before);
      });

      it("allows the SET NULL of actor_admin_id when the admin user is deleted, and nothing else changes", async () => {
        const adminId = await createAdmin();
        const { eventId } = await createEvent({ source: "admin", actor_admin_id: adminId });
        const before = await event(eventId);
        await client.query('delete from "admin_user" where id = $1', [adminId]);
        expect(await event(eventId)).toEqual({ ...before, actor_admin_id: null });
      });

      it("is deleted with its payment through the cascade (the allowed path), and the order stays", async () => {
        const { eventId, paymentId } = await createEvent();
        const orderId = (await selectWhere("payment", `id = '${paymentId}'`)).order_id as string;
        await insert("payment_event", factEventRow(paymentId));
        await client.query('delete from "payment" where id = $1', [paymentId]);
        expect(await count("payment_event", `id = '${eventId}'`)).toBe(0);
        expect(await count("payment_event", `payment_id = '${paymentId}'`)).toBe(0);
        expect(await count("sales_order", `id = '${orderId}'`)).toBe(1);
      });

      describe("changes at trigger depth above 1 (what only a referential action may do)", () => {
        it("accepts an UPDATE that only nulls actor_admin_id", async () => {
          const adminId = await createAdmin();
          const { eventId } = await createEvent({ source: "admin", actor_admin_id: adminId });
          const before = await event(eventId);
          await updateAtDepthTwo(eventId, "actor_admin_id = NULL");
          expect(await event(eventId)).toEqual({ ...before, actor_admin_id: null });
        });

        it("rejects an UPDATE that nulls actor_admin_id and changes another column", async () => {
          const adminId = await createAdmin();
          const { eventId } = await createEvent({ source: "admin", actor_admin_id: adminId });
          for (const assignment of [
            "actor_admin_id = NULL, to_status = 'failed'",
            "actor_admin_id = NULL, applied = false, to_status = NULL",
            "actor_admin_id = NULL, failure_code = '1'",
          ]) {
            await expectViolation(
              () => updateAtDepthTwo(eventId, assignment),
              RESTRICT_VIOLATION,
              undefined,
            );
          }
          expect(await event(eventId)).toMatchObject({ actor_admin_id: adminId });
        });

        it("rejects another column alone and an admin set to a value", async () => {
          const adminId = await createAdmin();
          const { eventId } = await createEvent({ source: "admin" });
          await expectViolation(
            () => updateAtDepthTwo(eventId, "to_status = 'failed'"),
            RESTRICT_VIOLATION,
            undefined,
          );
          await expectViolation(
            () => updateAtDepthTwo(eventId, `actor_admin_id = '${adminId}'`),
            RESTRICT_VIOLATION,
            undefined,
          );
        });

        it("accepts a DELETE", async () => {
          const { eventId } = await createEvent();
          await runAtDepthTwo(`delete from "payment_event" where id = '${eventId}'`);
          expect(await count("payment_event", `id = '${eventId}'`)).toBe(0);
        });
      });
    });
  });

  describe("payment_refund", () => {
    it("accepts an admin refund and applies the defaults", async () => {
      const adminId = await createAdmin();
      const { id: paymentId } = await createSucceeded();
      const created = await insert(
        "payment_refund",
        refundRow(paymentId, {
          actor_admin_id: adminId,
          note: "Returned",
          idempotency_key: randomUUID(),
        }),
      );
      expect(created).toMatchObject({
        status: "requested",
        failure_code: null,
        provider_modified_at: null,
        amount: "1000",
        payment_amount: "2500",
      });
    });

    it("checks statuses, reasons and the failure code, which only a failed refund has", async () => {
      const { id: paymentId } = await createSucceeded();
      await expectBoundaries(
        (status) => insert("payment_refund", refundRow(paymentId, { status })),
        "payment_refund_status_check",
        [...REFUND_STATUSES],
        ["cancelled"],
      );
      await expectBoundaries(
        (reason) => insert("payment_refund", refundRow(paymentId, { reason })),
        "payment_refund_reason_check",
        ["admin", "amount_mismatch", "late_payment", "duplicate_payment"],
        ["other"],
      );
      await expectBoundaries(
        (failure_code) =>
          insert("payment_refund", refundRow(paymentId, { status: "failed", failure_code })),
        "payment_refund_failure_code_check",
        [null, "CANCEL_NOT_AVAILABLE", "not_sent"],
        ["", "Refund not available"],
      );
      for (const status of REFUND_STATUSES.filter((value) => value !== "failed")) {
        await expectViolation(
          () => insert("payment_refund", refundRow(paymentId, { status, failure_code: "x" })),
          CHECK_VIOLATION,
          "payment_refund_failure_code_status_check",
        );
      }
    });

    it("keeps each refund within 1 and its payment's amount, in its payment's currency", async () => {
      const { id: paymentId } = await createSucceeded();
      await expectBoundaries(
        (amount) => insert("payment_refund", refundRow(paymentId, { amount })),
        "payment_refund_amount_check",
        [1, 2500],
        [0, -1, 2501],
      );
      // The copy of the payment's amount and currency must be the payment's own (composite foreign key).
      const foreignCopies: readonly Row[] = [
        { payment_amount: 2600, amount: 2600 },
        { payment_amount: 2400 },
        { currency: "EUR" },
      ];
      for (const extra of foreignCopies) {
        await expectViolation(
          () => insert("payment_refund", refundRow(paymentId, extra)),
          FOREIGN_KEY_VIOLATION,
          "payment_refund_payment_fkey",
        );
      }
      await expectViolation(
        () => insert("payment_refund", refundRow(randomUUID())),
        FOREIGN_KEY_VIOLATION,
        "payment_refund_payment_fkey",
      );
    });

    it("keeps the amount and currency of a payment with refunds from changing", async () => {
      const { id: paymentId } = await createSucceeded();
      await insert("payment_refund", refundRow(paymentId));
      for (const assignment of ["amount = 3000", "currency = 'EUR'"]) {
        await expectViolation(
          () => client.query(`update payment set ${assignment} where id = $1`, [paymentId]),
          FOREIGN_KEY_VIOLATION,
          "payment_refund_payment_fkey",
        );
      }
    });

    it("gives an automatic refund no admin, note or idempotency key", async () => {
      const adminId = await createAdmin();
      const { id: paymentId } = await createSucceeded();
      for (const reason of ["late_payment", "duplicate_payment"]) {
        await expectAccepted(() =>
          insert("payment_refund", refundRow(paymentId, { reason, amount: 2500 })),
        );
        const manualParts: readonly Row[] = [
          { actor_admin_id: adminId },
          { note: "x" },
          { idempotency_key: randomUUID() },
        ];
        for (const extra of manualParts) {
          await expectViolation(
            () => insert("payment_refund", refundRow(paymentId, { reason, ...extra })),
            CHECK_VIOLATION,
            "payment_refund_automatic_check",
          );
        }
      }
    });

    it("keeps the admin route's idempotency keys unique; automatic refunds have none", async () => {
      const { id: paymentId } = await createSucceeded();
      const key = randomUUID();
      await insert("payment_refund", refundRow(paymentId, { idempotency_key: key }));
      await expectViolation(
        () => insert("payment_refund", refundRow(paymentId, { idempotency_key: key })),
        UNIQUE_VIOLATION,
        "payment_refund_idempotency_key_key",
      );
      await insert("payment_refund", refundRow(paymentId, { idempotency_key: null }));
      await insert("payment_refund", refundRow(paymentId, { idempotency_key: null }));
    });

    it("keeps a payment with refunds from being deleted; nulls the admin when the admin user is deleted", async () => {
      const adminId = await createAdmin();
      const { id: paymentId } = await createSucceeded();
      const refundId = await insertId(
        "payment_refund",
        refundRow(paymentId, { actor_admin_id: adminId }),
      );
      await expectViolation(
        () => client.query('delete from "payment" where id = $1', [paymentId]),
        FOREIGN_KEY_VIOLATION,
        "payment_refund_payment_fkey",
      );
      await client.query('delete from "admin_user" where id = $1', [adminId]);
      expect(await selectWhere("payment_refund", `id = '${refundId}'`)).toMatchObject({
        actor_admin_id: null,
        amount: "1000",
      });
    });
  });

  describe("triggers and indexes", () => {
    it("has exactly the journal trigger of ADR 0032 on the payment tables", async () => {
      const result = await client.query<{ table: string; name: string; definition: string }>(
        `select c.relname as "table", t.tgname as name, pg_get_triggerdef(t.oid) as definition
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         where not t.tgisinternal and c.relname = any($1) order by c.relname, t.tgname`,
        [["payment", "payment_event", "payment_refund"]],
      );
      expect(result.rows.map((row) => [row.table, row.name])).toEqual([
        ["payment_event", "payment_event_append_only"],
        ["payment_event", "payment_event_no_truncate"],
      ]);
      for (const row of result.rows) {
        // Migration 0011 adds a statement-level BEFORE TRUNCATE trigger to each append-only table.
        if (row.name.endsWith("_no_truncate")) {
          expect(row.definition).toContain("BEFORE TRUNCATE");
          expect(row.definition).toContain("FOR EACH STATEMENT");
        } else {
          expect(row.definition).toContain("BEFORE DELETE OR UPDATE");
          expect(row.definition).toContain("FOR EACH ROW");
        }
      }
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
        [["payment", "payment_event", "payment_refund"]],
      );
      expect(result.rows).toEqual([]);
    });

    it("has the journal index by payment and time", async () => {
      expect(await indexDefinition("payment_event_payment_id_created_at_idx")).toContain(
        "(payment_id, created_at)",
      );
    });
  });

  describe("drizzle schema", () => {
    it("keeps every constraint, index and table name within 63 characters", () => {
      const tables: PgTable[] = [
        paymentsSchema.payment,
        paymentsSchema.paymentEvent,
        paymentsSchema.paymentRefund,
      ];
      for (const table of tables) {
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
