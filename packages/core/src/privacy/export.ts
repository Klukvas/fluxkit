/*
 * The personal-data export document `fluxkit.personal-data-export/v1` (ADR 0033 decision 7; a public contract, see
 * `docs/contracts/personal-data-export.md`). `buildPersonalDataExport` takes facts the API has already selected for one
 * subject and copies ONLY the keys listed here, in a fixed order, with times as ISO strings and money as minor-unit
 * integers with a currency. Extra keys in the facts (hashes, internal ids, idempotency keys, provider references) are never
 * copied, so a careless query cannot leak them. Pure: the clock is the `generatedAt` fact.
 * The document does not state any legal role of the processors it lists.
 * TODO(fluxkit): legal review of the processor list wording before an EU launch.
 */

export const PERSONAL_DATA_EXPORT_FORMAT = "fluxkit.personal-data-export/v1";

/** Key names a document must never contain (any depth). `findForbiddenExportKeys` also flags secret-looking and `*Id` keys. */
export const EXPORT_FORBIDDEN_KEYS = Object.freeze([
  "passwordHash",
  "tokenHash",
  "accessTokenHash",
  "requestFingerprint",
  "idempotencyKey",
  "providerRef",
  "providerPaymentId",
  "redirectUrl",
  "actorAdminId",
  "createdBy",
  "failedLoginCount",
  "lockedUntil",
] as const);

/** `passwordChangedAt` is a date the person may see; a key that IS a password (or ends in one) is not. */
const SECRET_LOOKING = /(hash|secret|token|idempotency|fingerprint|^password$|Password$)/i;
const INTERNAL_ID = /(^id$|Id$)/;

function isForbiddenKey(key: string): boolean {
  return (
    (EXPORT_FORBIDDEN_KEYS as readonly string[]).includes(key) ||
    SECRET_LOOKING.test(key) ||
    INTERNAL_ID.test(key)
  );
}

/** Paths (`a.b[2].c`) of every forbidden key in a document or any other JSON-like value. Empty means clean. */
export function findForbiddenExportKeys(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findForbiddenExportKeys(entry, `${path}[${String(index)}]`),
    );
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return Object.entries(value).flatMap(([key, entry]) => {
      const here = path === "" ? key : `${path}.${key}`;
      return [...(isForbiddenKey(key) ? [here] : []), ...findForbiddenExportKeys(entry, here)];
    });
  }
  return [];
}

export interface ExportAddressFacts {
  readonly countryCode: string;
  readonly region?: string;
  readonly city?: string;
  readonly postalCode?: string;
  readonly line1?: string;
  readonly line2?: string;
  readonly recipientFirstName?: string;
  readonly recipientLastName?: string;
  readonly recipientPhone?: string;
}

export interface ExportContactFacts {
  readonly email: string | null;
  readonly phone: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface ExportAccountFacts {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly isActive: boolean;
  readonly emailVerifiedAt: Date | null;
  readonly lastLoginAt: Date | null;
  readonly passwordChangedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ExportLineFacts {
  readonly position: number;
  readonly sku: string;
  readonly productTitle: string;
  readonly variantTitle: string | null;
  readonly optionValues: Readonly<Record<string, string>> | null;
  readonly unitAmount: number;
  readonly compareAtAmount: number | null;
  readonly quantity: number;
  readonly lineTotal: number;
  readonly currency: string;
  readonly requiresShipping: boolean;
}

export interface ExportAdjustmentFacts {
  readonly kind: string;
  readonly code: string;
  readonly label: string;
  readonly amount: number;
  readonly includedInPrice: boolean;
  readonly source: string;
}

export interface ExportShippingMethodFacts {
  readonly methodCode: string;
  readonly kind: string;
  readonly providerCode: string | null;
  readonly title: string;
  readonly amount: number;
  readonly currency: string;
  /** Public pickup point data of the carrier, or null. */
  readonly destination: Readonly<Record<string, unknown>> | null;
}

export interface ExportShipmentFacts {
  readonly providerCode: string;
  readonly status: string;
  readonly trackingNumber: string | null;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}

export interface ExportRefundFacts {
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly reason: string;
  readonly createdAt: Date;
}

export interface ExportPaymentFacts {
  readonly providerCode: string;
  readonly status: string;
  readonly amount: number;
  readonly currency: string;
  readonly refundedAmount: number;
  readonly cardSystem: string | null;
  readonly cardLast4: string | null;
  readonly createdAt: Date;
  readonly refunds: readonly ExportRefundFacts[];
}

export interface ExportStatusChangeFacts {
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly actorType: string;
  readonly reason: string | null;
  readonly createdAt: Date;
}

export interface ExportOrderFacts {
  readonly number: string;
  readonly status: string;
  readonly locale: string;
  readonly currency: string;
  readonly subtotalAmount: number;
  readonly shippingTotal: number;
  readonly discountTotal: number;
  readonly taxTotal: number;
  readonly totalAmount: number;
  readonly placedAt: Date;
  readonly expiresAt: Date;
  readonly paidAt: Date | null;
  readonly fulfilledAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly expiredAt: Date | null;
  readonly cancellationReason: string | null;
  readonly paymentReference: string | null;
  readonly contact: ExportContactFacts;
  readonly shippingAddress: ExportAddressFacts | null;
  readonly billingAddress: ExportAddressFacts | null;
  readonly lines: readonly ExportLineFacts[];
  readonly adjustments: readonly ExportAdjustmentFacts[];
  readonly shippingMethod: ExportShippingMethodFacts | null;
  readonly shipments: readonly ExportShipmentFacts[];
  readonly payments: readonly ExportPaymentFacts[];
  readonly statusHistory: readonly ExportStatusChangeFacts[];
}

export interface ExportMailFacts {
  readonly templateKey: string;
  readonly locale: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly sentAt: Date | null;
}

export interface ExportSessionFacts {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
}

export interface ExportCartFacts {
  readonly lines: readonly {
    readonly sku: string;
    readonly title: string;
    readonly quantity: number;
    readonly seenUnitAmount: number;
    readonly seenCurrency: string;
  }[];
}

export interface ExportProcessorFacts {
  readonly kind: "email" | "payment" | "shipping";
  readonly name: string;
}

export interface PersonalDataExportFacts {
  readonly generatedAt: Date;
  readonly subject: { readonly kind: "customer" | "email" };
  readonly account: ExportAccountFacts | null;
  readonly orders: readonly ExportOrderFacts[];
  readonly mail: readonly ExportMailFacts[];
  readonly sessions: readonly ExportSessionFacts[];
  readonly cart: ExportCartFacts | null;
  readonly processors: readonly ExportProcessorFacts[];
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date === null ? null : iso(date));

function address(facts: ExportAddressFacts | null) {
  if (facts === null) return null;
  return {
    countryCode: facts.countryCode,
    ...(facts.region === undefined ? {} : { region: facts.region }),
    ...(facts.city === undefined ? {} : { city: facts.city }),
    ...(facts.postalCode === undefined ? {} : { postalCode: facts.postalCode }),
    ...(facts.line1 === undefined ? {} : { line1: facts.line1 }),
    ...(facts.line2 === undefined ? {} : { line2: facts.line2 }),
    ...(facts.recipientFirstName === undefined
      ? {}
      : { recipientFirstName: facts.recipientFirstName }),
    ...(facts.recipientLastName === undefined
      ? {}
      : { recipientLastName: facts.recipientLastName }),
    ...(facts.recipientPhone === undefined ? {} : { recipientPhone: facts.recipientPhone }),
  };
}

/** Public data of a pickup point: only keys that are not secret-looking or internal ids, shallow copies of simple values. */
function publicRecord(
  record: Readonly<Record<string, unknown>> | null,
): Record<string, string | number | boolean | null> | null {
  if (record === null) return null;
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isForbiddenKey(key)) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      result[key] = value as string | number | boolean | null;
    }
  }
  return result;
}

function optionValues(
  values: Readonly<Record<string, string>> | null,
): Record<string, string> | null {
  if (values === null) return null;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!isForbiddenKey(key) && typeof value === "string") result[key] = value;
  }
  return result;
}

function order(facts: ExportOrderFacts) {
  return {
    number: facts.number,
    status: facts.status,
    locale: facts.locale,
    currency: facts.currency,
    subtotalAmount: facts.subtotalAmount,
    shippingTotal: facts.shippingTotal,
    discountTotal: facts.discountTotal,
    taxTotal: facts.taxTotal,
    totalAmount: facts.totalAmount,
    placedAt: iso(facts.placedAt),
    expiresAt: iso(facts.expiresAt),
    paidAt: isoOrNull(facts.paidAt),
    fulfilledAt: isoOrNull(facts.fulfilledAt),
    cancelledAt: isoOrNull(facts.cancelledAt),
    expiredAt: isoOrNull(facts.expiredAt),
    cancellationReason: facts.cancellationReason,
    paymentReference: facts.paymentReference,
    contact: {
      email: facts.contact.email,
      phone: facts.contact.phone,
      firstName: facts.contact.firstName,
      lastName: facts.contact.lastName,
    },
    shippingAddress: address(facts.shippingAddress),
    billingAddress: address(facts.billingAddress),
    lines: facts.lines.map((line) => ({
      position: line.position,
      sku: line.sku,
      productTitle: line.productTitle,
      variantTitle: line.variantTitle,
      optionValues: optionValues(line.optionValues),
      unitAmount: line.unitAmount,
      compareAtAmount: line.compareAtAmount,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      currency: line.currency,
      requiresShipping: line.requiresShipping,
    })),
    adjustments: facts.adjustments.map((adjustment) => ({
      kind: adjustment.kind,
      code: adjustment.code,
      label: adjustment.label,
      amount: adjustment.amount,
      includedInPrice: adjustment.includedInPrice,
      source: adjustment.source,
    })),
    shippingMethod:
      facts.shippingMethod === null
        ? null
        : {
            methodCode: facts.shippingMethod.methodCode,
            kind: facts.shippingMethod.kind,
            providerCode: facts.shippingMethod.providerCode,
            title: facts.shippingMethod.title,
            amount: facts.shippingMethod.amount,
            currency: facts.shippingMethod.currency,
            destination: publicRecord(facts.shippingMethod.destination),
          },
    shipments: facts.shipments.map((shipment) => ({
      providerCode: shipment.providerCode,
      status: shipment.status,
      trackingNumber: shipment.trackingNumber,
      createdAt: iso(shipment.createdAt),
      deliveredAt: isoOrNull(shipment.deliveredAt),
    })),
    payments: facts.payments.map((payment) => ({
      providerCode: payment.providerCode,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      refundedAmount: payment.refundedAmount,
      cardSystem: payment.cardSystem,
      cardLast4: payment.cardLast4,
      createdAt: iso(payment.createdAt),
      refunds: payment.refunds.map((refund) => ({
        amount: refund.amount,
        currency: refund.currency,
        status: refund.status,
        reason: refund.reason,
        createdAt: iso(refund.createdAt),
      })),
    })),
    statusHistory: facts.statusHistory.map((change) => ({
      fromStatus: change.fromStatus,
      toStatus: change.toStatus,
      actorType: change.actorType,
      reason: change.reason,
      createdAt: iso(change.createdAt),
    })),
  };
}

export type PersonalDataExport = ReturnType<typeof buildPersonalDataExport>;

export function buildPersonalDataExport(facts: PersonalDataExportFacts) {
  if (Number.isNaN(facts.generatedAt.getTime())) {
    throw new RangeError("The export time is not a valid date");
  }
  return {
    format: PERSONAL_DATA_EXPORT_FORMAT,
    generatedAt: iso(facts.generatedAt),
    subject: { kind: facts.subject.kind },
    account:
      facts.account === null
        ? null
        : {
            email: facts.account.email,
            firstName: facts.account.firstName,
            lastName: facts.account.lastName,
            phone: facts.account.phone,
            isActive: facts.account.isActive,
            emailVerifiedAt: isoOrNull(facts.account.emailVerifiedAt),
            lastLoginAt: isoOrNull(facts.account.lastLoginAt),
            passwordChangedAt: isoOrNull(facts.account.passwordChangedAt),
            createdAt: iso(facts.account.createdAt),
            updatedAt: iso(facts.account.updatedAt),
          },
    orders: facts.orders.map(order),
    mail: facts.mail.map((mail) => ({
      templateKey: mail.templateKey,
      locale: mail.locale,
      status: mail.status,
      createdAt: iso(mail.createdAt),
      sentAt: isoOrNull(mail.sentAt),
    })),
    sessions: facts.sessions.map((session) => ({
      createdAt: iso(session.createdAt),
      lastSeenAt: iso(session.lastSeenAt),
    })),
    cart:
      facts.cart === null
        ? null
        : {
            lines: facts.cart.lines.map((line) => ({
              sku: line.sku,
              title: line.title,
              quantity: line.quantity,
              seenUnitAmount: line.seenUnitAmount,
              seenCurrency: line.seenCurrency,
            })),
          },
    processors: facts.processors.map((processor) => ({
      kind: processor.kind,
      name: processor.name,
    })),
  };
}
