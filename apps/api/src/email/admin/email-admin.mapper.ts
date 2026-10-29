import { isFinalEmailStatus, type EmailMessageStatus } from "@fluxkit/core";
import type { EmailMessageRow } from "../outbox/index.js";
import { redactEmailVariables } from "./email-variables-redaction.js";
import type { EmailMessageDetailResponse, EmailMessageResponse } from "./email-admin.schemas.js";

/**
 * Templates a resend refuses: the account mails of a customer (reset, verification, "password changed"). The person asks
 * again on the storefront; a resend would reuse a token row that may be expired or used (ADR 0031 decision 15).
 */
export const NOT_RESENDABLE_KEY_PREFIX = "customer.";

/** Whether a resend may be considered for this row. The provider and the template are checked by the resend itself. */
export function isResendableRow(row: Pick<EmailMessageRow, "status" | "templateKey">): boolean {
  return (
    isFinalEmailStatus(row.status as EmailMessageStatus) &&
    !row.templateKey.startsWith(NOT_RESENDABLE_KEY_PREFIX)
  );
}

export function toEmailMessageResponse(row: EmailMessageRow): EmailMessageResponse {
  return {
    id: row.id,
    templateKey: row.templateKey,
    templateVersion: row.templateVersion,
    locale: row.locale,
    to: row.toAddress,
    recipientKind: row.recipientKind as EmailMessageResponse["recipientKind"],
    customerId: row.customerId,
    orderId: row.orderId,
    adminUserId: row.adminUserId,
    status: row.status as EmailMessageResponse["status"],
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    leaseUntil: row.leaseUntil?.toISOString() ?? null,
    deadlineAt: row.deadlineAt.toISOString(),
    providerCode: row.providerCode,
    providerMessageId: row.providerMessageId,
    lastErrorCode: row.lastErrorCode,
    resendOf: row.resendOf,
    createdByAdminId: row.createdByAdminId,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    canCancel: row.status === "pending",
    canResend: isResendableRow(row),
  };
}

/** `displayVariables`: the allowlist of the row's registered template, `undefined` when there is none. */
export function toEmailMessageDetail(
  row: EmailMessageRow,
  displayVariables: readonly string[] | undefined,
): EmailMessageDetailResponse {
  return {
    ...toEmailMessageResponse(row),
    variables: redactEmailVariables(row.templateKey, row.variables, displayVariables),
  };
}
