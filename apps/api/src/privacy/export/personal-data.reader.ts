import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import {
  normalizeEmail,
  resolveTextWithFallback,
  type ExportAddressFacts,
  type ExportCartFacts,
  type ExportMailFacts,
  type ExportOrderFacts,
  type ExportProcessorFacts,
  type ExportSessionFacts,
  type I18nText,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import type { DbExecutor } from "../../common/transaction.js";
import {
  cart,
  cartItem,
  customer,
  customerSession,
  emailMessage,
  orderAdjustment,
  orderItem,
  orderShipping,
  orderStatusChange,
  payment,
  paymentRefund,
  product,
  salesOrder,
  shipment,
  variant,
} from "../../database/schema/index.js";
import { EmailProviderRegistry } from "../../email/registry/index.js";
import { PaymentProviderRegistry } from "../../payments/registry/index.js";
import { ShippingProviderRegistry } from "../../shipping/registry/index.js";
import {
  customerSubject,
  emailSubject,
  subjectMailCondition,
  subjectOrdersCondition,
  type ResolvedSubject,
} from "../subject.js";

export type { ResolvedSubject } from "../subject.js";

/** The export is synchronous; a subject with more orders is exported by the shop owner another way (ADR 0033 decision 1). */
export const EXPORT_MAX_ORDERS = 10_000;

export type CustomerRow = typeof customer.$inferSelect;
export type OrderRow = typeof salesOrder.$inferSelect;

type Texts = Record<string, string>;

function textsOf(value: unknown): Texts {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Texts = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function addressOf(value: unknown): ExportAddressFacts | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record["countryCode"] !== "string") return null;
  const result: Record<string, string> = { countryCode: record["countryCode"] };
  for (const key of [
    "region",
    "city",
    "postalCode",
    "line1",
    "line2",
    "recipientFirstName",
    "recipientLastName",
    "recipientPhone",
  ]) {
    const entry = record[key];
    if (typeof entry === "string") result[key] = entry;
  }
  return result as unknown as ExportAddressFacts;
}

function group<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const list = map.get(key(row)) ?? [];
    list.push(row);
    map.set(key(row), list);
  }
  return map;
}

/**
 * Reads the personal data of one subject for the export (ADR 0033 decision 7): the account, every order in the subject's
 * scope (`subjectOrdersCondition`, ADR 0035), their lines, adjustments, journal, shipping snapshot, shipments and payments with
 * refunds, the mail rows in scope, the sessions and the cart. A fixed number of statements whatever the
 * number of orders (no N+1). Returns facts for core `buildPersonalDataExport`, which copies only the allowed keys.
 */
@Injectable()
export class PersonalDataReader {
  constructor(
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(EmailProviderRegistry) private readonly emailProviders: EmailProviderRegistry,
    @Inject(PaymentProviderRegistry) private readonly paymentProviders: PaymentProviderRegistry,
    @Inject(ShippingProviderRegistry) private readonly shippingProviders: ShippingProviderRegistry,
  ) {}

  /** The subject of an account id; undefined when the account does not exist. */
  async byCustomer(db: DbExecutor, customerId: string): Promise<ResolvedSubject | undefined> {
    const [row] = await db.select().from(customer).where(eq(customer.id, customerId));
    return row === undefined ? undefined : customerSubject(row);
  }

  /** The subject of an email: its account if one exists with that address, and its guest data. */
  async byEmail(db: DbExecutor, email: string): Promise<ResolvedSubject> {
    const normalized = normalizeEmail(email);
    const [row] = await db.select().from(customer).where(eq(customer.email, normalized));
    return emailSubject(normalized, row);
  }

  async countOrders(db: DbExecutor, subject: ResolvedSubject): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(salesOrder)
      .where(subjectOrdersCondition(subject.scope));
    return row?.value ?? 0;
  }

  async listOrders(db: DbExecutor, subject: ResolvedSubject): Promise<OrderRow[]> {
    return db
      .select()
      .from(salesOrder)
      .where(subjectOrdersCondition(subject.scope))
      .orderBy(asc(salesOrder.placedAt), asc(salesOrder.id));
  }

  async orderFacts(db: DbExecutor, orders: readonly OrderRow[]): Promise<ExportOrderFacts[]> {
    if (orders.length === 0) return [];
    const ids = orders.map((row) => row.id);
    const [items, adjustments, history, shippings, shipments, payments] = await Promise.all([
      db
        .select()
        .from(orderItem)
        .where(inArray(orderItem.orderId, ids))
        .orderBy(asc(orderItem.orderId), asc(orderItem.position)),
      db
        .select()
        .from(orderAdjustment)
        .where(inArray(orderAdjustment.orderId, ids))
        .orderBy(asc(orderAdjustment.createdAt), asc(orderAdjustment.id)),
      db
        .select()
        .from(orderStatusChange)
        .where(inArray(orderStatusChange.orderId, ids))
        .orderBy(asc(orderStatusChange.createdAt), asc(orderStatusChange.id)),
      db.select().from(orderShipping).where(inArray(orderShipping.orderId, ids)),
      db
        .select()
        .from(shipment)
        .where(inArray(shipment.orderId, ids))
        .orderBy(asc(shipment.createdAt), asc(shipment.id)),
      db
        .select()
        .from(payment)
        .where(inArray(payment.orderId, ids))
        .orderBy(asc(payment.createdAt), asc(payment.id)),
    ]);
    const refunds =
      payments.length === 0
        ? []
        : await db
            .select()
            .from(paymentRefund)
            .where(
              inArray(
                paymentRefund.paymentId,
                payments.map((row) => row.id),
              ),
            )
            .orderBy(asc(paymentRefund.createdAt), asc(paymentRefund.id));
    const itemsOf = group(items, (row) => row.orderId);
    const adjustmentsOf = group(adjustments, (row) => row.orderId);
    const historyOf = group(history, (row) => row.orderId);
    const shippingOf = new Map(shippings.map((row) => [row.orderId, row]));
    const shipmentsOf = group(shipments, (row) => row.orderId);
    const paymentsOf = group(payments, (row) => row.orderId);
    const refundsOf = group(refunds, (row) => row.paymentId);

    return orders.map((order): ExportOrderFacts => {
      const text = (value: unknown): string =>
        resolveTextWithFallback(
          textsOf(value) as I18nText,
          order.locale,
          this.locale.defaultLocale,
        ) ?? "";
      const shipping = shippingOf.get(order.id);
      return {
        number: order.number,
        status: order.status,
        locale: order.locale,
        currency: order.currency,
        subtotalAmount: order.subtotalAmount,
        shippingTotal: order.shippingTotal,
        discountTotal: order.discountTotal,
        taxTotal: order.taxTotal,
        totalAmount: order.totalAmount,
        placedAt: order.placedAt,
        expiresAt: order.expiresAt,
        paidAt: order.paidAt,
        fulfilledAt: order.fulfilledAt,
        cancelledAt: order.cancelledAt,
        expiredAt: order.expiredAt,
        cancellationReason: order.cancellationReason,
        paymentReference: order.paymentReference,
        contact: {
          email: order.email,
          phone: order.phone,
          firstName: order.firstName,
          lastName: order.lastName,
        },
        shippingAddress: addressOf(order.shippingAddress),
        billingAddress: addressOf(order.billingAddress),
        lines: (itemsOf.get(order.id) ?? []).map((row) => {
          const options: Record<string, string> = {};
          if (Array.isArray(row.optionValues)) {
            for (const entry of row.optionValues as { option?: unknown; value?: unknown }[]) {
              options[text(entry.option)] = text(entry.value);
            }
          }
          return {
            position: row.position,
            sku: row.sku,
            productTitle: text(row.productTitle),
            variantTitle: row.variantTitle === null ? null : text(row.variantTitle),
            optionValues: Object.keys(options).length === 0 ? null : options,
            unitAmount: row.unitAmount,
            compareAtAmount: row.compareAtAmount,
            quantity: row.quantity,
            lineTotal: row.lineTotal,
            currency: row.currency,
            requiresShipping: row.requiresShipping,
          };
        }),
        adjustments: (adjustmentsOf.get(order.id) ?? []).map((row) => ({
          kind: row.kind,
          code: row.code,
          label: text(row.label),
          amount: row.amount,
          includedInPrice: row.includedInPrice,
          // TODO(fluxkit): the v1 format has a string here; a NULL source (no source recorded) is exported as "".
          source: row.source ?? "",
        })),
        shippingMethod:
          shipping === undefined
            ? null
            : {
                methodCode: shipping.methodCode,
                kind: shipping.kind,
                providerCode: shipping.providerCode,
                title: text(shipping.title),
                amount: shipping.amount,
                currency: shipping.currency,
                destination:
                  shipping.destination !== null &&
                  typeof shipping.destination === "object" &&
                  !Array.isArray(shipping.destination)
                    ? (shipping.destination as Record<string, unknown>)
                    : null,
              },
        shipments: (shipmentsOf.get(order.id) ?? []).map((row) => ({
          providerCode: row.providerCode,
          status: row.status,
          trackingNumber: row.trackingNumber,
          createdAt: row.createdAt,
          deliveredAt: row.deliveredAt,
        })),
        payments: (paymentsOf.get(order.id) ?? []).map((row) => ({
          providerCode: row.providerCode,
          status: row.status,
          amount: row.amount,
          currency: row.currency,
          refundedAmount: row.refundedAmount,
          cardSystem: row.cardSystem,
          cardLast4: row.cardLast4,
          createdAt: row.createdAt,
          refunds: (refundsOf.get(row.id) ?? []).map((refund) => ({
            amount: refund.amount,
            currency: refund.currency,
            status: refund.status,
            reason: refund.reason,
            createdAt: refund.createdAt,
          })),
        })),
        statusHistory: (historyOf.get(order.id) ?? []).map((row) => ({
          fromStatus: row.fromStatus,
          toStatus: row.toStatus,
          actorType: row.actorType,
          reason: row.reason,
          createdAt: row.createdAt,
        })),
      };
    });
  }

  async mailFacts(db: DbExecutor, subject: ResolvedSubject): Promise<ExportMailFacts[]> {
    const rows = await db
      .select({
        templateKey: emailMessage.templateKey,
        locale: emailMessage.locale,
        status: emailMessage.status,
        createdAt: emailMessage.createdAt,
        sentAt: emailMessage.sentAt,
      })
      .from(emailMessage)
      .where(subjectMailCondition(subject.scope))
      .orderBy(asc(emailMessage.createdAt), asc(emailMessage.id));
    return rows;
  }

  async countMail(db: DbExecutor, subject: ResolvedSubject): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(emailMessage)
      .where(subjectMailCondition(subject.scope));
    return row?.value ?? 0;
  }

  async sessionFacts(db: DbExecutor, subject: ResolvedSubject): Promise<ExportSessionFacts[]> {
    if (subject.customer === undefined) return [];
    return db
      .select({ createdAt: customerSession.createdAt, lastSeenAt: customerSession.lastSeenAt })
      .from(customerSession)
      .where(eq(customerSession.customerId, subject.customer.id))
      .orderBy(asc(customerSession.createdAt), asc(customerSession.id));
  }

  async cartFacts(db: DbExecutor, subject: ResolvedSubject): Promise<ExportCartFacts | null> {
    if (subject.customer === undefined) return null;
    const [owned] = await db
      .select({ id: cart.id })
      .from(cart)
      .where(eq(cart.customerId, subject.customer.id));
    if (owned === undefined) return null;
    const lines = await db
      .select({
        sku: variant.sku,
        productTitle: product.title,
        variantTitle: variant.title,
        quantity: cartItem.quantity,
        seenUnitAmount: cartItem.seenUnitAmount,
        seenCurrency: cartItem.seenCurrency,
      })
      .from(cartItem)
      .innerJoin(variant, eq(variant.id, cartItem.variantId))
      .innerJoin(product, eq(product.id, variant.productId))
      .where(and(eq(cartItem.cartId, owned.id)))
      .orderBy(asc(cartItem.createdAt), asc(cartItem.id));
    const locale = this.locale.defaultLocale;
    return {
      lines: lines.map((line) => ({
        sku: line.sku,
        title: resolveTextWithFallback(line.productTitle, locale, locale) ?? line.sku,
        quantity: line.quantity,
        // TODO(fluxkit): the v1 format has numbers here; a line without a seen price (never shown) is exported as 0 and "".
        seenUnitAmount: line.seenUnitAmount ?? 0,
        seenCurrency: line.seenCurrency ?? "",
      })),
    };
  }

  /** The providers the shop uses (codes); no legal role is stated (ADR 0033 decision 7). */
  processors(): ExportProcessorFacts[] {
    const email = this.emailProviders.get();
    return [
      ...(email === undefined ? [] : [{ kind: "email" as const, name: email.code }]),
      ...this.paymentProviders.list().map((provider) => ({
        kind: "payment" as const,
        name: provider.code,
      })),
      ...this.shippingProviders.list().map((provider) => ({
        kind: "shipping" as const,
        name: provider.code,
      })),
    ];
  }
}
