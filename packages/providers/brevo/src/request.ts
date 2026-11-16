import type { EmailAddress, OutgoingEmail } from "@fluxkit/core";

interface BrevoMailbox {
  readonly email: string;
  readonly name?: string;
}
export interface BrevoEmailBody {
  readonly sender: BrevoMailbox;
  readonly to: readonly [BrevoMailbox];
  readonly subject: string;
  readonly htmlContent: string;
  readonly textContent: string;
  readonly replyTo?: BrevoMailbox;
  readonly tags: readonly [string];
  readonly headers: { readonly idempotencyKey: string };
}
function mailbox(value: EmailAddress): BrevoMailbox {
  return {
    email: value.address,
    ...(value.displayName === null ? {} : { name: value.displayName }),
  };
}
/** TODO(fluxkit): not live-verified — B1 inline fields/replyTo/tags and B2 UUID header casing/semantics. */
export function brevoBodyOf(message: OutgoingEmail, idempotencyKey: string): BrevoEmailBody {
  return {
    sender: mailbox(message.from),
    to: [mailbox(message.to)],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
    ...(message.replyTo === undefined ? {} : { replyTo: mailbox(message.replyTo) }),
    tags: [message.tags.category],
    headers: { idempotencyKey },
  };
}
