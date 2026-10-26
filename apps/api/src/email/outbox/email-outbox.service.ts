import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  buildEmailDedupeKey,
  emailDeadlineAt,
  isEmailLocale,
  validateEmailAddress,
  type EmailAddressValidation,
  type EmailRecipientKind,
} from "@fluxkit/core";
import type { Transaction } from "../../common/transaction.js";
import { EmailProviderRegistry, type EmailProviderSource } from "../registry/index.js";
import { EmailTemplateRegistry, type EmailTemplateSource } from "../templates/index.js";
import { EmailMessageChanges } from "./email-message-changes.js";

export interface EnqueueEmailInput {
  /** A registered template key; its current version is stored with the mail. */
  readonly templateKey: string;
  /** `EMAIL_LOCALE_PATTERN`: the order's locale, else the page's, else `DEFAULT_LOCALE` (ADR 0031 decision 5). */
  readonly locale: string;
  /** The one recipient, as the account or order holds it; stored normalized. */
  readonly to: string;
  readonly recipientKind: EmailRecipientKind;
  readonly customerId?: string | null;
  readonly orderId?: string | null;
  /** The admin recipient of a test send (`recipientKind: "admin"` only). */
  readonly adminUserId?: string | null;
  /** The frozen template input; must pass the template's schema. Never a token, a link or a rendered text. */
  readonly variables: Readonly<Record<string, unknown>>;
  /** The domain event that causes the mail: the row gets `dedupe_key = <eventId>:<templateKey>`. */
  readonly eventId?: string;
  /** The expiry of the token an auth mail carries: its deadline is `min(expires_at, created_at + 1 h)`. */
  readonly authTokenExpiresAt?: Date;
  /** The admin who made a resend or a test send (the creation is then the `admin` actor's). */
  readonly createdByAdminId?: string | null;
  readonly resendOf?: string | null;
  /** One clock reading: `created_at`, the first `next_attempt_at` and the base of the deadline. */
  readonly now: Date;
}

export type EnqueueEmailResult =
  | { readonly status: "enqueued"; readonly id: string }
  /** A row with the same dedupe key exists (a redelivered event): nothing written. */
  | { readonly status: "duplicate" }
  /** `EMAIL_PROVIDER=none`: nothing written, and turning mail on later sends nothing for this (ADR 0031 decision 11). */
  | { readonly status: "disabled" }
  /** The address cannot go into a mail header (core `validateEmailAddress`, e.g. non-ASCII): nothing written, logged. */
  | {
      readonly status: "undeliverable";
      readonly reason: Exclude<EmailAddressValidation, { ok: true }>["reason"];
    };

/**
 * Puts a mail into the outbox (ADR 0031 decision 5) inside the CALLER's transaction: an event handler's (with the event
 * id, so a redelivered event makes no second row) or an auth flow's (with its token row). It never sends; job 9 or the
 * immediate attempt (`EmailSender.sendNow`, after the caller's commit) does.
 *
 * A wrong template key, variables that fail the template's schema or a malformed locale are bugs of the caller and
 * throw (the caller's transaction rolls back). An address that cannot be put into a mail header is not an error of the
 * caller (an account may hold a non-ASCII address, which `validateEmail` allows): it is answered `undeliverable` and
 * logged with the template key and the reason code only (plan step 2 decision: no row, a log code).
 */
@Injectable()
export class EmailOutbox {
  private readonly logger = new Logger("EmailOutbox");

  constructor(
    @Inject(EmailProviderRegistry) private readonly providers: EmailProviderSource,
    @Inject(EmailTemplateRegistry) private readonly templates: EmailTemplateSource,
    @Inject(EmailMessageChanges) private readonly changes: EmailMessageChanges,
  ) {}

  /** Whether mail can be sent at all (`EMAIL_PROVIDER` is not `none`). */
  enabled(): boolean {
    return this.providers.deliveryEnabled();
  }

  async enqueue(tx: Transaction, input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    if (!this.providers.deliveryEnabled()) {
      return { status: "disabled" };
    }
    const entry = this.templates.get(input.templateKey);
    if (entry === undefined) {
      throw new RangeError(`No email template is registered for ${input.templateKey}`);
    }
    if (!isEmailLocale(input.locale)) {
      throw new RangeError("An email locale must match EMAIL_LOCALE_PATTERN");
    }
    const parsed = entry.template.variablesSchema.safeParse(input.variables);
    if (!parsed.success) {
      throw new RangeError(`The variables of ${input.templateKey} do not pass its schema`);
    }
    const address = validateEmailAddress(input.to);
    if (!address.ok) {
      this.logger.warn(
        `Email ${input.templateKey} not enqueued: the recipient address is ${address.reason}`,
      );
      return { status: "undeliverable", reason: address.reason };
    }
    const createdAt = input.now;
    const deadlineAt = emailDeadlineAt({
      createdAt,
      authTokenExpiresAt: input.authTokenExpiresAt,
    });
    if (deadlineAt.getTime() <= createdAt.getTime()) {
      throw new RangeError("An auth mail needs a token that has not expired yet");
    }
    const id = await this.changes.create(
      tx,
      {
        templateKey: input.templateKey,
        templateVersion: entry.template.version,
        locale: input.locale,
        toAddress: address.address,
        recipientKind: input.recipientKind,
        customerId: input.customerId ?? null,
        orderId: input.orderId ?? null,
        adminUserId: input.adminUserId ?? null,
        variables: parsed.data as Record<string, unknown>,
        dedupeKey:
          input.eventId === undefined
            ? null
            : buildEmailDedupeKey(input.eventId, input.templateKey),
        createdAt,
        nextAttemptAt: createdAt,
        deadlineAt,
        resendOf: input.resendOf ?? null,
        createdByAdminId: input.createdByAdminId ?? null,
      },
      input.createdByAdminId === undefined || input.createdByAdminId === null ? "system" : "admin",
    );
    return id === undefined ? { status: "duplicate" } : { status: "enqueued", id };
  }
}
