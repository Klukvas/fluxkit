import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  isLivePaymentStatus,
  isProviderPaymentFact,
  PAYMENT_LIMITS,
  type PaymentProviderResult,
  type ProviderPaymentFact,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../auth/clock.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import { paymentStatusOf } from "./attempts/payment-changes.js";
import { PaymentsRepository, type PaymentRow } from "./attempts/payments.repository.js";
import { PaymentFactsService } from "./payment-facts.service.js";
import { callPaymentProvider, describePaymentCall } from "./payment-provider-call.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments-config.js";
import { PaymentProviderRegistry } from "./registry/index.js";

export type PaymentReadResult =
  /** The provider answered; its fact went through `PaymentFactsService` (applied, ignored or a duplicate). */
  | { readonly kind: "read" }
  /** Nothing to read: no provider id yet (the create answer is pending or was lost). */
  | { readonly kind: "nothing_to_read" }
  /** The attempt's provider is no longer enabled (`PAYMENT_PROVIDERS_ENABLED`). */
  | { readonly kind: "provider_not_enabled" }
  /** The provider refused, throttled or did not answer; nothing changed. */
  | { readonly kind: "provider_unavailable"; readonly retryAfterSeconds: number | null };

/** Most attempts whose last on-demand read time a process remembers (older entries are dropped first). */
const MAX_REMEMBERED_READS = 10_000;

/**
 * On-demand status reads of one attempt (ADR 0032 decisions 6 and 13): the store status routes (only for a live attempt,
 * at most once per `PAYMENT_LIMITS.statusReadMinAgeSeconds` per attempt and process, one call in flight per attempt) and
 * the admin resync (always one read). The provider call runs with no transaction open and the API's timeout; the answer
 * is a verified fact (read with the shop's credentials) applied exactly like job 11's read, but without moving job 11's
 * schedule (`readPaymentId`). In-memory state multiplies with instances; that is harmless for correctness (decision 14).
 */
@Injectable()
export class PaymentReadsService {
  private readonly logger = new Logger("Payments");
  private readonly inFlight = new Map<string, Promise<PaymentReadResult>>();
  private readonly lastRead = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(PaymentsRepository) private readonly payments: PaymentsRepository,
    @Inject(PaymentFactsService) private readonly facts: PaymentFactsService,
    @Inject(PaymentProviderRegistry) private readonly registry: PaymentProviderRegistry,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The store status routes: reads the provider when the attempt is live, has a provider id and was not read by this
   * process within the minimum age; a concurrent caller waits for the same read. Never throws for a provider failure
   * (the shopper sees what we know); answers the attempt as stored afterwards.
   */
  async refreshForShopper(row: PaymentRow): Promise<PaymentRow> {
    if (!isLivePaymentStatus(paymentStatusOf(row.status)) || row.providerPaymentId === null) {
      return row;
    }
    const running = this.inFlight.get(row.id);
    if (running === undefined) {
      const last = this.lastRead.get(row.id);
      const now = this.clock.now().getTime();
      if (last !== undefined && now - last < PAYMENT_LIMITS.statusReadMinAgeSeconds * 1_000) {
        return row;
      }
      await this.readOnce(row);
    } else {
      await running;
    }
    return (await this.payments.findById(this.database, row.id)) ?? row;
  }

  /** The admin resync: one status read now (single flight per attempt). */
  readNow(row: PaymentRow): Promise<PaymentReadResult> {
    return this.inFlight.get(row.id) ?? this.readOnce(row);
  }

  private readOnce(row: PaymentRow): Promise<PaymentReadResult> {
    const started = this.read(row).finally(() => {
      this.inFlight.delete(row.id);
    });
    this.inFlight.set(row.id, started);
    return started;
  }

  private async read(row: PaymentRow): Promise<PaymentReadResult> {
    const provider = this.registry.get(row.providerCode);
    const providerPaymentId = row.providerPaymentId;
    if (provider === undefined) {
      return { kind: "provider_not_enabled" };
    }
    if (providerPaymentId === null) {
      return { kind: "nothing_to_read" };
    }
    this.remember(row.id);
    const call = await callPaymentProvider<ProviderPaymentFact>(
      (signal) => provider.getPayment(providerPaymentId, signal),
      this.config.providerTimeoutMs,
    );
    const result: PaymentProviderResult<ProviderPaymentFact> =
      call.result.ok && !isProviderPaymentFact(call.result.value)
        ? { ok: false, reason: "unavailable", providerCodes: ["malformed_fact"] }
        : call.result;
    if (!result.ok) {
      this.logger.warn(`Payment ${row.id}: on-demand getPayment ${describePaymentCall(call)}`);
      return { kind: "provider_unavailable", retryAfterSeconds: result.retryAfterSeconds ?? null };
    }
    await this.facts.applyProviderFact({
      providerCode: row.providerCode,
      fact: result.value,
      source: "poll",
      now: this.clock.now(),
      readPaymentId: row.id,
    });
    return { kind: "read" };
  }

  private remember(paymentId: string): void {
    this.lastRead.delete(paymentId);
    this.lastRead.set(paymentId, this.clock.now().getTime());
    if (this.lastRead.size > MAX_REMEMBERED_READS) {
      const oldest = this.lastRead.keys().next();
      if (oldest.done !== true) {
        this.lastRead.delete(oldest.value);
      }
    }
  }
}
