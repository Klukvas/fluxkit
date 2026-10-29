import { Inject, Injectable } from "@nestjs/common";
import {
  buildPersonalDataExport,
  findForbiddenExportKeys,
  requestDueAt,
  type PersonalDataExport,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { ruleViolation, tooManyRequests, unauthorized } from "../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { privacyRequest } from "../../database/schema/index.js";
import { RateLimiter } from "../../rate-limit/rate-limiter.js";
import { PRIVACY_CONFIG, subjectEmailHash, type PrivacyConfig } from "../privacy-config.js";
import {
  EXPORT_MAX_ORDERS,
  PersonalDataReader,
  type ResolvedSubject,
} from "./personal-data.reader.js";

export interface BuiltExport {
  readonly document: PersonalDataExport;
  readonly counts: { readonly orders: number; readonly mail: number; readonly sessions: number };
}

export function exportTooLarge(): never {
  throw ruleViolation(
    `The subject has more than ${String(EXPORT_MAX_ORDERS)} orders; the shop owner exports such data another way.`,
    "export_too_large",
  );
}

/**
 * Builds the personal-data export of one subject (ADR 0033 decision 7) with core `buildPersonalDataExport`, which copies
 * only the allowed keys. The finished document is scanned once more with core `findForbiddenExportKeys`: a hash, a secret
 * or an internal id in it is a bug, so it fails loudly instead of being sent.
 */
@Injectable()
export class PersonalDataExportService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PersonalDataReader) private readonly reader: PersonalDataReader,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(PRIVACY_CONFIG) private readonly config: PrivacyConfig,
  ) {}

  /** The document of a resolved subject, read in the caller's transaction (one snapshot). */
  async build(db: DbExecutor, subject: ResolvedSubject, now: Date): Promise<BuiltExport> {
    if ((await this.reader.countOrders(db, subject)) > EXPORT_MAX_ORDERS) {
      exportTooLarge();
    }
    const orders = await this.reader.listOrders(db, subject);
    const account = subject.customer;
    const [orderFacts, mail, sessions, cartFacts] = [
      await this.reader.orderFacts(db, orders),
      await this.reader.mailFacts(db, subject),
      await this.reader.sessionFacts(db, subject),
      await this.reader.cartFacts(db, subject),
    ];
    const document = buildPersonalDataExport({
      generatedAt: now,
      subject: { kind: subject.kind },
      account:
        account === undefined
          ? null
          : {
              email: account.email,
              firstName: account.firstName,
              lastName: account.lastName,
              phone: account.phone,
              isActive: account.isActive,
              emailVerifiedAt: account.emailVerifiedAt,
              lastLoginAt: account.lastLoginAt,
              passwordChangedAt: account.passwordChangedAt,
              createdAt: account.createdAt,
              updatedAt: account.updatedAt,
            },
      orders: orderFacts,
      mail,
      sessions,
      cart: cartFacts,
      processors: this.reader.processors(),
    });
    const forbidden = findForbiddenExportKeys(document);
    if (forbidden.length > 0) {
      // Never reached while core copies only allowed keys; the paths name keys, never values.
      throw new Error(`The personal data export contains forbidden keys: ${forbidden.join(", ")}`);
    }
    return {
      document,
      counts: { orders: orders.length, mail: mail.length, sessions: sessions.length },
    };
  }

  /**
   * `GET /store/account/data-export`: the signed-in customer's own data. Limited per customer (`dataExport`), recorded as a
   * completed self-service export request (no contact data in the row) in the same transaction that read the data.
   */
  async selfService(customerId: string): Promise<PersonalDataExport> {
    const limit = this.limiter.attempt("dataExport", `customer:${customerId}`);
    if (!limit.allowed) {
      throw tooManyRequests("Too many exports. Try again later.", limit.retryAfterSeconds);
    }
    const now = this.clock.now();
    return withTransaction(this.db, async (tx) => {
      const subject = await this.reader.byCustomer(tx, customerId);
      if (subject === undefined) {
        throw unauthorized();
      }
      const built = await this.build(tx, subject, now);
      await tx.insert(privacyRequest).values({
        kind: "export",
        subjectKind: "customer",
        subjectCustomerId: customerId,
        subjectEmailHash: subjectEmailHash(this.config, subject.email),
        channel: "self_service",
        status: "completed",
        receivedAt: now,
        dueAt: requestDueAt(now),
        completedAt: now,
        result: { ...built.counts },
      });
      return built.document;
    });
  }
}
