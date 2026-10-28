import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  buildPaymentLines,
  decideNewPaymentAttempt,
  paymentStatusAfterCreate,
  PROVIDER_PAYMENT_ID_PATTERN,
  type PaymentCreated,
  type PaymentLine,
  type PaymentProviderPort,
  type PaymentProviderResult,
  type OrderStatus,
  type PaymentStatus,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { retryOnDeadlock } from "../common/deadlock-retry.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import { isUniqueViolation } from "../common/postgres-errors.js";
import { withTransaction, type Transaction } from "../common/transaction.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrdersRepository, type OrderRow } from "../orders/orders.repository.js";
import { PaymentChanges, paymentStatusOf } from "./attempts/payment-changes.js";
import { PaymentsRepository, type PaymentRow } from "./attempts/payments.repository.js";
import { moneyOf } from "./payment-facts.service.js";
import { paymentDescription, snapshotText } from "./payment-messages.js";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";
import { PAYMENT_TIMINGS, PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { PaymentProviderRegistry } from "./registry/index.js";

/** The shopper's view of an attempt the create flow answers (no provider id, no amount from the client). */
export interface CreatedPaymentView {
  readonly paymentId: string;
  readonly status: PaymentStatus;
  /** The provider's page while the attempt waits for the shopper; `null` otherwise. */
  readonly redirectUrl: string | null;
  readonly expiresAt: Date;
}

export type CreatePaymentRefusal =
  | "order_not_payable"
  | "payment_in_progress"
  | "payment_window_too_short"
  | "payment_not_available";

export type CreatePaymentResult =
  /** `201` (or `200` for a replay of the same `Idempotency-Key`): the shopper goes to `redirectUrl`. */
  | { readonly kind: "created"; readonly replay: boolean; readonly payment: CreatedPaymentView }
  /** `409 rule_violation` with the rule. */
  | { readonly kind: "refused"; readonly rule: CreatePaymentRefusal }
  /** `404`: no such order (ownership is checked by the route before this is called). */
  | { readonly kind: "not_found" }
  /**
   * `503 payment_provider_unavailable`: the provider refused or did not answer. `failed`: the shopper may try again at
   * once; `create_unknown`: never retried, blocks a new attempt until job 11 closes it (ADR 0032 open question 1, kept).
   */
  | {
      readonly kind: "provider_unavailable";
      readonly payment: CreatedPaymentView;
      readonly retryAfterSeconds: number | null;
    };

export interface CreatePaymentInput {
  readonly orderId: string;
  /** The route's `Idempotency-Key` (a UUID). */
  readonly idempotencyKey: string;
  readonly createdBy: "customer" | "guest";
  /** The storefront locale of the return page; one of `LOCALES`, else the order's. */
  readonly locale?: string | null;
  /** A provider code; optional while one provider is enabled. */
  readonly providerCode?: string | null;
}

const MAX_PAGE_URL_LENGTH = 2048;

function viewOf(row: PaymentRow): CreatedPaymentView {
  return {
    paymentId: row.id,
    status: paymentStatusOf(row.status),
    redirectUrl: row.redirectUrl,
    expiresAt: row.expiresAt,
  };
}

/** A provider's page URL may reach a browser only as `https`, visible ASCII, at most 2048 characters (decision 14). */
function isSafePageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_PAGE_URL_LENGTH || !/^[!-~]+$/.test(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The create flow of a payment attempt (ADR 0032 decision 6): the service method the store routes of plan step 8 call
 * after their ownership check. Never takes an amount from the client: the attempt's amount is the order total read
 * under the order lock.
 * 1. One short transaction (order row lock, then the order's attempts): replay by `Idempotency-Key`; core
 *    `decideNewPaymentAttempt` (order awaiting payment, no blocking attempt, invoice validity, a provider that takes the
 *    currency); close every `awaiting_customer` attempt `invalidated` (job 11 invalidates its invoice after commit);
 *    insert the new attempt `creating`. Commit.
 * 2. `createPayment` with NO transaction open and the API's timeout; return and webhook URLs from
 *    `STOREFRONT_PUBLIC_URL` only (never a request's `Host`); the basket from core `buildPaymentLines`.
 * 3. One short transaction: core `paymentStatusAfterCreate` -> `awaiting_customer`, `failed` or `create_unknown`.
 *    A lost answer is never retried (Monobank has no create idempotency, M5).
 */
@Injectable()
export class PaymentCreateService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentChanges) private readonly changes: PaymentChanges,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(LOCALE_CONFIG) private readonly locales: LocaleConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createPaymentForOrder(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const provider = this.chooseProvider(input.providerCode ?? null);
    const now = this.clock.now();
    const opened = await this.open(input, provider, now);
    if (opened.kind !== "opened") {
      return opened;
    }
    const { row, request, provider: chosen } = opened;
    const call = await callPaymentProvider<PaymentCreated>(
      (signal) => chosen.createPayment(request, signal),
      this.config.providerTimeoutMs,
    );
    if (!call.result.ok) {
      this.logger.warn(
        `Payment ${row.id}: createPayment ${describePaymentCall(call)} (provider ${row.providerCode})`,
      );
    }
    const recorded = await this.record(row.id, call.result);
    const view = viewOf(recorded);
    if (recorded.status !== "failed" && recorded.status !== "create_unknown") {
      return { kind: "created", replay: false, payment: view };
    }
    const retryAfterSeconds =
      !call.result.ok && call.result.retryAfterSeconds !== undefined
        ? call.result.retryAfterSeconds
        : null;
    return { kind: "provider_unavailable", payment: view, retryAfterSeconds };
  }

  /** Step 1. Answers the new `creating` row and the provider request, or the final answer of a replay or refusal. */
  private async open(
    input: CreatePaymentInput,
    provider: PaymentProviderPort | undefined,
    now: Date,
  ): Promise<
    | Exclude<CreatePaymentResult, { kind: "provider_unavailable" }>
    | {
        kind: "opened";
        row: PaymentRow;
        provider: PaymentProviderPort;
        request: Parameters<PaymentProviderPort["createPayment"]>[0];
      }
  > {
    try {
      return await retryOnDeadlock(
        () =>
          withTransaction(this.database, async (tx) => {
            const order = await this.orders.lockById(tx, input.orderId);
            if (order === undefined) {
              return { kind: "not_found" as const };
            }
            const replayed = await this.payments.findByIdempotencyKey(
              tx,
              order.id,
              input.idempotencyKey,
            );
            if (replayed !== undefined) {
              return { kind: "created" as const, replay: true, payment: viewOf(replayed) };
            }
            const attempts = await this.payments.lockAttemptsOfOrder(tx, order.id);
            const decision = decideNewPaymentAttempt({
              orderStatus: order.status as OrderStatus,
              attempts: attempts.map((attempt) => ({
                id: attempt.id,
                status: paymentStatusOf(attempt.status),
              })),
              providerAvailable:
                provider !== undefined &&
                this.config.storefrontPublicUrl !== null &&
                provider.capabilities.currencies.includes(order.currency),
              now,
              orderExpiresAt: order.expiresAt,
            });
            if (!decision.ok) {
              return { kind: "refused" as const, rule: decision.rule };
            }
            if (provider === undefined || this.config.storefrontPublicUrl === null) {
              throw new Error("unreachable: a provider was available");
            }
            await this.invalidateOpen(tx, attempts, decision.invalidate, now);
            const row = await this.changes.create(
              tx,
              {
                id: randomUUID(),
                orderId: order.id,
                providerCode: provider.code,
                amount: order.totalAmount,
                currency: order.currency,
                expiresAt: decision.expiresAt,
                // A create that is never recorded (the process died) is closed by job 11 after this.
                nextCheckAt: new Date(now.getTime() + PAYMENT_TIMINGS.createRecoveryMs),
                checkAttempts: 0,
                idempotencyKey: input.idempotencyKey,
                createdBy: input.createdBy,
                createdAt: now,
                updatedAt: now,
              },
              { source: "create" },
            );
            const request = await this.providerRequest(tx, order, row, input, provider);
            return { kind: "opened" as const, row, provider, request };
          }),
        (message) => this.logger.warn(message),
      );
    } catch (error) {
      // The order lock serializes creates, so these are a second guard: the one-live-attempt index and the key.
      if (isUniqueViolation(error, "payment_order_id_live_key")) {
        return { kind: "refused", rule: "payment_in_progress" };
      }
      if (isUniqueViolation(error, "payment_order_id_idempotency_key_key")) {
        const replayed = await this.payments.findByIdempotencyKey(
          this.database,
          input.orderId,
          input.idempotencyKey,
        );
        if (replayed !== undefined) {
          return { kind: "created", replay: true, payment: viewOf(replayed) };
        }
      }
      throw error;
    }
  }

  /** Closes the order's `awaiting_customer` attempts (a new attempt replaces them; their invoices are invalidated by job 11). */
  private async invalidateOpen(
    tx: Transaction,
    attempts: readonly PaymentRow[],
    ids: readonly string[],
    now: Date,
  ): Promise<void> {
    for (const attempt of attempts.filter((entry) => ids.includes(entry.id))) {
      const changed = await this.changes.transition(tx, attempt, "invalidated", "system", {
        now,
        columns: { redirectUrl: null, nextCheckAt: now, checkAttempts: 0 },
        entry: { source: "system" },
      });
      if (!changed.ok) {
        throw new Error(`Invalidating an open attempt was refused: ${changed.reason}`);
      }
    }
  }

  private async providerRequest(
    tx: Transaction,
    order: OrderRow,
    row: PaymentRow,
    input: CreatePaymentInput,
    provider: PaymentProviderPort,
  ): Promise<Parameters<PaymentProviderPort["createPayment"]>[0]> {
    const locale =
      input.locale !== undefined &&
      input.locale !== null &&
      this.locales.locales.includes(input.locale)
        ? input.locale
        : order.locale;
    const base = (this.config.storefrontPublicUrl ?? "").replace(/\/+$/, "");
    const amount = moneyOf(row.amount, row.currency);
    return {
      paymentId: row.id,
      orderNumber: order.number,
      amount,
      description: paymentDescription(order.number, [locale, order.locale]),
      lines: await this.basket(tx, order, amount, [locale, order.locale]),
      returnUrl: `${base}/${encodeURIComponent(locale)}/payment/return?payment=${row.id}`,
      webhookUrl: `${base}/webhooks/payments/${encodeURIComponent(provider.code)}`,
      expiresAt: row.expiresAt,
    };
  }

  /** The order snapshot lines plus the shipping line; none when they do not add up to the amount (core decides). */
  private async basket(
    tx: Transaction,
    order: OrderRow,
    amount: ReturnType<typeof moneyOf>,
    locales: readonly string[],
  ): Promise<readonly PaymentLine[]> {
    const lines = await this.payments.basketLines(tx, order.id);
    const shipping = await this.payments.basketShipping(tx, order.id);
    const decided = buildPaymentLines({
      amount,
      lines: lines.map((line) => {
        const product = snapshotText(line.productTitle, locales) ?? line.sku;
        const variant = snapshotText(line.variantTitle, locales);
        return {
          title: variant === null ? product : `${product} (${variant})`,
          quantity: line.quantity,
          unitPrice: moneyOf(line.unitAmount, line.currency),
          lineTotal: moneyOf(line.lineTotal, line.currency),
          sku: line.sku,
        };
      }),
      shipping:
        shipping === undefined
          ? null
          : {
              title: snapshotText(shipping.title, locales) ?? shipping.methodCode,
              amount: moneyOf(shipping.amount, shipping.currency),
              code: shipping.methodCode,
            },
    });
    return decided.ok ? decided.lines : [];
  }

  /** Step 3: records the provider's answer on a still-`creating` attempt. */
  private async record(
    paymentId: string,
    result: PaymentProviderResult<PaymentCreated>,
  ): Promise<PaymentRow> {
    const now = this.clock.now();
    const checked = this.checkCreated(result);
    return retryOnDeadlock(
      () =>
        withTransaction(this.database, async (tx) => {
          const row = await this.payments.lockById(tx, paymentId);
          if (row === undefined) {
            throw new Error("A payment attempt disappeared before its create was recorded");
          }
          if (row.status !== "creating") {
            return this.recordLate(tx, row, checked, now);
          }
          const decision = paymentStatusAfterCreate(checked);
          const columns =
            decision.status === "awaiting_customer" && checked.ok
              ? {
                  providerPaymentId: checked.value.providerPaymentId,
                  redirectUrl: checked.value.redirectUrl,
                  nextCheckAt: row.expiresAt,
                  checkAttempts: 0,
                }
              : decision.status === "failed"
                ? { failureCode: decision.failureCode, nextCheckAt: null, checkAttempts: 0 }
                : { nextCheckAt: row.expiresAt, checkAttempts: 0 };
          const changed = await this.changes.transition(tx, row, decision.status, "system", {
            now,
            columns,
            entry: { source: "create" },
          });
          if (!changed.ok) {
            throw new Error(`Recording a create answer was refused: ${changed.reason}`);
          }
          return changed.row;
        }),
      (message) => this.logger.warn(message),
    );
  }

  /**
   * A fact (a webhook found the attempt by our reference) or job 11 got there first. An answered create still teaches
   * us the provider id when the attempt has none yet, so job 11 can read it; nothing else changes.
   */
  private async recordLate(
    tx: Transaction,
    row: PaymentRow,
    checked: PaymentProviderResult<PaymentCreated>,
    now: Date,
  ): Promise<PaymentRow> {
    if (!checked.ok || row.providerPaymentId !== null || row.status !== "create_unknown") {
      return row;
    }
    return this.changes.record(tx, row, {
      now,
      applied: true,
      columns: {
        providerPaymentId: checked.value.providerPaymentId,
        nextCheckAt: now,
        checkAttempts: 0,
      },
      entry: { source: "create" },
    });
  }

  /** An `ok` answer whose id or page URL is unusable is a malformed answer: `unavailable`, so `create_unknown`. */
  private checkCreated(
    result: PaymentProviderResult<PaymentCreated>,
  ): PaymentProviderResult<PaymentCreated> {
    if (!result.ok) {
      return result;
    }
    const { providerPaymentId, redirectUrl } = result.value;
    if (
      typeof providerPaymentId !== "string" ||
      !PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId) ||
      !isSafePageUrl(redirectUrl)
    ) {
      return { ok: false, reason: "unavailable", providerCodes: [] };
    }
    return result;
  }

  private chooseProvider(code: string | null): PaymentProviderPort | undefined {
    if (code !== null) {
      return this.registry.get(code);
    }
    const providers = this.registry.list();
    return providers.length === 1 ? providers[0] : undefined;
  }
}
