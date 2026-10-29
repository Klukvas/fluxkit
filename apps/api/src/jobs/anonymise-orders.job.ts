import {
  AUDIT_EVENT_RETENTION_DAYS,
  PRIVACY_REQUEST_RETENTION_DAYS,
  retentionCutoff,
} from "@fluxkit/core";
import type { PrivacyRetentionService } from "../privacy/retention/privacy-retention.service.js";
import { DEFAULT_CLEANUP_LIMITS, drainInBatches, type BatchLimits } from "./batches.js";
import type { JobBudget } from "./job-budget.js";

/** Orders read per page (plan section 3: pages of 100); each is then changed in its own short transaction. */
export const ANONYMISE_PAGE_SIZE = 100;

export interface AnonymiseOrdersResult {
  /** False without `ORDER_CONTACT_RETENTION_DAYS`: the job did nothing. */
  enabled: boolean;
  anonymised: number;
  /** Due orders with a blocker (something still in progress): left for a later run. */
  skipped: number;
  requestsDeleted: number;
  auditEventsDeleted: number;
  truncated: boolean;
}

export interface AnonymiseOrdersDeps {
  retention: Pick<
    PrivacyRetentionService,
    "candidates" | "anonymiseIfDue" | "deleteOldRequests" | "deleteOldAuditEvents"
  >;
  /** `ORDER_CONTACT_RETENTION_DAYS`; null keeps the job off. */
  retentionDays: number | null;
}

/**
 * Job 12 `anonymise-orders` (ADR 0033 decision 8). Off (`enabled: false`, nothing read or changed) until the owner sets
 * `ORDER_CONTACT_RETENTION_DAYS`. Then: the contact data of every closed order whose final date (closing time or newest
 * refund) is strictly older than the period is anonymised, one order per short transaction, in pages by id within the
 * time budget; an order with a blocker is skipped and counted; then closed privacy requests older than
 * `PRIVACY_REQUEST_RETENTION_DAYS` and audit events older than `AUDIT_EVENT_RETENTION_DAYS` are deleted in batches.
 * TODO(fluxkit): legal review of both purge periods (ADR 0033 open question 2).
 */
export async function anonymiseOrders(
  deps: AnonymiseOrdersDeps,
  now: Date,
  options: { budget?: JobBudget; pageSize?: number; limits?: BatchLimits } = {},
): Promise<AnonymiseOrdersResult> {
  const result: AnonymiseOrdersResult = {
    enabled: deps.retentionDays !== null,
    anonymised: 0,
    skipped: 0,
    requestsDeleted: 0,
    auditEventsDeleted: 0,
    truncated: false,
  };
  if (deps.retentionDays === null) {
    return result;
  }
  const cutoff = retentionCutoff(now, deps.retentionDays);
  const pageSize = options.pageSize ?? ANONYMISE_PAGE_SIZE;
  let afterId: string | null = null;
  pages: for (;;) {
    if (options.budget?.exhausted() === true) {
      result.truncated = true;
      break;
    }
    const ids = await deps.retention.candidates(cutoff, afterId, pageSize);
    for (const id of ids) {
      if (options.budget?.exhausted() === true) {
        result.truncated = true;
        break pages;
      }
      const outcome = await deps.retention.anonymiseIfDue(id, cutoff, now);
      if (outcome === "anonymised") result.anonymised += 1;
      if (outcome === "blocked") result.skipped += 1;
      afterId = id;
    }
    if (ids.length < pageSize) break;
  }
  if (result.truncated) {
    return result;
  }
  const limits = options.limits ?? DEFAULT_CLEANUP_LIMITS;
  const requests = await drainInBatches(
    (batchSize) =>
      deps.retention.deleteOldRequests(
        retentionCutoff(now, PRIVACY_REQUEST_RETENTION_DAYS),
        batchSize,
      ),
    limits,
    options.budget,
  );
  const audit = await drainInBatches(
    (batchSize) =>
      deps.retention.deleteOldAuditEvents(
        retentionCutoff(now, AUDIT_EVENT_RETENTION_DAYS),
        batchSize,
      ),
    limits,
    options.budget,
  );
  result.requestsDeleted = requests.total;
  result.auditEventsDeleted = audit.total;
  result.truncated = requests.truncated || audit.truncated;
  return result;
}
