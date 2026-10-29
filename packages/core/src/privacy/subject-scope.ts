import type { PrivacyRequestSubjectKind } from "./request.js";

/*
 * Who a privacy export or erasure reaches (ADR 0035, superseding in part ADR 0033 decision 6; privacy review F1 and F2).
 * Pure: the API turns the scope into ONE SQL condition for orders and one for mail rows, shared by the lookup, the
 * export, the preview, the erasure and its blockers, so they can never disagree.
 */

export interface PrivacySubjectAccount {
  readonly id: string;
  /** The normalized account address. */
  readonly email: string;
  /** `email_verified_at` is set: the holder of the address confirmed it. */
  readonly emailVerified: boolean;
}

export type PrivacySubjectInput =
  | {
      readonly kind: Extract<PrivacyRequestSubjectKind, "customer">;
      readonly account: PrivacySubjectAccount | null;
    }
  | {
      readonly kind: Extract<PrivacyRequestSubjectKind, "email">;
      /** The normalized address the owner typed (identity checked off-band). */
      readonly email: string;
      /** The account with exactly this address, if one exists. */
      readonly account: PrivacySubjectAccount | null;
    };

export interface PrivacySubjectScope {
  /** Orders and mail rows linked to this account (`customer_id`); null when the subject has no account. */
  readonly customerId: string | null;
  /**
   * GUEST orders and GUEST mail rows (`customer_id IS NULL`) with this address; null when the address reaches nothing.
   * Never the rows of another account that happen to carry the address (review F2).
   */
  readonly guestEmail: string | null;
}

/**
 * The scope of a subject:
 * - a customer subject (self-service, or the owner's request by account id) reaches its account; it reaches the guest
 *   data of its address only when the address is verified: registration takes any address unchecked (ADR 0031), so an
 *   unverified address proves nothing about who placed a guest order with it (review F1);
 * - an email subject (the owner's request by address, identity checked off-band, ADR 0033 decision 1) reaches the guest
 *   data of the address and the account with that address, if any.
 * Inconsistent input is a bug in the caller (RangeError).
 */
export function privacySubjectScope(input: PrivacySubjectInput): PrivacySubjectScope {
  if (input.kind === "customer") {
    if (input.account === null) {
      throw new RangeError("A customer subject needs its account");
    }
    return {
      customerId: input.account.id,
      guestEmail: input.account.emailVerified ? input.account.email : null,
    };
  }
  if (input.email === "") {
    throw new RangeError("An email subject needs its address");
  }
  if (input.account !== null && input.account.email !== input.email) {
    throw new RangeError("The account of an email subject must have the subject's address");
  }
  return { customerId: input.account?.id ?? null, guestEmail: input.email };
}

/** The columns of an order or a mail row that decide whether a subject reaches it. */
export interface PrivacyScopedRow {
  readonly customerId: string | null;
  /** `sales_order.email` or `email_message.to_address` (normalized; NULL on an erased order). */
  readonly email: string | null;
}

/**
 * Whether a subject reaches one order or mail row: a row of its account, or a guest row with its guest address. The API's
 * `subjectOrdersCondition` and `subjectMailCondition` are this rule in SQL (their spec compares both on real rows).
 */
export function isInPrivacySubjectScope(
  scope: PrivacySubjectScope,
  row: PrivacyScopedRow,
): boolean {
  if (scope.customerId !== null && row.customerId === scope.customerId) return true;
  // A row of ANOTHER account that carries the address is that account's record, reached through that account (F2).
  return scope.guestEmail !== null && row.customerId === null && row.email === scope.guestEmail;
}
