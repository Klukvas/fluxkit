import { timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  decideRequestTransition,
  isRequestOverdue,
  requestDueAt,
  validateEmail,
  type OrderStatus,
  type PersonalDataExport,
  type PrivacyRequestChannel,
  type PrivacyRequestKind,
  type PrivacyRequestStatus,
  type PrivacyRequestSubjectKind,
} from "@fluxkit/core";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { toPage, type Page } from "../../common/pagination.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type ProblemException,
} from "../../common/problem.js";
import { withTransaction, type Transaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import { privacyRequest, salesOrder } from "../../database/schema/index.js";
import { AdminAuditWriter } from "../audit/admin-audit.writer.js";
import { PrivacyErasureService } from "../erasure/privacy-erasure.service.js";
import { PersonalDataExportService } from "../export/personal-data-export.service.js";
import { PersonalDataReader } from "../export/personal-data.reader.js";
import {
  customerSubject,
  emailSubject,
  guestOrdersCondition,
  type ResolvedSubject,
} from "../subject.js";
import { PRIVACY_CONFIG, subjectEmailHash, type PrivacyConfig } from "../privacy-config.js";
import type {
  CreateRequestBody,
  EraseBody,
  ErasePreviewBody,
  ErasePreviewView,
  RejectBody,
  ExportBody,
  ListRequestsQuery,
  LookupResult,
  PrivacyRequestView,
} from "./privacy-admin.schemas.js";

export type PrivacyRequestRow = typeof privacyRequest.$inferSelect;

const OPEN_STATUSES: readonly PrivacyRequestStatus[] = ["received", "in_progress"];

export function subjectNotFound(): ProblemException {
  return ruleViolation(
    "The account of this request no longer exists; reject the request or open one by email.",
    "subject_not_found",
  );
}

export function requestClosed(): ProblemException {
  return ruleViolation("The request is completed or rejected; open a new one.", "request_closed");
}

/** A typed email that core accepts, normalized; a 400 on `path` otherwise. */
export function requireEmail(input: string | undefined, path: string): string {
  const checked = validateEmail(input ?? "");
  if (!checked.ok) {
    throw validationFailed([
      { path, code: checked.reason, message: "Must be a valid email address." },
    ]);
  }
  return checked.email;
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The admin side of privacy requests (ADR 0033 decisions 1, 9 and 10; `privacy.manage`, owner only): look up a subject by
 * email (a POST body, never a URL), record a request, list and read requests, export a request's subject. Every action is
 * audited in its transaction. The email of a subject is never stored: requests keep an HMAC, so an export of an email
 * subject takes the address again in the body and checks it against the request.
 */
@Injectable()
export class PrivacyAdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(PersonalDataReader) private readonly reader: PersonalDataReader,
    @Inject(PersonalDataExportService) private readonly exports: PersonalDataExportService,
    @Inject(AdminAuditWriter) private readonly audit: AdminAuditWriter,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PRIVACY_CONFIG) private readonly config: PrivacyConfig,
    @Inject(PrivacyErasureService) private readonly erasure: PrivacyErasureService,
  ) {}

  view(row: PrivacyRequestRow, now: Date = this.clock.now()): PrivacyRequestView {
    const status = row.status as PrivacyRequestStatus;
    return {
      id: row.id,
      kind: row.kind as PrivacyRequestKind,
      subjectKind: row.subjectKind as PrivacyRequestSubjectKind,
      subjectCustomerId: row.subjectCustomerId,
      channel: row.channel as PrivacyRequestChannel,
      status,
      receivedAt: row.receivedAt.toISOString(),
      dueAt: row.dueAt.toISOString(),
      completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
      overdue: isRequestOverdue({ status, dueAt: row.dueAt }, now),
      result: row.result as PrivacyRequestView["result"],
      note: row.note,
      handledBy: row.handledBy,
    };
  }

  async lookup(email: string, actorAdminId: string): Promise<LookupResult> {
    const normalized = requireEmail(email, "email");
    const hash = subjectEmailHash(this.config, normalized);
    return withTransaction(this.db, async (tx) => {
      const subject = await this.reader.byEmail(tx, normalized);
      const account = subject.customer;
      const guestOrders = await tx
        .select({
          id: salesOrder.id,
          number: salesOrder.number,
          status: salesOrder.status,
          placedAt: salesOrder.placedAt,
          contactErasedAt: salesOrder.contactErasedAt,
        })
        .from(salesOrder)
        .where(guestOrdersCondition(normalized))
        .orderBy(asc(salesOrder.placedAt), asc(salesOrder.id));
      const orderCount =
        account === undefined
          ? 0
          : ((
              await tx
                .select({ value: count() })
                .from(salesOrder)
                .where(eq(salesOrder.customerId, account.id))
            )[0]?.value ?? 0);
      const mailCount = await this.reader.countMail(tx, subject);
      const bySubject: SQL[] = [eq(privacyRequest.subjectEmailHash, hash)];
      if (account !== undefined) bySubject.push(eq(privacyRequest.subjectCustomerId, account.id));
      const open = await tx
        .select()
        .from(privacyRequest)
        .where(and(or(...bySubject), inArray(privacyRequest.status, [...OPEN_STATUSES])))
        .orderBy(asc(privacyRequest.dueAt), asc(privacyRequest.id));
      await this.audit.record(tx, actorAdminId, {
        action: "privacy.lookup",
        // An address without an account has no row to name: the event then names the admin who looked.
        targetKind: account === undefined ? "admin_user" : "customer",
        targetId: account === undefined ? actorAdminId : account.id,
        detail: {
          accountFound: account !== undefined,
          guestOrders: guestOrders.length,
          mail: mailCount,
        },
      });
      return {
        customer:
          account === undefined
            ? null
            : {
                id: account.id,
                email: account.email,
                firstName: account.firstName,
                lastName: account.lastName,
                isActive: account.isActive,
                createdAt: account.createdAt.toISOString(),
                orderCount,
              },
        guestOrders: guestOrders.map((row) => ({
          id: row.id,
          number: row.number,
          status: row.status as OrderStatus,
          placedAt: row.placedAt.toISOString(),
          contactErased: row.contactErasedAt !== null,
        })),
        mailCount,
        openRequests: open.map((row) => this.view(row)),
      };
    });
  }

  async create(body: CreateRequestBody, actorAdminId: string): Promise<PrivacyRequestView> {
    const now = this.clock.now();
    const row = await withTransaction(this.db, async (tx) => {
      let subjectKind: PrivacyRequestSubjectKind;
      let subjectCustomerId: string | null;
      let email: string;
      if ("customerId" in body.subject) {
        const subject = await this.reader.byCustomer(tx, body.subject.customerId);
        if (subject === undefined) {
          throw notFound("Customer");
        }
        subjectKind = "customer";
        subjectCustomerId = body.subject.customerId;
        email = subject.email;
      } else {
        subjectKind = "email";
        email = requireEmail(body.subject.email, "subject.email");
        subjectCustomerId = null;
      }
      const [inserted] = await tx
        .insert(privacyRequest)
        .values({
          kind: body.kind,
          subjectKind,
          subjectCustomerId,
          subjectEmailHash: subjectEmailHash(this.config, email),
          channel: "admin",
          status: "received",
          receivedAt: now,
          dueAt: requestDueAt(now),
          note: body.note ?? null,
          handledBy: actorAdminId,
        })
        .returning();
      if (inserted === undefined) {
        throw new Error("The privacy request was not inserted");
      }
      await this.audit.record(tx, actorAdminId, {
        action: "privacy.request_changed",
        targetKind: "privacy_request",
        targetId: inserted.id,
        detail: { kind: inserted.kind, toStatus: "received" },
      });
      return inserted;
    });
    return this.view(row, now);
  }

  async list(query: ListRequestsQuery): Promise<Page<PrivacyRequestView>> {
    const where = query.status === undefined ? undefined : eq(privacyRequest.status, query.status);
    const closed = sql`(${privacyRequest.status} in ('completed', 'rejected'))`;
    const rows = await this.db
      .select()
      .from(privacyRequest)
      .where(where)
      // Open requests first, the most urgent on top; then the closed ones, newest first.
      .orderBy(
        closed,
        sql`case when ${closed} then null else ${privacyRequest.dueAt} end asc nulls last`,
        desc(privacyRequest.completedAt),
        desc(privacyRequest.id),
      )
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await this.db.select({ value: count() }).from(privacyRequest).where(where);
    const now = this.clock.now();
    return toPage(
      rows.map((row) => this.view(row, now)),
      total?.value ?? 0,
      query,
    );
  }

  async get(id: string): Promise<PrivacyRequestView> {
    const [row] = await this.db.select().from(privacyRequest).where(eq(privacyRequest.id, id));
    if (row === undefined) {
      throw notFound("Privacy request");
    }
    return this.view(row);
  }

  /** The request row under `FOR UPDATE` (the lock every change of a request takes first). */
  async lockRequest(tx: Transaction, id: string): Promise<PrivacyRequestRow> {
    const [row] = await tx
      .select()
      .from(privacyRequest)
      .where(eq(privacyRequest.id, id))
      .for("update");
    if (row === undefined) {
      throw notFound("Privacy request");
    }
    return row;
  }

  /**
   * The subject of a request: its account, or the email the admin typed again (checked against the stored HMAC).
   * `undefined` for a customer subject whose account no longer exists.
   */
  async subjectOf(
    tx: Transaction,
    row: PrivacyRequestRow,
    typedEmail: string | undefined,
  ): Promise<ResolvedSubject | undefined> {
    if (row.subjectKind === "customer") {
      if (row.subjectCustomerId === null) {
        throw new Error(`Privacy request ${row.id} has a customer subject without an id`);
      }
      return this.reader.byCustomer(tx, row.subjectCustomerId);
    }
    const email = requireEmail(typedEmail, "email");
    if (
      row.subjectEmailHash === null ||
      !sameHash(subjectEmailHash(this.config, email), row.subjectEmailHash)
    ) {
      throw validationFailed([
        {
          path: "email",
          code: "subject_mismatch",
          message: "This is not the email of the request.",
        },
      ]);
    }
    return this.reader.byEmail(tx, email);
  }

  /**
   * `POST /admin/privacy/requests/{id}/export`: the document of the request's subject. An export request is completed by
   * it; an erasure request moves to `in_progress` (the owner may export before erasing). A closed request is refused.
   */
  async exportRequest(
    id: string,
    body: ExportBody,
    actorAdminId: string,
  ): Promise<PersonalDataExport> {
    const now = this.clock.now();
    return withTransaction(this.db, async (tx) => {
      const row = await this.lockRequest(tx, id);
      const status = row.status as PrivacyRequestStatus;
      if (!OPEN_STATUSES.includes(status)) {
        throw requestClosed();
      }
      const subject = await this.subjectOf(tx, row, body.email);
      if (subject === undefined) {
        throw subjectNotFound();
      }
      const built = await this.exports.build(tx, subject, now);
      const next: PrivacyRequestStatus = row.kind === "export" ? "completed" : "in_progress";
      if (next !== status) {
        const decision = decideRequestTransition(status, next);
        if (!decision.ok) {
          throw requestClosed();
        }
        await tx
          .update(privacyRequest)
          .set({
            status: next,
            handledBy: actorAdminId,
            ...(next === "completed" ? { completedAt: now, result: { ...built.counts } } : {}),
          })
          .where(eq(privacyRequest.id, id));
      }
      await this.audit.record(tx, actorAdminId, {
        action: "privacy.exported",
        targetKind: "privacy_request",
        targetId: id,
        detail: { ...built.counts, toStatus: next },
      });
      return built.document;
    });
  }

  /** An open erasure request, locked; anything else is refused before the subject is read. */
  private async openErasureRequest(tx: Transaction, id: string): Promise<PrivacyRequestRow> {
    const row = await this.lockRequest(tx, id);
    if (row.kind !== "erasure") {
      throw ruleViolation("Only an erasure request can erase.", "not_an_erasure_request");
    }
    if (!OPEN_STATUSES.includes(row.status as PrivacyRequestStatus)) {
      throw requestClosed();
    }
    return row;
  }

  /** `POST .../erase-preview`: counts and blockers, nothing changed. */
  async erasePreview(id: string, body: ErasePreviewBody): Promise<ErasePreviewView> {
    const now = this.clock.now();
    return withTransaction(this.db, async (tx) => {
      const row = await this.openErasureRequest(tx, id);
      const subject = await this.subjectOf(tx, row, body.email);
      if (subject === undefined) {
        throw subjectNotFound();
      }
      const preview = await this.erasure.preview(tx, subject, now);
      return {
        ...preview,
        blockers: preview.blockers.map((entry) => ({ ...entry })),
        reasons: [...preview.reasons],
      };
    });
  }

  /**
   * `POST .../erase` (ADR 0033 decision 6): locks the request, then the customer, then the orders and mail rows (inside
   * the erasure), erases, completes the request with the result and audits it, all in one transaction. A completed
   * erasure request answers its stored result again (idempotent per request id); a rejected one is `request_closed`.
   */
  async erase(id: string, body: EraseBody, actorAdminId: string): Promise<PrivacyRequestView> {
    const now = this.clock.now();
    const row = await withTransaction(this.db, async (tx) => {
      const locked = await this.lockRequest(tx, id);
      if (locked.kind === "erasure" && locked.status === "completed") {
        return locked;
      }
      await this.openErasureRequest(tx, id);
      const resolved = await this.subjectOf(tx, locked, body.email);
      if (resolved === undefined) {
        throw subjectNotFound();
      }
      let subject = resolved;
      if (resolved.customer !== undefined) {
        const customerRow = await this.erasure.lockCustomer(tx, resolved.customer.id);
        if (customerRow === undefined && resolved.kind === "customer") {
          throw subjectNotFound();
        }
        // The scope is taken again from the locked row (a parallel deletion may have removed the account).
        subject =
          customerRow === undefined
            ? emailSubject(resolved.email, undefined)
            : resolved.kind === "customer"
              ? customerSubject(customerRow)
              : emailSubject(resolved.email, customerRow);
      }
      const result = await this.erasure.erase(tx, subject, now);
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          status: "completed",
          completedAt: now,
          handledBy: actorAdminId,
          result: { ...result, orderNumbers: [...result.orderNumbers] },
        })
        .where(eq(privacyRequest.id, id))
        .returning();
      if (updated === undefined) {
        throw new Error(`Privacy request ${id} vanished under its lock`);
      }
      await this.audit.record(tx, actorAdminId, {
        action: "privacy.erased",
        targetKind: "privacy_request",
        targetId: id,
        detail: {
          orders: result.ordersAnonymised,
          mail: result.mailDeleted,
          customerDeleted: result.customerDeleted,
        },
      });
      return updated;
    });
    return this.view(row, now);
  }

  /** `POST .../reject`: closes an open request with a reason code (and optionally a note). */
  async reject(id: string, body: RejectBody, actorAdminId: string): Promise<PrivacyRequestView> {
    const now = this.clock.now();
    const row = await withTransaction(this.db, async (tx) => {
      const locked = await this.lockRequest(tx, id);
      const decision = decideRequestTransition(locked.status as PrivacyRequestStatus, "rejected");
      if (!decision.ok) {
        throw requestClosed();
      }
      const [updated] = await tx
        .update(privacyRequest)
        .set({
          status: "rejected",
          completedAt: now,
          handledBy: actorAdminId,
          result: { rejectReason: body.reasonCode },
          ...(body.note === undefined ? {} : { note: body.note }),
        })
        .where(eq(privacyRequest.id, id))
        .returning();
      if (updated === undefined) {
        throw new Error(`Privacy request ${id} vanished under its lock`);
      }
      await this.audit.record(tx, actorAdminId, {
        action: "privacy.request_changed",
        targetKind: "privacy_request",
        targetId: id,
        detail: { toStatus: "rejected", reason: body.reasonCode },
      });
      return updated;
    });
    return this.view(row, now);
  }
}
