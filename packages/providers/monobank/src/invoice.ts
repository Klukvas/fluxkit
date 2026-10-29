import { z } from "zod";
import {
  PAYMENT_CARD_LAST4_PATTERN,
  PAYMENT_CARD_SYSTEM_PATTERN,
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_STATUS_PATTERN,
  PROVIDER_PAYMENT_ID_PATTERN,
  providerPaymentFactProblems,
  type CreatePaymentInput,
  type Money,
  type PaymentLine,
  type ProviderPaymentFact,
  type ProviderPaymentStatus,
  type ProviderRefundFact,
  type ProviderRefundStatus,
  type SupportedCurrency,
} from "@fluxkit/core";

/*
 * Monobank's invoice shapes (ADR 0032 decision 15; the OpenAPI spec "Acquiring v2410" embedded in
 * https://api.monobank.ua/docs/acquiring.html, read 2026-10-29): the body of `POST /api/merchant/invoice/create` (M3), the
 * answers of create (M4), status (M6) and cancel (M13), and the mapping of a status answer (or a webhook body, which is
 * the same object, M8) to core's `ProviderPaymentFact`. The plugin only normalises fields; core decides what they mean.
 * Nothing here keeps `errText`, `failureReason`, `maskedPan` beyond its last four digits, `rrn`, `approvalCode`,
 * `destination` or any other text of the answer.
 */

/** ISO 4217 numeric codes of the currencies core knows (`ccy`, M3, M6). Requests send only 980 (UAH, question 6). */
export const MONOBANK_CURRENCY_NUMBERS: Readonly<Record<SupportedCurrency, number>> = Object.freeze(
  {
    UAH: 980,
    USD: 840,
    EUR: 978,
    PLN: 985,
    GBP: 826,
    CZK: 203,
    CHF: 756,
    CAD: 124,
    JPY: 392,
    KWD: 414,
  },
);

const CURRENCY_OF_NUMBER: ReadonlyMap<number, SupportedCurrency> = new Map(
  (Object.entries(MONOBANK_CURRENCY_NUMBERS) as [SupportedCurrency, number][]).map(
    ([code, number]) => [number, code],
  ),
);

/** The only currency this plugin creates invoices in (ADR 0032 decision 1, question 6; M18 UNKNOWN for others). */
export const MONOBANK_CURRENCY: SupportedCurrency = "UAH";

/**
 * Hosts a `pageUrl` may name before it reaches a browser (ADR 0032 decision 14). M23 is UNKNOWN: `pay.mbnk.biz` is the
 * host of every documented example (`InvoiceCreateResponse` and the QR answers of the OpenAPI spec); S1 confirms it with
 * a live test invoice and widens the list if needed. Any other host is refused as an unreadable answer.
 */
export const MONOBANK_PAGE_HOSTS: readonly string[] = Object.freeze(["pay.mbnk.biz"]);

/** Monobank's maximum `validity` (M3: "longer is cut to 30 days"). Longer is refused locally instead of cut. */
export const MONOBANK_MAX_VALIDITY_SECONDS = 30 * 24 * 60 * 60;

/** Longest URL the plugin sends as `redirectUrl` or `webHookUrl` (no documented limit; a sane bound). */
const MAX_URL_LENGTH = 2048;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what this refuses
const CONTROL = /[\u0000-\u001f\u007f]/;

// ---------------------------------------------------------------------------------------------------------------------
// The create request

export interface MonobankBasketItem {
  readonly name: string;
  readonly qty: number;
  readonly sum: number;
  readonly total: number;
  readonly code: string;
}

export interface MonobankCreateBody {
  readonly amount: number;
  readonly ccy: number;
  readonly merchantPaymInfo: {
    readonly reference: string;
    readonly destination: string;
    readonly basketOrder?: readonly MonobankBasketItem[];
  };
  readonly redirectUrl: string;
  readonly webHookUrl: string;
  readonly validity: number;
  readonly paymentType: "debit";
}

/** Why a create is refused before any request (`not_sent` codes). */
export type CreateRefusal =
  | "currency_not_supported"
  | "invalid_amount"
  | "invalid_payment_id"
  | "invalid_description"
  | "invalid_return_url"
  | "invalid_webhook_url"
  | "invoice_expired"
  | "validity_too_long";

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || CONTROL.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    // Not a URL at all: refused, like any other malformed value.
    return false;
  }
}

/**
 * `basketOrder` from the core basket lines (M3: `name`, `qty`, `sum` per unit, `total`, `code` are what the plugin
 * sends). Display only (PRRO is not linked in v1, ADR 0032 decision 1). The caller sends no lines when core's basket
 * check answered `sum_mismatch`; the plugin also omits the basket (never sends a wrong one) when any line breaks a rule:
 * another currency, a missing code, a total that is not unit x quantity, or a sum that differs from the amount.
 */
export function basketOrderOf(
  lines: readonly PaymentLine[],
  amount: Money,
): readonly MonobankBasketItem[] | undefined {
  if (lines.length === 0) {
    return undefined;
  }
  const items: MonobankBasketItem[] = [];
  let sum = 0;
  for (const line of lines) {
    const name = typeof line.name === "string" ? line.name.trim() : "";
    const code = typeof line.code === "string" ? line.code.trim() : "";
    if (
      name === "" ||
      code === "" ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.unitAmount.currency !== amount.currency ||
      line.total.currency !== amount.currency ||
      !Number.isSafeInteger(line.unitAmount.amount) ||
      line.unitAmount.amount < 0 ||
      line.unitAmount.amount * line.quantity !== line.total.amount
    ) {
      return undefined;
    }
    sum += line.total.amount;
    items.push({
      name,
      qty: line.quantity,
      sum: line.unitAmount.amount,
      total: line.total.amount,
      code,
    });
  }
  return sum === amount.amount ? items : undefined;
}

/**
 * The JSON body of `POST /api/merchant/invoice/create` (M3), or why nothing may be sent. `validity` is the whole number
 * of seconds from `now` to the invoice end core computed (`invoiceValidity`, ADR 0032 decision 9). No `X-Cms` header and
 * no `comment`, `customerEmails` or `saveCardData` (white-label; no personal data leaves the shop).
 */
export function createBodyOf(
  input: CreatePaymentInput,
  now: Date,
):
  | { readonly ok: true; readonly body: MonobankCreateBody }
  | { readonly ok: false; readonly refusal: CreateRefusal } {
  const refuse = (refusal: CreateRefusal) => ({ ok: false as const, refusal });
  if (input.amount.currency !== MONOBANK_CURRENCY) {
    return refuse("currency_not_supported");
  }
  if (!Number.isSafeInteger(input.amount.amount) || input.amount.amount < 1) {
    return refuse("invalid_amount");
  }
  if (typeof input.paymentId !== "string" || !UUID.test(input.paymentId)) {
    return refuse("invalid_payment_id");
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (
    description === "" ||
    [...description].length > PAYMENT_LIMITS.descriptionMaxLength ||
    CONTROL.test(description)
  ) {
    return refuse("invalid_description");
  }
  if (!isHttpUrl(input.returnUrl)) {
    return refuse("invalid_return_url");
  }
  if (!isHttpUrl(input.webhookUrl)) {
    return refuse("invalid_webhook_url");
  }
  const validity = Math.floor((input.expiresAt.getTime() - now.getTime()) / 1_000);
  if (!Number.isSafeInteger(validity) || validity < 1) {
    return refuse("invoice_expired");
  }
  if (validity > MONOBANK_MAX_VALIDITY_SECONDS) {
    return refuse("validity_too_long");
  }
  const basketOrder = basketOrderOf(input.lines, input.amount);
  return {
    ok: true as const,
    body: {
      amount: input.amount.amount,
      ccy: MONOBANK_CURRENCY_NUMBERS[MONOBANK_CURRENCY],
      merchantPaymInfo: {
        reference: input.paymentId,
        destination: description,
        ...(basketOrder === undefined ? {} : { basketOrder }),
      },
      redirectUrl: input.returnUrl,
      webHookUrl: input.webhookUrl,
      validity,
      paymentType: "debit" as const,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Answers

/** M4: `{invoiceId, pageUrl}` (+ `appUrl` with `withAppUrl`, not used). */
const createAnswerSchema = z.looseObject({
  invoiceId: z.string().regex(PROVIDER_PAYMENT_ID_PATTERN),
  pageUrl: z.string().max(MAX_URL_LENGTH),
});

/** Whether `pageUrl` may be handed to a browser: `https`, an allow-listed host, no credentials, no port. */
export function isAllowedPageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      MONOBANK_PAGE_HOSTS.includes(url.hostname) &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    // Not a URL: never sent to a browser.
    return false;
  }
}

export type CreateAnswer =
  | { readonly ok: true; readonly invoiceId: string; readonly pageUrl: string }
  | { readonly ok: false; readonly detail: "malformed_answer" | "page_host_not_allowed" };

export function readCreateAnswer(json: unknown): CreateAnswer {
  const parsed = createAnswerSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, detail: "malformed_answer" };
  }
  if (!isAllowedPageUrl(parsed.data.pageUrl)) {
    return { ok: false, detail: "page_host_not_allowed" };
  }
  return { ok: true, invoiceId: parsed.data.invoiceId, pageUrl: parsed.data.pageUrl };
}

/** RFC 3339 date-time as the spec declares (`format: date-time`), with a zone; nothing else is parsed. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function dateOf(value: string | undefined): Date | undefined {
  if (value === undefined || !DATE_TIME.test(value)) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

const integer = z.int();
const text = z.string().max(4096);

/** M13: the cancel answer `{status, createdDate, modifiedDate}`; only the status is read. */
const cancelAnswerSchema = z.looseObject({ status: z.string().max(32) });

const REFUND_STATUS: Readonly<Record<string, ProviderRefundStatus>> = Object.freeze({
  processing: "processing",
  success: "succeeded",
  failure: "failed",
});

export function readCancelAnswer(json: unknown): ProviderRefundStatus | undefined {
  const parsed = cancelAnswerSchema.safeParse(json);
  return parsed.success ? REFUND_STATUS[parsed.data.status] : undefined;
}

/** M6: the status answer (and the webhook body, M8). Lenient: unknown members are ignored, never kept. */
const statusAnswerSchema = z.looseObject({
  invoiceId: z.string().max(64),
  status: z.string().max(64),
  errCode: z
    .union([z.string().max(64), integer])
    .optional()
    .nullable(),
  amount: integer,
  ccy: integer,
  finalAmount: integer.optional().nullable(),
  createdDate: text.optional().nullable(),
  modifiedDate: text.optional().nullable(),
  reference: text.optional().nullable(),
  cancelList: z
    .array(
      z.looseObject({
        status: z.string().max(64),
        amount: integer.optional().nullable(),
        ccy: integer.optional().nullable(),
        createdDate: text.optional().nullable(),
        modifiedDate: text.optional().nullable(),
        extRef: text.optional().nullable(),
      }),
    )
    .max(PAYMENT_LIMITS.maxFactRefunds)
    .optional()
    .nullable(),
  paymentInfo: z
    .looseObject({
      maskedPan: text.optional().nullable(),
      paymentSystem: text.optional().nullable(),
    })
    .optional()
    .nullable(),
});

/** Monobank's invoice statuses (M6) to core's provider statuses (ADR 0032 decision 15). */
const PAYMENT_STATUS: Readonly<Record<string, ProviderPaymentStatus>> = Object.freeze({
  created: "created",
  processing: "processing",
  hold: "authorized",
  success: "succeeded",
  failure: "failed",
  reversed: "reversed",
  expired: "expired",
});

/** The card system and the last four digits only (question 12); `null` unless both are well-formed. */
function cardOf(
  info: { maskedPan?: string | null; paymentSystem?: string | null } | null | undefined,
) {
  const system = info?.paymentSystem?.trim().toLowerCase();
  const last4 = /([0-9]{4})$/.exec(info?.maskedPan?.trim() ?? "")?.[1];
  if (
    system === undefined ||
    last4 === undefined ||
    !PAYMENT_CARD_SYSTEM_PATTERN.test(system) ||
    !PAYMENT_CARD_LAST4_PATTERN.test(last4)
  ) {
    return null;
  }
  return Object.freeze({ system, last4 });
}

export type FactReading =
  | { readonly ok: true; readonly fact: ProviderPaymentFact }
  | {
      readonly ok: false;
      readonly detail: "malformed_answer" | "unsupported_currency" | "answer_mismatch";
    };

/**
 * A status answer or a webhook body as a `ProviderPaymentFact`, or why it cannot be one. Rules (each UNKNOWN that S1
 * checks is marked):
 * - `status` is mapped by `PAYMENT_STATUS`; an unknown status word is kept as `providerStatus` with `status: null`
 *   (core raises `unknown_provider_status` and changes nothing).
 * - `modifiedDate` is the fact's time (M10); when it is missing (the spec does not mark it required), `createdDate` is
 *   used: it is never later than a real change, so an older time can never override a newer fact. Without both: unreadable.
 * - `reference` is required: every invoice the plugin creates carries one (the attempt id).
 * - `ccy` is mapped to the core currency; an unknown number is unreadable (`unsupported_currency`).
 * - `cancelList[]` becomes `refunds`: our `extRef` when it is a code (a refund made elsewhere has none: `null`);
 *   `amount` is REQUIRED here although the spec does not mark it so (UNKNOWN; a refund without an amount cannot be
 *   accounted, so the whole answer is unreadable rather than a refund silently dropped); a `ccy` must equal the
 *   invoice's.
 * - `errCode` (M7, a payment error code) becomes `failureCode` when it is a short code, else `null`; `failureReason`
 *   (bank text) is never read.
 * - `expectedInvoiceId`: a status read must answer about the invoice asked for.
 * The result passes core's `providerPaymentFactProblems` or is unreadable.
 */
export function factOf(json: unknown, expectedInvoiceId?: string): FactReading {
  const parsed = statusAnswerSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, detail: "malformed_answer" };
  }
  const answer = parsed.data;
  if (expectedInvoiceId !== undefined && answer.invoiceId !== expectedInvoiceId) {
    return { ok: false, detail: "answer_mismatch" };
  }
  const currency = CURRENCY_OF_NUMBER.get(answer.ccy);
  if (currency === undefined) {
    return { ok: false, detail: "unsupported_currency" };
  }
  if (!PAYMENT_PROVIDER_STATUS_PATTERN.test(answer.status)) {
    return { ok: false, detail: "malformed_answer" };
  }
  const modifiedAt =
    dateOf(answer.modifiedDate ?? undefined) ?? dateOf(answer.createdDate ?? undefined);
  if (modifiedAt === undefined || answer.reference === undefined || answer.reference === null) {
    return { ok: false, detail: "malformed_answer" };
  }
  const refunds: ProviderRefundFact[] = [];
  for (const entry of answer.cancelList ?? []) {
    const status = REFUND_STATUS[entry.status];
    const refundAt =
      dateOf(entry.modifiedDate ?? undefined) ?? dateOf(entry.createdDate ?? undefined);
    if (
      status === undefined ||
      refundAt === undefined ||
      entry.amount === undefined ||
      entry.amount === null ||
      (entry.ccy !== undefined && entry.ccy !== null && entry.ccy !== answer.ccy)
    ) {
      return { ok: false, detail: "malformed_answer" };
    }
    const extRef = entry.extRef?.trim();
    refunds.push(
      Object.freeze({
        refundId: extRef !== undefined && PAYMENT_CODE_PATTERN.test(extRef) ? extRef : null,
        status,
        amount: Object.freeze({ amount: entry.amount, currency }),
        modifiedAt: refundAt,
      }),
    );
  }
  const failureCode =
    answer.errCode === undefined || answer.errCode === null ? null : String(answer.errCode);
  const fact: ProviderPaymentFact = Object.freeze({
    providerPaymentId: answer.invoiceId,
    reference: answer.reference,
    status: PAYMENT_STATUS[answer.status] ?? null,
    providerStatus: answer.status,
    amount: Object.freeze({ amount: answer.amount, currency }),
    finalAmount:
      answer.finalAmount === undefined || answer.finalAmount === null
        ? null
        : Object.freeze({ amount: answer.finalAmount, currency }),
    modifiedAt,
    failureCode:
      failureCode !== null && PAYMENT_CODE_PATTERN.test(failureCode) ? failureCode : null,
    refunds: Object.freeze(refunds),
    card: cardOf(answer.paymentInfo),
  });
  return providerPaymentFactProblems(fact).length === 0
    ? { ok: true, fact }
    : { ok: false, detail: "malformed_answer" };
}
