import { formatMailbox, type OutgoingEmail } from "@fluxkit/core";

/*
 * The body of `POST /emails` (plan section 2, R2 and R3). Built only from a message that passed core
 * `validateOutgoingEmail` (header-safe mailboxes and subject), and sent as JSON, so no value can add a header or a
 * recipient: there is no SMTP header assembly and no `headers`, `cc` or `bcc` member (ADR 0031 decision 16).
 */

/** The tag Resend carries for the template category (R2: `tags[]{name, value}`, ASCII letters, digits, `_`, `-`). */
export const RESEND_CATEGORY_TAG = "category";

export interface ResendEmailBody {
  readonly from: string;
  /** One recipient (v1), as an array (R2 accepts a string or an array of at most 50). */
  readonly to: readonly [string];
  readonly subject: string;
  readonly html: string;
  /** Always sent: R2 says an omitted `text` is generated from the HTML. */
  readonly text: string;
  /**
   * R3 is UNKNOWN: Resend's send-email page shows the reply-to parameter without its JSON key. `reply_to` is ASSUMED
   * (the snake_case of the other members) and pinned by the stub; plan step 6 S1 verifies it with a live send (the
   * receiving mailbox must show this address as `Reply-To`). Unverified until then.
   */
  readonly reply_to?: string;
  readonly tags: readonly [{ readonly name: typeof RESEND_CATEGORY_TAG; readonly value: string }];
}

/**
 * The JSON body for one message. Mailboxes are written by core `formatMailbox` (`"Display Name" <address>` or the bare
 * address); R2 shows `Name <address>`, the quoted form is the RFC 5322 equivalent (S1 verifies Resend takes it).
 */
export function resendBodyOf(message: OutgoingEmail): ResendEmailBody {
  return {
    from: formatMailbox(message.from),
    to: [formatMailbox(message.to)],
    subject: message.subject,
    html: message.html,
    text: message.text,
    ...(message.replyTo === undefined ? {} : { reply_to: formatMailbox(message.replyTo) }),
    tags: [{ name: RESEND_CATEGORY_TAG, value: message.tags.category }],
  };
}
