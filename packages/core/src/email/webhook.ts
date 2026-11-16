import { validateEmailAddress } from "./address.js";

/** Provider feedback is restricted to suppression facts; it cannot change delivery/routing state. */
export const EMAIL_SUPPRESSION_REASONS = Object.freeze([
  "hard_bounce",
  "complaint",
  "unsubscribe",
  "blocked",
] as const);
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

export const EMAIL_WEBHOOK_MAX_FACTS = 100;
export const EMAIL_WEBHOOK_EVENT_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/;
export const EMAIL_WEBHOOK_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const EMAIL_WEBHOOK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
export const EMAIL_WEBHOOK_RECEIPT_TTL_MS = 8 * 24 * 60 * 60 * 1000;

export interface EmailSuppressionFact {
  readonly eventKey: string;
  /** Already normalized through validateEmailAddress; no provider-specific rewriting. */
  readonly recipient: string;
  readonly reason: EmailSuppressionReason;
  readonly eventAt: Date;
}

export type EmailWebhookResult =
  | { readonly ok: false; readonly reason: "unauthenticated" | "malformed" | "stale" }
  | {
      readonly ok: true;
      readonly facts: readonly EmailSuppressionFact[];
      readonly ignored: boolean;
    };

/** Optional on a discovered email provider. A missing verifier means the webhook is disabled. */
export type EmailWebhookVerifier = (input: {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Uint8Array;
  readonly now: Date;
}) => EmailWebhookResult;

export type EmailSuppressionFactValidation =
  | { readonly ok: true; readonly fact: EmailSuppressionFact }
  | { readonly ok: false; readonly reason: "malformed" | "stale" };

/** Recheck plugin output at the core boundary. Age limits are inclusive and separate from delivery authentication. */
export function validateEmailSuppressionFact(
  value: unknown,
  now: Date,
): EmailSuppressionFactValidation {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "malformed" };
  const fact = value as Record<string, unknown>;
  const address = validateEmailAddress(fact.recipient);
  if (
    typeof fact.eventKey !== "string" ||
    !EMAIL_WEBHOOK_EVENT_KEY_PATTERN.test(fact.eventKey) ||
    !address.ok ||
    address.address !== fact.recipient ||
    !EMAIL_SUPPRESSION_REASONS.some((reason) => reason === fact.reason) ||
    !(fact.eventAt instanceof Date) ||
    !Number.isFinite(fact.eventAt.getTime()) ||
    !Number.isFinite(now.getTime())
  ) {
    return { ok: false, reason: "malformed" };
  }
  const age = now.getTime() - fact.eventAt.getTime();
  if (age > EMAIL_WEBHOOK_EVENT_MAX_AGE_MS || age < -EMAIL_WEBHOOK_FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, fact: value as EmailSuppressionFact };
}
