import { CODE_PATTERN } from "../catalog/limits.js";

/*
 * Transactional email codes, patterns and limits (ADR 0031 decisions 3, 5, 7, 8, 9 and 14; plan step 2). Constants only;
 * the API, the outbox and the provider packages enforce them. Times are durations; core never reads a clock.
 */

/** The shape of an email provider code (`"resend"`, `"fake"`), the same as every other code. */
export const EMAIL_PROVIDER_CODE_PATTERN = CODE_PATTERN;

/**
 * A template key (`email_message.template_key`): dot-separated lower-case segments, at least two (`order.placed`,
 * `customer.password_reset`). ADR 0031 decision 5.
 */
export const EMAIL_TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** Longest template key, so a key always fits a dedupe key and a log line. */
export const EMAIL_TEMPLATE_KEY_MAX_LENGTH = 64;

/** A locale of a mail (`email_message.locale`): the same pattern as `sales_order.locale`. */
export const EMAIL_LOCALE_PATTERN = /^[a-z]{2,8}(-[a-z]{2,8})*$/;

/**
 * A provider or outcome code (`EmailProviderResult.providerCodes`, `email_message.provider_code`,
 * `provider_message_id`, `last_error_code`): short, no spaces, so a provider's message text (which can echo an address)
 * never fits. ADR 0031 decision 5, the same pattern as `domain_event`.
 */
export const EMAIL_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/** A tag value sent to the provider (`OutgoingEmail.tags.category`): Resend's tag rule (R2). */
export const EMAIL_TAG_VALUE_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

/** Who a mail goes to (`email_message.recipient_kind`). `admin` is the test send. */
export const EMAIL_RECIPIENT_KINDS = Object.freeze(["customer", "guest", "admin"] as const);

export type EmailRecipientKind = (typeof EMAIL_RECIPIENT_KINDS)[number];

export const EMAIL_LIMITS = Object.freeze({
  /** A subject, in code points, after sanitizing (ADR 0031 decision 14). */
  subjectMaxLength: 200,
  /** `EMAIL_FROM` / `EMAIL_REPLY_TO` as written in the configuration, in code points (decision 12). */
  mailboxMaxLength: 200,
  /** A display name, in code points after NFC normalization. */
  displayNameMaxLength: 100,
  /** The local part of an address (RFC 5321 section 4.5.3.1.1). */
  localPartMaxLength: 64,
  /** One label of a domain (RFC 1035). */
  domainLabelMaxLength: 63,
  /** Stored `variables` (`pg_column_size` CHECK, decision 5). */
  variablesMaxBytes: 16 * 1024,
  /** Most codes one provider failure carries. */
  maxProviderCodes: 10,
  /** An idempotency key, in characters (Resend R4: 1 to 256). The outbox uses the message id (36). */
  idempotencyKeyMaxLength: 256,
});

/** Time the API gives one `send` before it aborts it (ADR 0031 decision 3): the API decides, not the plugin. */
export const EMAIL_SEND_TIMEOUT_MS = 10_000;

/** How long a claimed row stays `sending` before another claim may retry it (decision 6). */
export const EMAIL_LEASE_SECONDS = 120;

/**
 * Latest send of a mail after it was created (decision 7): inside Resend's 24 h idempotency window (R4), so every retry
 * of one message is deduplicated by the provider.
 */
export const EMAIL_DEADLINE_HOURS = 12;

/** Latest send of an auth mail (reset, verification) after it was created, also capped by its token's expiry. */
export const AUTH_EMAIL_DEADLINE_MINUTES = 60;
