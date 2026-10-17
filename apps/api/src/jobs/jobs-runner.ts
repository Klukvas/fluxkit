import { Inject, Injectable, Logger } from "@nestjs/common";
import { summarizeError } from "../common/error-summary.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { ReservationsService } from "../inventory/reservations/reservations.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { deleteDispatchedEvents } from "./delete-dispatched-events.job.js";
import { deleteExpiredCarts } from "./delete-expired-carts.job.js";
import { deleteExpiredCustomerSessions } from "./delete-expired-customer-sessions.job.js";
import { dispatchDomainEvents } from "./dispatch-domain-events.job.js";
import { DomainEventHandlerRegistry } from "./domain-event-handlers.js";
import { expireDueOrders } from "./expire-due-orders.job.js";
import { JobsRepository } from "./jobs.repository.js";
import { sweepReservations } from "./sweep-reservations.job.js";

/** The jobs in the order a tick runs them. The order matters (see `JobsRunner.runAll`). */
export const JOB_NAMES = [
  "expire-orders",
  "sweep-reservations",
  "dispatch-events",
  "delete-dispatched-events",
  "delete-carts",
  "delete-customer-sessions",
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

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(JobsRepository) private readonly repository: JobsRepository,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ReservationsService) private readonly reservations: ReservationsService,
    @Inject(DomainEventHandlerRegistry) private readonly handlers: DomainEventHandlerRegistry,
  ) {}

  /**
   * Order, on purpose: orders first (their expiry releases the reservations and writes `order.expired`), then the generic
   * reservation sweep (which now only finds orphans), then the events (including the ones just written), then the three
   * cleanups. One failing job never stops the next and never throws out of here: its error is logged and returned.
   */
  async runAll(now: Date): Promise<JobReport[]> {
    const { database, repository } = this;
    const reports: JobReport[] = [];
    const run = async (name: JobName, job: () => Promise<object>): Promise<void> => {
      try {
        const result = await job();
        reports.push({ name, ok: true, result });
        this.logResult(name, result);
      } catch (error) {
        reports.push({ name, ok: false, error });
        // The class and the cause only: a database error text embeds the statement and its parameters.
        this.logger.error(`Job ${name} failed: ${summarizeError(error)}`);
      }
    };
    await run("expire-orders", () =>
      expireDueOrders({ database, repository, orders: this.orders }, now),
    );
    await run("sweep-reservations", () =>
      sweepReservations({ reservations: this.reservations }, now),
    );
    await run("dispatch-events", () =>
      dispatchDomainEvents({ database, repository, handlers: this.handlers }, now),
    );
    await run("delete-dispatched-events", () =>
      deleteDispatchedEvents({ database, repository }, now),
    );
    await run("delete-carts", () => deleteExpiredCarts({ database, repository }, now));
    await run("delete-customer-sessions", () =>
      deleteExpiredCustomerSessions({ database, repository }, now),
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
      this.logger.warn(`Job ${name} stopped at its batch limit; the rest is left for the next run`);
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
