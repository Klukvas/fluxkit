import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import { privacySubjectScope, type PrivacySubjectScope } from "@fluxkit/core";
import { customer, emailMessage, salesOrder } from "../database/schema/index.js";

type CustomerRow = typeof customer.$inferSelect;

/** Who an export or an erasure is about: an account (and its email), or an email that may also have an account. */
export interface ResolvedSubject {
  readonly kind: "customer" | "email";
  readonly customer: CustomerRow | undefined;
  /** The normalized address of the subject (the account email for a customer): what the request's HMAC is taken of. */
  readonly email: string;
  /** What the subject reaches (core `privacySubjectScope`, ADR 0035): the ONLY input of the conditions below. */
  readonly scope: PrivacySubjectScope;
}

function accountOf(row: CustomerRow) {
  return { id: row.id, email: row.email, emailVerified: row.emailVerifiedAt !== null };
}

/** The subject of an account row. */
export function customerSubject(row: CustomerRow): ResolvedSubject {
  return {
    kind: "customer",
    customer: row,
    email: row.email,
    scope: privacySubjectScope({ kind: "customer", account: accountOf(row) }),
  };
}

/** The subject of a normalized address and the account with that address, if any. */
export function emailSubject(email: string, row: CustomerRow | undefined): ResolvedSubject {
  return {
    kind: "email",
    customer: row,
    email,
    scope: privacySubjectScope({
      kind: "email",
      email,
      account: row === undefined ? null : accountOf(row),
    }),
  };
}

function either(conditions: SQL[]): SQL {
  if (conditions.length === 0) {
    // core never answers a scope that reaches nothing; reading "everything" instead would be a leak.
    throw new Error("A privacy subject scope reaches nothing");
  }
  return (conditions.length === 1 ? conditions[0] : or(...conditions)) as SQL;
}

/**
 * The GUEST orders of an address (`email = X AND customer_id IS NULL`, core `isInPrivacySubjectScope`): an order of
 * another account that carries the address is that account's record (a signed-in customer may type any email at
 * checkout), reached through that account only (privacy review F2).
 */
export function guestOrdersCondition(email: string): SQL {
  return and(eq(salesOrder.email, email), isNull(salesOrder.customerId)) as SQL;
}

/** The GUEST mail rows of an address (`to_address = X AND customer_id IS NULL`), for the same reason. */
export function guestMailCondition(email: string): SQL {
  return and(eq(emailMessage.toAddress, email), isNull(emailMessage.customerId)) as SQL;
}

/**
 * The orders of a subject: the lookup, the export, the preview, the erasure and its blockers all use this ONE
 * condition (privacy review F2), so they can never disagree.
 */
export function subjectOrdersCondition(scope: PrivacySubjectScope): SQL {
  const conditions: SQL[] = [];
  if (scope.customerId !== null) conditions.push(eq(salesOrder.customerId, scope.customerId));
  if (scope.guestEmail !== null) conditions.push(guestOrdersCondition(scope.guestEmail));
  return either(conditions);
}

/** The mail rows of a subject (export, lookup count, preview, erasure). */
export function subjectMailCondition(scope: PrivacySubjectScope): SQL {
  const conditions: SQL[] = [];
  if (scope.customerId !== null) conditions.push(eq(emailMessage.customerId, scope.customerId));
  if (scope.guestEmail !== null) conditions.push(guestMailCondition(scope.guestEmail));
  return either(conditions);
}
