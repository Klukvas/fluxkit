import { Inject, Injectable, Logger } from "@nestjs/common";
import { summarizeError } from "../common/error-summary.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { MEDIA_STORAGE_PORT, type MediaStoragePort } from "@fluxkit/core";
import { MEDIA_CONFIG, type MediaConfig } from "../media/media-config.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { ABANDONED_UPLOAD_LIMITS, deleteAbandonedUploads } from "./delete-abandoned-uploads.job.js";
import { deleteDispatchedEvents } from "./delete-dispatched-events.job.js";
import { deleteExpiredCarts } from "./delete-expired-carts.job.js";
import { deleteExpiredCustomerSessions } from "./delete-expired-customer-sessions.job.js";
import { dispatchDomainEvents } from "./dispatch-domain-events.job.js";
import { pgEventLeaseSource, type EventLeaseSource } from "./event-leases.js";
import { DEFAULT_JOB_BUDGET_MS, JobBudget } from "./job-budget.js";
import { DomainEventHandlerRegistry } from "./domain-event-handlers.js";
import { expireDueOrders } from "./expire-due-orders.job.js";
import { JobsRepository } from "./jobs.repository.js";
import { DEFAULT_CLEANUP_LIMITS } from "./batches.js";
import { SCHEDULER_DATABASE_URL } from "./scheduler-config.js";
import { sweepReservations } from "./sweep-reservations.job.js";
import { ShipmentTrackingService } from "../shipping/shipments/shipment-tracking.service.js";
import { trackShipments } from "./track-shipments.job.js";
import { EmailOutboxRepository, EmailSender } from "../email/outbox/index.js";
import { sendEmails } from "./send-emails.job.js";
import { purgeEmailMessages } from "./purge-email-messages.job.js";
import { PaymentReconcileService } from "../payments/payment-reconcile.service.js";
import { reconcilePayments } from "./reconcile-payments.job.js";
import { PRIVACY_CONFIG, type PrivacyConfig } from "../privacy/privacy-config.js";
import { PrivacyRetentionService } from "../privacy/retention/privacy-retention.service.js";
import { anonymiseOrders } from "./anonymise-orders.job.js";
import { SearchIndexer } from "../search/indexer/index.js";
import { rebuildSearchIndex, syncSearchIndex } from "./search-index.jobs.js";

/** The jobs in the order a tick runs them. The order matters (see `JobsRunner.runAll`). */
export const JOB_NAMES = [
  "expire-orders",
  "sweep-reservations",
  "dispatch-events",
  "delete-dispatched-events",
  "delete-carts",
  "delete-customer-sessions",
  "delete-abandoned-uploads",
  "track-shipments",
  "send-emails",
  "purge-email-messages",
  "reconcile-payments",
  "anonymise-orders",
  "sync-search-index",
  "rebuild-search-index",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export type JobReport =
  { name: JobName; ok: true; result: object } | { name: JobName; ok: false; error: unknown };

/**
 * Runs the scheduler jobs for one instant. Transport-agnostic: the timer (`SchedulerService`) and the command line
 * (`pnpm jobs:run-once`) both call `runAll(now)`; nothing here reads a clock or starts a timer. A job that throws is
 * logged and reported, and the next job still runs.
 */
@Injectable()
export class JobsRunner {
  private readonly logger = new Logger("Jobs");

  private readonly leases: EventLeaseSource;

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(JobsRepository) private readonly repository: JobsRepository,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(DomainEventHandlerRegistry) private readonly handlers: DomainEventHandlerRegistry,
    @Inject(MEDIA_STORAGE_PORT) private readonly mediaStorage: MediaStoragePort,
    @Inject(MEDIA_CONFIG) private readonly mediaConfig: MediaConfig,
    @Inject(ShipmentTrackingService) private readonly shipmentTracking: ShipmentTrackingService,
    @Inject(EmailSender) private readonly emailSender: EmailSender,
    @Inject(EmailOutboxRepository) private readonly emailOutbox: EmailOutboxRepository,
    @Inject(PaymentReconcileService) private readonly paymentReconcile: PaymentReconcileService,
    @Inject(PrivacyRetentionService) private readonly privacyRetention: PrivacyRetentionService,
    @Inject(PRIVACY_CONFIG) private readonly privacyConfig: PrivacyConfig,
    @Inject(SearchIndexer) private readonly searchIndexer: SearchIndexer,
    @Inject(SCHEDULER_DATABASE_URL) databaseUrl: string,
  ) {
    this.leases = pgEventLeaseSource(databaseUrl);
  }

  /**
   * Order, on purpose: the time-critical jobs first, so that nothing slow after them can delay them (ADR 0025): orders
   * (their expiry releases the reservations and writes `order.expired`), then the generic reservation sweep (which now
   * only finds orphans), then the events (including the ones just written), then the four cleanups (the last one deletes
   * files), then the carrier polls of job 8 (outbound network calls: after everything time-critical, so a slow carrier
   * delays nothing else; the events it writes are delivered by the next tick), then the mail of job 9 (outbound calls
   * too, after the dispatcher so a mail a handler enqueued goes out in the same tick; latency-critical auth mail does not
   * wait for it, the request makes an immediate attempt), the mail purge of job 10 and, last, the payment reconcile of job 11
   * (provider calls too: after everything else, so a slow payment provider delays no mail; a fact it applies may write
   * `order.paid`, delivered by the next tick, and a deferral of job 1 made its attempts due for this run), and after it job 12
   * (`anonymise-orders`, ADR 0033: off without `ORDER_CONTACT_RETENTION_DAYS`; destructive, so it never delays anything
   * time-critical), and last the search index jobs 13 `sync-search-index` and 14 `rebuild-search-index` (ADR 0034: calls to
   * the search engine; off with `SEARCH_ENABLED=false`; the index is derived data, so a slow engine delays nothing that
   * matters, and a change marked in this tick is synced in the same tick). Every job gets its
   * own time budget (`budgetMs`, default `DEFAULT_JOB_BUDGET_MS`) and stops starting new work when it is used up, so no
   * job can hold the tick, and with it the lock, for hours; what is left waits for the next tick. One failing job never
   * stops the next and never throws out of here: its error is logged and returned.
   */
  async runAll(now: Date, options: { budgetMs?: number } = {}): Promise<JobReport[]> {
    const { database, repository } = this;
    const budgetMs = options.budgetMs ?? DEFAULT_JOB_BUDGET_MS;
    const reports: JobReport[] = [];
    const run = async (
      name: JobName,
      job: (budget: JobBudget) => Promise<object>,
    ): Promise<void> => {
      try {
        const result = await job(new JobBudget(budgetMs));
        reports.push({ name, ok: true, result });
        this.logResult(name, result);
      } catch (error) {
        reports.push({ name, ok: false, error });
        // The class and the cause only: a database error text embeds the statement and its parameters.
        this.logger.error(`Job ${name} failed: ${summarizeError(error)}`);
      }
    };
    await run("expire-orders", (budget) =>
      expireDueOrders({ database, repository, orders: this.orders }, now, { budget }),
    );
    await run("sweep-reservations", (budget) =>
      sweepReservations({ reservations: this.reservations }, now, { budget }),
    );
    await run("dispatch-events", (budget) =>
      dispatchDomainEvents(
        { database, repository, handlers: this.handlers, leases: this.leases },
        now,
        {
          budget,
        },
      ),
    );
    await run("delete-dispatched-events", (budget) =>
      deleteDispatchedEvents({ database, repository }, now, DEFAULT_CLEANUP_LIMITS, budget),
    );
    await run("delete-carts", (budget) =>
      deleteExpiredCarts({ database, repository }, now, DEFAULT_CLEANUP_LIMITS, budget),
    );
    await run("delete-customer-sessions", (budget) =>
      deleteExpiredCustomerSessions({ database, repository }, now, DEFAULT_CLEANUP_LIMITS, budget),
    );
    await run("delete-abandoned-uploads", (budget) =>
      deleteAbandonedUploads(
        { database, repository, storage: this.mediaStorage, config: this.mediaConfig },
        now,
        ABANDONED_UPLOAD_LIMITS,
        budget,
      ),
    );
    await run("track-shipments", (budget) =>
      trackShipments({ tracking: this.shipmentTracking }, now, { budget }),
    );
    await run("send-emails", (budget) =>
      sendEmails({ database, outbox: this.emailOutbox, sender: this.emailSender }, now, { budget }),
    );
    await run("purge-email-messages", (budget) =>
      purgeEmailMessages(
        { database, outbox: this.emailOutbox },
        now,
        DEFAULT_CLEANUP_LIMITS,
        budget,
      ),
    );
    await run("reconcile-payments", (budget) =>
      reconcilePayments({ reconcile: this.paymentReconcile }, now, { budget }),
    );
    await run("anonymise-orders", (budget) =>
      anonymiseOrders(
        {
          retention: this.privacyRetention,
          retentionDays: this.privacyConfig.orderContactRetentionDays,
        },
        now,
        { budget },
      ),
    );
    await run("sync-search-index", (budget) =>
      syncSearchIndex({ indexer: this.searchIndexer }, now, { budget }),
    );
    await run("rebuild-search-index", (budget) =>
      rebuildSearchIndex({ indexer: this.searchIndexer }, now, { budget }),
    );
    return reports;
  }

  /** One line per job that did something, an error per thing that needs a person. Ids, numbers and codes only. */
  private logResult(name: JobName, result: object): void {
    const fields = result as Record<string, unknown>;
    const failures = fields["failures"];
    if (Array.isArray(failures)) {
      for (const failure of failures) {
        this.logger.error(`Job ${name}: ${JSON.stringify(failure)}`);
      }
    }
    const abandoned = fields["abandoned"];
    if (Array.isArray(abandoned)) {
      for (const event of abandoned) {
        this.logger.error(
          `Job ${name}: event gave up after repeated failures and waits for an operator: ${JSON.stringify(event)}`,
        );
      }
    }
    if (fields["truncated"] === true) {
      this.logger.warn(
        `Job ${name} stopped at its batch limit or time budget; the rest is left for the next run`,
      );
    }
    const summary = describeCounts(result);
    if (summary !== "") {
      this.logger.log(`Job ${name}: ${summary}`);
    }
  }
}

/** `key=count` for every number or list in a job result that is not zero or empty (`iterations` is bookkeeping); `""` when the job did nothing. */
export function describeCounts(result: object): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(result)) {
    if (key === "iterations") {
      continue;
    }
    if (typeof value === "number" && value !== 0) {
      parts.push(`${key}=${String(value)}`);
    } else if (Array.isArray(value) && value.length > 0) {
      parts.push(`${key}=${String(value.length)}`);
    }
  }
  return parts.join(" ");
}

/** Every number, list length and flag of a job result, zero or not, for the command line. */
export function describeAllCounts(result: object): string {
  return Object.entries(result)
    .flatMap(([key, value]): string[] => {
      if (typeof value === "number" || typeof value === "boolean") {
        return [`${key}=${String(value)}`];
      }
      return Array.isArray(value) ? [`${key}=${String(value.length)}`] : [];
    })
    .join(" ");
}
