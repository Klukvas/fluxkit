import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  buildPaymentLines,
  type CreatePaymentInput,
  type PaymentCheckoutHandoff,
  type PaymentLine,
  type PaymentProviderPort,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../common/locale.js";
import {
  notFound,
  paymentProviderUnavailable,
  ruleViolation,
  serviceUnavailable,
} from "../common/problem.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { OrdersRepository, type OrderRow } from "../orders/orders.repository.js";
import { PaymentsRepository, type PaymentRow } from "./attempts/payments.repository.js";
import { moneyOf } from "./payment-facts.service.js";
import { paymentDescription, snapshotText } from "./payment-messages.js";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { PaymentProviderRegistry } from "./registry/index.js";

/** Allowed `actionUrl` hosts for form handoff (ADR 0059). */
const HANDOFF_ACTION_HOSTS = Object.freeze(["www.liqpay.ua"]);

export type PaymentHandoffRefusal =
  "payment_not_waiting" | "handoff_unavailable" | "payment_not_available";

/**
 * Builds a fresh signed checkout form for a live `awaiting_customer` attempt of a form-handoff provider (ADR 0059).
 * Ownership is checked by the store routes before this runs.
 */
@Injectable()
export class PaymentHandoffService {
  private readonly logger = new Logger(PaymentHandoffService.name);

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(LOCALE_CONFIG) private readonly locales: LocaleConfig,
  ) {}

  async handoffForAttempt(order: OrderRow, paymentId: string): Promise<PaymentCheckoutHandoff> {
    const row = await this.payments.findById(this.database, paymentId);
    if (row === undefined || row.orderId !== order.id) {
      throw notFound("Payment");
    }
    if (row.status !== "awaiting_customer") {
      throw ruleViolation("This payment is not waiting for the shopper.", "payment_not_waiting");
    }
    const provider = this.registry.get(row.providerCode);
    if (provider === undefined || !provider.capabilities.formHandoff) {
      throw ruleViolation("Form checkout handoff is not available.", "handoff_unavailable");
    }
    const input = await this.createInput(order, row, provider);
    const verified = await callPaymentProvider(
      (signal) => provider.buildCheckoutHandoff(input, signal),
      this.config.providerTimeoutMs,
    );
    if (!verified.result.ok) {
      this.logger.warn(`buildCheckoutHandoff ${provider.code}: ${describePaymentCall(verified)}`);
      if (verified.result.reason === "not_sent" || verified.result.reason === "rejected") {
        throw ruleViolation("Form checkout handoff is not available.", "handoff_unavailable");
      }
      throw paymentProviderUnavailable(verified.result.retryAfterSeconds ?? 30, {
        paymentId: row.id,
        status: "waiting",
        canRetry: true,
      });
    }
    const handoff = verified.result.value;
    if (!isSafeHandoff(handoff)) {
      this.logger.error(
        `buildCheckoutHandoff ${provider.code}: refused an unsafe actionUrl or fields shape`,
      );
      throw serviceUnavailable(5);
    }
    return handoff;
  }

  private async createInput(
    order: OrderRow,
    row: PaymentRow,
    provider: PaymentProviderPort,
  ): Promise<CreatePaymentInput> {
    // Prefer the locale baked into the attempt's redirect URL at create (shopper request locale),
    // not only `order.locale`, so a guest paying from `/en/...` on a `uk` order keeps `en` URLs.
    const locale = localeForHandoff(row.redirectUrl, order.locale, this.locales.locales);
    const base = (this.config.storefrontPublicUrl ?? "").replace(/\/+$/, "");
    const amount = moneyOf(row.amount, row.currency);
    const handoffUrl = `${base}/${encodeURIComponent(locale)}/payment/handoff?payment=${row.id}`;
    return {
      paymentId: row.id,
      orderNumber: order.number,
      amount,
      description: paymentDescription(order.number, [locale, order.locale]),
      lines: await this.basket(order, amount, [locale, order.locale]),
      returnUrl: `${base}/${encodeURIComponent(locale)}/payment/return?payment=${row.id}`,
      webhookUrl: `${base}/webhooks/payments/${encodeURIComponent(provider.code)}`,
      expiresAt: row.expiresAt,
      handoffUrl,
    };
  }

  private async basket(
    order: OrderRow,
    amount: ReturnType<typeof moneyOf>,
    locales: readonly string[],
  ): Promise<readonly PaymentLine[]> {
    const lines = await this.payments.basketLines(this.database, order.id);
    const shipping = await this.payments.basketShipping(this.database, order.id);
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
}

/**
 * Locale for signed `result_url` / handoff URLs: the path segment from the stored create redirect
 * (`/{locale}/payment/handoff`), else the order locale, else the first configured locale.
 */
export function localeForHandoff(
  redirectUrl: string | null,
  orderLocale: string,
  locales: readonly string[],
): string {
  const fromRedirect = localeFromPaymentRedirect(redirectUrl);
  if (fromRedirect !== undefined && locales.includes(fromRedirect)) {
    return fromRedirect;
  }
  if (locales.includes(orderLocale)) {
    return orderLocale;
  }
  return locales[0] as string;
}

function localeFromPaymentRedirect(redirectUrl: string | null): string | undefined {
  if (redirectUrl === null || redirectUrl === "") {
    return undefined;
  }
  try {
    const path = new URL(redirectUrl).pathname;
    const match = /^\/([^/]+)\/payment\/(?:handoff|return)(?:\/|$)/.exec(path);
    return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function isSafeHandoff(value: PaymentCheckoutHandoff): boolean {
  if (
    typeof value.actionUrl !== "string" ||
    typeof value.fields !== "object" ||
    value.fields === null
  ) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(value.actionUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
    return false;
  }
  if (!HANDOFF_ACTION_HOSTS.includes(url.hostname)) {
    return false;
  }
  const entries = Object.entries(value.fields);
  if (entries.length < 1 || entries.length > 16) {
    return false;
  }
  for (const [key, field] of entries) {
    if (
      typeof key !== "string" ||
      key.length < 1 ||
      key.length > 64 ||
      typeof field !== "string" ||
      field.length < 1 ||
      field.length > 16_384
    ) {
      return false;
    }
  }
  return true;
}
