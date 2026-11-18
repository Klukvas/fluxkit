import { z } from "zod";
import {
  PAYMENT_CARD_LAST4_PATTERN,
  PAYMENT_CARD_SYSTEM_PATTERN,
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PAYMENT_PROVIDER_STATUS_PATTERN,
  providerPaymentFactProblems,
  type CreatePaymentInput,
  type Money,
  type ProviderPaymentFact,
  type ProviderPaymentStatus,
  type ProviderRefundFact,
  type ProviderRefundStatus,
  type SupportedCurrency,
} from "@fluxkit/core";
import { LIQPAY_CURRENCY, LIQPAY_VERSION } from "./config.js";
import { encodeData, signData } from "./signature.js";

/*
 * LiqPay checkout and status shapes (ADR 0059; public docs read 2026-11-18, never called live). Maps answers to
 * `ProviderPaymentFact`; never keeps full PAN or personal data.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const MAX_URL_LENGTH = 2048;

const LIQPAY_DATE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Minor units to LiqPay major amount (UAH: two decimal places, truncate toward zero). */
export function majorAmountOf(amount: Money): number {
  if (!Number.isSafeInteger(amount.amount) || amount.amount < 0) {
    return Number.NaN;
  }
  return Math.trunc(amount.amount) / 100;
}

/** LiqPay major amount to core minor units (rounding half away from zero via Math.round). */
export function minorAmountOf(major: number): number | undefined {
  if (!Number.isFinite(major) || major < 0) {
    return undefined;
  }
  const minor = Math.round(major * 100);
  return Number.isSafeInteger(minor) ? minor : undefined;
}

export function expiredDateOf(expiresAt: Date): string {
  const y = expiresAt.getUTCFullYear();
  const m = String(expiresAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(expiresAt.getUTCDate()).padStart(2, "0");
  const h = String(expiresAt.getUTCHours()).padStart(2, "0");
  const min = String(expiresAt.getUTCMinutes()).padStart(2, "0");
  const s = String(expiresAt.getUTCSeconds()).padStart(2, "0");
  return `${String(y)}-${m}-${d} ${h}:${min}:${s}`;
}

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH || CONTROL.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export type CreateRefusal =
  | "currency_not_supported"
  | "invalid_amount"
  | "invalid_payment_id"
  | "invalid_description"
  | "invalid_return_url"
  | "invalid_webhook_url"
  | "invalid_handoff_url"
  | "missing_handoff_url"
  | "invoice_expired";

export function validateCreateInput(
  input: CreatePaymentInput,
  now: Date = new Date(),
): CreateRefusal | undefined {
  if (input.amount.currency !== LIQPAY_CURRENCY) {
    return "currency_not_supported";
  }
  if (!Number.isSafeInteger(input.amount.amount) || input.amount.amount < 1) {
    return "invalid_amount";
  }
  if (typeof input.paymentId !== "string" || !UUID.test(input.paymentId)) {
    return "invalid_payment_id";
  }
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (
    description === "" ||
    [...description].length > PAYMENT_LIMITS.descriptionMaxLength ||
    CONTROL.test(description)
  ) {
    return "invalid_description";
  }
  if (!isHttpsUrl(input.returnUrl)) {
    return "invalid_return_url";
  }
  if (!isHttpsUrl(input.webhookUrl)) {
    return "invalid_webhook_url";
  }
  const handoff = input.handoffUrl;
  if (handoff === undefined || handoff === "") {
    return "missing_handoff_url";
  }
  if (!isHttpsUrl(handoff)) {
    return "invalid_handoff_url";
  }
  if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= now.getTime()) {
    return "invoice_expired";
  }
  return undefined;
}

export interface CheckoutParams {
  readonly action: "pay";
  readonly version: number;
  readonly public_key: string;
  readonly order_id: string;
  readonly amount: number;
  readonly currency: SupportedCurrency;
  readonly description: string;
  readonly result_url: string;
  readonly server_url: string;
  readonly expired_date: string;
}

export function checkoutParamsOf(
  input: CreatePaymentInput,
  publicKey: string,
  now: Date = new Date(),
): CheckoutParams | CreateRefusal {
  const refusal = validateCreateInput(input, now);
  if (refusal !== undefined) {
    return refusal;
  }
  const major = majorAmountOf(input.amount);
  if (!Number.isFinite(major) || major <= 0) {
    return "invalid_amount";
  }
  return {
    action: "pay",
    version: LIQPAY_VERSION,
    public_key: publicKey,
    order_id: input.paymentId,
    amount: major,
    currency: LIQPAY_CURRENCY,
    description: input.description.trim(),
    result_url: input.returnUrl,
    server_url: input.webhookUrl,
    expired_date: expiredDateOf(input.expiresAt),
  };
}

export function handoffFieldsOf(
  params: CheckoutParams,
  privateKey: string,
): { data: string; signature: string } {
  const data = encodeData(params);
  const signature = signData(data, privateKey);
  return { data, signature };
}

const PAYMENT_STATUS: Readonly<Record<string, ProviderPaymentStatus>> = Object.freeze({
  success: "succeeded",
  sandbox: "succeeded",
  failure: "failed",
  error: "failed",
  reversed: "reversed",
  processing: "processing",
  prepared: "processing",
  wait_accept: "processing",
  wait_secure: "processing",
  wait_lc: "processing",
  wait_capture: "processing",
  wait_sender: "processing",
  wait_card: "processing",
  wait_3ds: "processing",
  wait_crypto: "processing",
  wait_sender_card: "processing",
  hold_wait: "authorized",
  invoice_wait: "created",
  created: "created",
  expired: "expired",
});

const REFUND_STATUS: Readonly<Record<string, ProviderRefundStatus>> = Object.freeze({
  processing: "processing",
  success: "succeeded",
  sandbox: "succeeded",
  failure: "failed",
  error: "failed",
});

const statusSchema = z.looseObject({
  order_id: z.string().max(255),
  status: z.string().max(64),
  amount: z.number().optional().nullable(),
  currency: z.string().max(8).optional().nullable(),
  err_code: z.union([z.string().max(64), z.number()]).optional().nullable(),
  err_description: z.string().max(4096).optional().nullable(),
  sender_card_mask2: z.string().max(64).optional().nullable(),
  sender_card_mask: z.string().max(64).optional().nullable(),
  paytype: z.string().max(32).optional().nullable(),
  create_date: z.union([z.string().max(32), z.number()]).optional().nullable(),
  end_date: z.union([z.string().max(32), z.number()]).optional().nullable(),
  refunds: z
    .array(
      z.looseObject({
        status: z.string().max(64),
        amount: z.number().optional().nullable(),
        refund_id: z.string().max(64).optional().nullable(),
        refund_ref: z.string().max(64).optional().nullable(),
      }),
    )
    .max(PAYMENT_LIMITS.maxFactRefunds)
    .optional()
    .nullable(),
});

function dateOf(value: string | number | undefined | null): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }
  const text = String(value).trim();
  if (!LIQPAY_DATE.test(text) && !ISO_DATE.test(text)) {
    return undefined;
  }
  const normalized = text.includes("T") ? text : text.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function cardOf(mask: string | undefined | null, paytype: string | undefined | null) {
  const raw = (mask ?? "").trim();
  const last4 = /([0-9]{4})$/.exec(raw)?.[1];
  const system = (paytype ?? "").trim().toLowerCase();
  if (
    last4 === undefined ||
    system === "" ||
    !PAYMENT_CARD_LAST4_PATTERN.test(last4) ||
    !PAYMENT_CARD_SYSTEM_PATTERN.test(system)
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

export function factOf(json: unknown, expectedOrderId?: string): FactReading {
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, detail: "malformed_answer" };
  }
  const answer = parsed.data;
  if (expectedOrderId !== undefined && answer.order_id !== expectedOrderId) {
    return { ok: false, detail: "answer_mismatch" };
  }
  const currency = answer.currency?.trim().toUpperCase();
  if (currency !== LIQPAY_CURRENCY) {
    return { ok: false, detail: "unsupported_currency" };
  }
  if (!PAYMENT_PROVIDER_STATUS_PATTERN.test(answer.status)) {
    return { ok: false, detail: "malformed_answer" };
  }
  const modifiedAt =
    dateOf(answer.end_date ?? undefined) ?? dateOf(answer.create_date ?? undefined);
  if (modifiedAt === undefined) {
    return { ok: false, detail: "malformed_answer" };
  }
  const major = answer.amount;
  if (major === undefined || major === null) {
    return { ok: false, detail: "malformed_answer" };
  }
  const minor = minorAmountOf(major);
  if (minor === undefined || minor < 1) {
    return { ok: false, detail: "malformed_answer" };
  }
  const refunds: ProviderRefundFact[] = [];
  for (const entry of answer.refunds ?? []) {
    const status = REFUND_STATUS[entry.status];
    const entryMajor = entry.amount;
    if (status === undefined || entryMajor === undefined || entryMajor === null) {
      return { ok: false, detail: "malformed_answer" };
    }
    const entryMinor = minorAmountOf(entryMajor);
    if (entryMinor === undefined || entryMinor < 1) {
      return { ok: false, detail: "malformed_answer" };
    }
    const refundRef = entry.refund_ref?.trim() ?? entry.refund_id?.trim();
    refunds.push(
      Object.freeze({
        refundId:
          refundRef !== undefined && PAYMENT_CODE_PATTERN.test(refundRef) ? refundRef : null,
        status,
        amount: Object.freeze({ amount: entryMinor, currency: LIQPAY_CURRENCY }),
        modifiedAt,
      }),
    );
  }
  const failureCode =
    answer.err_code === undefined || answer.err_code === null ? null : String(answer.err_code);
  const fact: ProviderPaymentFact = Object.freeze({
    providerPaymentId: answer.order_id,
    reference: answer.order_id,
    status: PAYMENT_STATUS[answer.status] ?? null,
    providerStatus: answer.status,
    amount: Object.freeze({ amount: minor, currency: LIQPAY_CURRENCY }),
    finalAmount: null,
    modifiedAt,
    failureCode:
      failureCode !== null && PAYMENT_CODE_PATTERN.test(failureCode) ? failureCode : null,
    refunds: Object.freeze(refunds),
    card: cardOf(answer.sender_card_mask2 ?? answer.sender_card_mask, answer.paytype),
  });
  return providerPaymentFactProblems(fact).length === 0
    ? { ok: true, fact }
    : { ok: false, detail: "malformed_answer" };
}

export function readRefundStatus(json: unknown): ProviderRefundStatus | undefined {
  const parsed = statusSchema.safeParse(json);
  if (!parsed.success) {
    return undefined;
  }
  return REFUND_STATUS[parsed.data.status];
}

/** Parse `data` and `signature` from a raw urlencoded webhook body (exact bytes). */
export function parseWebhookForm(rawBody: Uint8Array): { data?: string; signature?: string } {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  const out: { data?: string; signature?: string } = {};
  for (const pair of text.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    const raw = eq < 0 ? "" : pair.slice(eq + 1);
    const value = decodeURIComponent(raw.replace(/\+/g, " "));
    if (key === "data") {
      out.data = value;
    } else if (key === "signature") {
      out.signature = value;
    }
  }
  return out;
}