import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { asc, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  decideErasure,
  planOrderAnonymisation,
  type ErasureBlocker,
  type ErasureOrderFacts,
  type OrderStatus,
  type PaymentStatus,
  type RefundStatus,
  type ShipmentStatus,
} from "@fluxkit/core";
import { ProblemException } from "../../common/problem.js";
import type { Transaction } from "../../common/transaction.js";
import {
  customer,
  emailMessage,
  payment,
  paymentRefund,
  salesOrder,
  shipment,
} from "../../database/schema/index.js";
import type { ResolvedSubject } from "../export/personal-data.reader.js";

/** A mail to the subject that a sender holds under a live lease: wait for it (the lease is 2 minutes) and try again. */
export const MAIL_SENDING_REASON = "mail_sending";

export type ErasureReason = ErasureBlocker["reason"] | typeof MAIL_SENDING_REASON;

/** Counts, codes and the erased order numbers and customer id only: what `privacy_request.result` keeps. */
export interface ErasureResult {
  readonly ordersAnonymised: number;
  readonly mailDeleted: number;
  readonly customerDeleted: boolean;
  readonly orderNumbers: readonly string[];
  readonly customerId?: string;
}

export interface ErasurePreview {
  readonly accountFound: boolean;
  readonly orders: number;
  readonly ordersToAnonymise: number;
  readonly mail: number;
  readonly blockers: readonly {
    readonly orderNumber: string | null;
    readonly reason: ErasureReason;
  }[];
  readonly reasons: readonly ErasureReason[];
}

/** `409 rule_violation` `erasure_blocked` with the reasons and the blocking orders; nothing was changed. */
export function erasureBlocked(
  blockers: readonly { readonly orderNumber: string | null; readonly reason: ErasureReason }[],
): ProblemException {
  return new ProblemException({
    code: "rule_violation",
    detail: "Something of this person is still in progress; nothing was changed.",
    extensions: { rule: "erasure_blocked" },
    members: { reasons: reasonsOf(blockers), blockers: blockers.map((entry) => ({ ...entry })) },
  });
}

function reasonsOf(blockers: readonly { readonly reason: ErasureReason }[]): ErasureReason[] {
  return [...new Set(blockers.map((entry) => entry.reason))];
}

/** SHA-256 (hex) of 32 random bytes: the new `request_fingerprint` of an anonymised order. */
function randomFingerprint(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

interface Gathered {
  readonly orders: readonly (typeof salesOrder.$inferSelect)[];
  readonly facts: readonly ErasureOrderFacts[];
  readonly mailIds: readonly string[];
  readonly sendingMail: boolean;
}

/**
 * The erasure of one data subject (ADR 0033 decision 6). Runs in the CALLER's transaction and takes its locks in one
 * order: the customer row, then the subject's orders by id, then the subject's mail rows. Under the locks it re-reads
 * every status, asks core `decideErasure` and either refuses with every blocker (nothing changed) or anonymises the
 * contact fields of each order with core `planOrderAnonymisation`, deletes the mail rows and deletes the customer row
 * (sessions, cart and tokens cascade; `sales_order.customer_id` becomes NULL). Orders, lines, totals, payments, refunds,
 * shipments and journals are never deleted or changed beyond the contact fields.
 */
@Injectable()
export class PrivacyErasureService {
  private ordersCondition(subject: ResolvedSubject): SQL {
    const byEmail = eq(salesOrder.email, subject.email);
    return subject.customer === undefined
      ? byEmail
      : (or(eq(salesOrder.customerId, subject.customer.id), byEmail) as SQL);
  }

  private mailCondition(subject: ResolvedSubject): SQL {
    const byAddress = eq(emailMessage.toAddress, subject.email);
    return subject.customer === undefined
      ? byAddress
      : (or(eq(emailMessage.customerId, subject.customer.id), byAddress) as SQL);
  }

  /** Reads (and with `lock`, locks) what the decision needs. The customer row must already be locked by the caller. */
  private async gather(
    tx: Transaction,
    subject: ResolvedSubject,
    now: Date,
    lock: boolean,
  ): Promise<Gathered> {
    const orderQuery = tx
      .select()
      .from(salesOrder)
      .where(this.ordersCondition(subject))
      .orderBy(asc(salesOrder.id));
    const orders = lock ? await orderQuery.for("update") : await orderQuery;
    const { facts } = await this.orderFacts(tx, orders);
    const mailQuery = tx
      .select({
        id: emailMessage.id,
        status: emailMessage.status,
        leaseUntil: emailMessage.leaseUntil,
      })
      .from(emailMessage)
      .where(this.mailCondition(subject))
      .orderBy(asc(emailMessage.id));
    const mail = lock ? await mailQuery.for("update") : await mailQuery;
    const sendingMail = mail.some(
      (row) => row.status === "sending" && row.leaseUntil !== null && row.leaseUntil > now,
    );
    return { orders, facts, mailIds: mail.map((row) => row.id), sendingMail };
  }

  /**
   * The erasure facts of orders (their payment, refund and shipment statuses) and the newest refund time of each, read in
   * a fixed number of statements. The caller holds the order locks when it acts on the answer.
   */
  async orderFacts(
    tx: Transaction,
    orders: readonly (typeof salesOrder.$inferSelect)[],
  ): Promise<{ facts: ErasureOrderFacts[]; lastRefundAt: Map<string, Date> }> {
    const ids = orders.map((row) => row.id);
    const [payments, shipments] =
      ids.length === 0
        ? [[], []]
        : [
            await tx
              .select({ id: payment.id, orderId: payment.orderId, status: payment.status })
              .from(payment)
              .where(inArray(payment.orderId, ids)),
            await tx
              .select({ orderId: shipment.orderId, status: shipment.status })
              .from(shipment)
              .where(inArray(shipment.orderId, ids)),
          ];
    const refunds =
      payments.length === 0
        ? []
        : await tx
            .select({
              paymentId: paymentRefund.paymentId,
              status: paymentRefund.status,
              createdAt: paymentRefund.createdAt,
            })
            .from(paymentRefund)
            .where(
              inArray(
                paymentRefund.paymentId,
                payments.map((row) => row.id),
              ),
            );
    const orderOfPayment = new Map(payments.map((row) => [row.id, row.orderId]));
    const facts = orders.map((order): ErasureOrderFacts => ({
      orderId: order.id,
      orderNumber: order.number,
      status: order.status as OrderStatus,
      contactErased: order.contactErasedAt !== null,
      paymentStatuses: payments
        .filter((row) => row.orderId === order.id)
        .map((row) => row.status as PaymentStatus),
      refundStatuses: refunds
        .filter((row) => orderOfPayment.get(row.paymentId) === order.id)
        .map((row) => row.status as RefundStatus),
      shipmentStatuses: shipments
        .filter((row) => row.orderId === order.id)
        .map((row) => row.status as ShipmentStatus),
    }));
    const lastRefundAt = new Map<string, Date>();
    for (const refund of refunds) {
      const orderId = orderOfPayment.get(refund.paymentId);
      if (orderId === undefined) continue;
      const known = lastRefundAt.get(orderId);
      if (known === undefined || refund.createdAt > known)
        lastRefundAt.set(orderId, refund.createdAt);
    }
    return { facts, lastRefundAt };
  }

  /**
   * Anonymises the contact fields of one order with core `planOrderAnonymisation` (a random new fingerprint). The caller
   * holds the order's row lock and has decided that nothing blocks it.
   */
  async anonymiseOrder(
    tx: Transaction,
    order: typeof salesOrder.$inferSelect,
    now: Date,
  ): Promise<void> {
    const values = planOrderAnonymisation(
      {
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        requestFingerprint: order.requestFingerprint,
      },
      { erasedAt: now, newFingerprint: randomFingerprint() },
    );
    await tx
      .update(salesOrder)
      .set({
        email: values.email,
        phone: values.phone,
        firstName: values.firstName,
        lastName: values.lastName,
        shippingAddress: values.shippingAddress,
        billingAddress: values.billingAddress,
        cancellationReason: values.cancellationReason,
        accessTokenHash: values.accessTokenHash,
        accessExpiresAt: values.accessExpiresAt,
        requestFingerprint: values.requestFingerprint,
        contactErasedAt: values.contactErasedAt,
      })
      .where(eq(salesOrder.id, order.id));
  }

  private blockersOf(gathered: Gathered): { orderNumber: string | null; reason: ErasureReason }[] {
    const decision = decideErasure(gathered.facts);
    const blockers: { orderNumber: string | null; reason: ErasureReason }[] = decision.allowed
      ? []
      : decision.blockers.map((entry) => ({
          orderNumber: entry.orderNumber,
          reason: entry.reason,
        }));
    if (gathered.sendingMail) blockers.push({ orderNumber: null, reason: MAIL_SENDING_REASON });
    return blockers;
  }

  /** What an erasure would do now, read without locks and without any change. */
  async preview(tx: Transaction, subject: ResolvedSubject, now: Date): Promise<ErasurePreview> {
    const gathered = await this.gather(tx, subject, now, false);
    const blockers = this.blockersOf(gathered);
    return {
      accountFound: subject.customer !== undefined,
      orders: gathered.orders.length,
      ordersToAnonymise: gathered.facts.filter((facts) => !facts.contactErased).length,
      mail: gathered.mailIds.length,
      blockers,
      reasons: reasonsOf(blockers),
    };
  }

  /**
   * Locks the customer row of the subject (the first lock of every erasure). Returns the locked row, or `undefined` when
   * the account no longer exists (a parallel deletion won).
   */
  async lockCustomer(
    tx: Transaction,
    customerId: string,
  ): Promise<typeof customer.$inferSelect | undefined> {
    const [row] = await tx.select().from(customer).where(eq(customer.id, customerId)).for("update");
    return row;
  }

  /**
   * Erases the subject in the caller's transaction. The caller has locked the customer row with `lockCustomer` (and,
   * for an admin request, the request row before it). Throws `erasure_blocked` when anything is in progress.
   */
  async erase(tx: Transaction, subject: ResolvedSubject, now: Date): Promise<ErasureResult> {
    const gathered = await this.gather(tx, subject, now, true);
    const blockers = this.blockersOf(gathered);
    if (blockers.length > 0) {
      throw erasureBlocked(blockers);
    }
    const anonymised: string[] = [];
    for (const order of gathered.orders) {
      if (order.contactErasedAt !== null) continue;
      await this.anonymiseOrder(tx, order, now);
      anonymised.push(order.number);
    }
    if (gathered.mailIds.length > 0) {
      await tx.delete(emailMessage).where(inArray(emailMessage.id, [...gathered.mailIds]));
    }
    let customerDeleted = false;
    if (subject.customer !== undefined) {
      const deleted = await tx
        .delete(customer)
        .where(eq(customer.id, subject.customer.id))
        .returning({ id: customer.id });
      customerDeleted = deleted.length === 1;
    }
    return {
      ordersAnonymised: anonymised.length,
      mailDeleted: gathered.mailIds.length,
      customerDeleted,
      orderNumbers: anonymised.sort(),
      ...(subject.customer === undefined ? {} : { customerId: subject.customer.id }),
    };
  }
}
