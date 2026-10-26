import { Inject, Injectable, Logger } from "@nestjs/common";
import type { AdminPrincipal } from "../../auth/admin-authenticator.js";
import { CLOCK, type Clock } from "../../auth/clock.js";
import { withJobTransaction } from "../../common/job-limits.js";
import { LOCALE_CONFIG, type LocaleConfig } from "../../common/locale.js";
import { toPage, type PaginationQuery } from "../../common/pagination.js";
import {
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
} from "../../common/problem.js";
import { withTransaction } from "../../common/transaction.js";
import { DRIZZLE, type Database } from "../../database/database.module.js";
import {
  EMAIL_DELIVERY_CONFIG,
  EmailMessageChanges,
  EmailOutbox,
  EmailOutboxRepository,
  EmailSender,
  type EmailDeliveryConfig,
} from "../outbox/index.js";
import { EmailProviderRegistry, type EmailProviderSource } from "../registry/index.js";
import {
  EMAIL_THEME,
  EmailTemplateRegistry,
  renderEmail,
  sampleEmailLinks,
  type EmailTemplateSource,
} from "../templates/index.js";
import { EmailAdminRepository, type EmailMessageFilter } from "./email-admin.repository.js";
import {
  isResendableRow,
  toEmailMessageDetail,
  toEmailMessageResponse,
} from "./email-admin.mapper.js";
import type {
  EmailMessageDetailResponse,
  EmailMessageIdResponse,
  EmailMessagePageResponse,
  EmailMessageResponse,
  EmailPreviewResponse,
  EmailStatusResponse,
  EmailTemplateListResponse,
  ListEmailMessagesQuery,
  SendTestEmailBody,
} from "./email-admin.schemas.js";

/** Width of the window of the status counts (ADR 0031 decision 15: "last 24 h"). */
export const STATUS_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/** The messages of the 409 rules; each is a stable `rule` code the admin screen translates. */
const NOT_CONFIGURED = () =>
  ruleViolation(
    "No email provider is configured (EMAIL_PROVIDER=none): nothing can be sent.",
    "email_not_configured",
  );

const ADDRESS_UNDELIVERABLE = () =>
  ruleViolation(
    "The address cannot be used in a mail header (for example it is not ASCII).",
    "address_undeliverable",
  );

/**
 * The admin email API (ADR 0031 decision 15): status, test send, the outbox with detail, resend and cancel, and the
 * templates with their preview. Every change of a message goes through `EmailMessageChanges` (the single writer; the
 * resend through `EmailOutbox.enqueue`, which creates the row with the `admin` actor). Sending is never done here: the
 * request commits a `pending` row and then starts the immediate attempt without waiting for it (`startSendNow`); job 9
 * takes it if that attempt is lost. Logs carry ids, template keys and rule codes only: never an address or a variable.
 */
@Injectable()
export class EmailAdminService {
  private readonly logger = new Logger(EmailAdminService.name);

  constructor(
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(EmailAdminRepository) private readonly repository: EmailAdminRepository,
    @Inject(EmailOutboxRepository) private readonly outboxRows: EmailOutboxRepository,
    @Inject(EmailMessageChanges) private readonly changes: EmailMessageChanges,
    @Inject(EmailOutbox) private readonly outbox: EmailOutbox,
    @Inject(EmailSender) private readonly sender: EmailSender,
    @Inject(EmailProviderRegistry) private readonly providers: EmailProviderSource,
    @Inject(EmailTemplateRegistry) private readonly templates: EmailTemplateSource,
    @Inject(EMAIL_DELIVERY_CONFIG) private readonly config: EmailDeliveryConfig,
    @Inject(LOCALE_CONFIG) private readonly locales: LocaleConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async status(): Promise<EmailStatusResponse> {
    const since = new Date(this.clock.now().getTime() - STATUS_WINDOW_HOURS * HOUR_MS);
    const summary = await this.repository.summarize(this.database, since);
    const provider = this.providers.get();
    return {
      configured: this.providers.deliveryEnabled(),
      providerCode: provider?.code ?? null,
      from: this.config.from,
      replyTo: this.config.replyTo,
      since: since.toISOString(),
      counts: summary.counts as EmailStatusResponse["counts"],
      queueDepth: summary.queueDepth,
      oldestPendingAt: summary.oldestPendingAt?.toISOString() ?? null,
      errorCodes: [...summary.errorCodes],
    };
  }

  /** Sends `admin.test` to the CALLER's own address only: the body has no recipient (ADR 0031 decision 15). */
  async sendTest(admin: AdminPrincipal, body: SendTestEmailBody): Promise<EmailMessageIdResponse> {
    const provider = this.providers.get();
    if (provider === undefined) {
      throw NOT_CONFIGURED();
    }
    const locale = this.checkedLocale(body.locale);
    const result = await withTransaction(this.database, (tx) =>
      this.outbox.enqueue(tx, {
        templateKey: "admin.test",
        locale,
        to: admin.email,
        recipientKind: "admin",
        adminUserId: admin.userId,
        createdByAdminId: admin.userId,
        variables: { providerCode: provider.code },
        now: this.clock.now(),
      }),
    );
    if (result.status === "undeliverable") {
      throw ADDRESS_UNDELIVERABLE();
    }
    if (result.status === "disabled") {
      throw NOT_CONFIGURED();
    }
    if (result.status === "duplicate") {
      throw new Error("A test send has no dedupe key and cannot be a duplicate");
    }
    this.logger.log(`Email ${result.id} (admin.test) queued by an admin`);
    this.sender.startSendNow(result.id);
    return { messageId: result.id };
  }

  async list(query: ListEmailMessagesQuery): Promise<EmailMessagePageResponse> {
    const pagination: PaginationQuery = { limit: query.limit, offset: query.offset };
    const filter: EmailMessageFilter = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.template === undefined ? {} : { templateKey: query.template }),
      ...(query.recipient === undefined ? {} : { recipient: query.recipient }),
      ...(query.orderId === undefined ? {} : { orderId: query.orderId }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
    };
    const { rows, total } = await this.repository.list(
      this.database,
      filter,
      pagination.limit,
      pagination.offset,
    );
    return toPage(rows.map(toEmailMessageResponse), total, pagination);
  }

  async get(id: string): Promise<EmailMessageDetailResponse> {
    const row = await this.repository.find(this.database, id);
    if (row === undefined) {
      throw notFound("Email message");
    }
    return toEmailMessageDetail(row);
  }

  /** `pending -> cancelled` by the single writer; exactly one of two cancels, or of a cancel and a claim, wins. */
  async cancel(id: string): Promise<EmailMessageResponse> {
    const result = await this.changes.cancel(id, this.clock.now());
    if (result.kind === "not_found") {
      throw notFound("Email message");
    }
    if (result.kind === "refused") {
      throw invalidTransition(
        `Only a pending message can be cancelled; this one is ${result.status}.`,
        "not_pending",
      );
    }
    this.logger.log(`Email ${id} (${result.row.templateKey}) cancelled by an admin`);
    return toEmailMessageResponse(result.row);
  }

  /**
   * A NEW row (`resend_of`, a fresh id and idempotency key, no dedupe key) with the same template, locale and frozen
   * variables, made with the CURRENT template version (the original's version may be gone: the sender never upgrades a
   * queued mail on the fly, a resend does). The original stays as it is. Refused while the original is pending or
   * sending (it may still go out), for the account mails of a customer, when the template is not registered any more or
   * the variables fail its current schema. The original is locked for the decision, so a sender recording its result
   * and a resend cannot interleave. A mail of the `admin` kind (the test send) goes to the address of the admin who
   * resends it, never to the one who sent the first (ADR open question 8).
   */
  async resend(admin: AdminPrincipal, id: string): Promise<EmailMessageIdResponse> {
    const messageId = await withJobTransaction(this.database, async (tx) => {
      const original = await this.outboxRows.lock(tx, id);
      if (original === undefined) {
        throw notFound("Email message");
      }
      if (!this.providers.deliveryEnabled()) {
        throw NOT_CONFIGURED();
      }
      if (original.status === "pending" || original.status === "sending") {
        throw ruleViolation(
          "The message is still waiting to be sent or being sent; resend it when it has ended.",
          "message_open",
        );
      }
      if (!isResendableRow(original)) {
        throw ruleViolation(
          "An account mail of a customer is not resent: the person asks for a new one on the storefront.",
          "not_resendable",
        );
      }
      const entry = this.templates.get(original.templateKey);
      if (entry === undefined) {
        throw ruleViolation(
          "The template of this message is not registered any more.",
          "template_unavailable",
        );
      }
      if (!entry.template.variablesSchema.safeParse(original.variables).success) {
        throw ruleViolation(
          "The stored variables do not pass the current version of the template.",
          "variables_invalid",
        );
      }
      const toAdmin = original.recipientKind === "admin";
      const result = await this.outbox.enqueue(tx, {
        templateKey: original.templateKey,
        locale: original.locale,
        to: toAdmin ? admin.email : original.toAddress,
        recipientKind: original.recipientKind as "customer" | "guest" | "admin",
        customerId: original.customerId,
        orderId: original.orderId,
        adminUserId: toAdmin ? admin.userId : null,
        variables: original.variables as Record<string, unknown>,
        createdByAdminId: admin.userId,
        resendOf: original.id,
        now: this.clock.now(),
      });
      if (result.status === "undeliverable") {
        throw ADDRESS_UNDELIVERABLE();
      }
      if (result.status === "disabled") {
        throw NOT_CONFIGURED();
      }
      if (result.status === "duplicate") {
        throw new Error("A resend has no dedupe key and cannot be a duplicate");
      }
      return result.id;
    });
    this.logger.log(`Email ${messageId} queued by an admin as a resend of ${id}`);
    this.sender.startSendNow(messageId);
    return { messageId };
  }

  listTemplates(): EmailTemplateListResponse {
    const items = this.templates.keys().flatMap((key) => {
      const entry = this.templates.get(key);
      if (entry === undefined) {
        return [];
      }
      return [
        {
          key,
          version: entry.template.version,
          category: entry.template.category,
          locales: Object.keys(entry.catalogs).sort(),
        },
      ];
    });
    return { items };
  }

  /** Renders the template's own sample variables: no database, no real customer data, no send, placeholder links. */
  preview(key: string, requestedLocale: string | undefined): EmailPreviewResponse {
    const entry = this.templates.get(key);
    if (entry === undefined) {
      throw notFound("Email template");
    }
    const locale = this.checkedLocale(requestedLocale);
    const rendered = renderEmail(entry, entry.template.sampleVariables, {
      locale,
      defaultLocale: this.locales.defaultLocale,
      theme: EMAIL_THEME,
      links: sampleEmailLinks(locale),
      shopName: this.config.from?.displayName ?? null,
    });
    return {
      key,
      version: entry.template.version,
      category: rendered.category,
      locale,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  }

  private checkedLocale(requested: string | undefined): string {
    const locale = requested ?? this.locales.defaultLocale;
    if (!this.locales.locales.includes(locale)) {
      throw validationFailed([
        {
          path: "locale",
          code: "invalid_value",
          message: `Must be one of: ${this.locales.locales.join(", ")}.`,
        },
      ]);
    }
    return locale;
  }
}
