import { EMAIL_SEND_TIMEOUT_MS, type EmailAddress } from "@fluxkit/core";

export const EMAIL_DELIVERY_CONFIG = Symbol("fluxkit:email-delivery-config");

/** How fast and how long the sender works (ADR 0031 decision 6). Tests shorten the timeout. */
export interface EmailDeliveryTuning {
  /** Time one `send` gets before the API aborts it (core `EMAIL_SEND_TIMEOUT_MS`, 10 s). */
  readonly sendTimeoutMs: number;
  /** Most provider calls one process starts per second, job 9 and the immediate attempts together (Resend R7: 10). */
  readonly sendsPerSecond: number;
  /** Immediate attempts that may wait for the pacing at once; more are left to job 9. */
  readonly maxWaitingImmediate: number;
}

export const DEFAULT_EMAIL_DELIVERY_TUNING: Readonly<EmailDeliveryTuning> = Object.freeze({
  sendTimeoutMs: EMAIL_SEND_TIMEOUT_MS,
  sendsPerSecond: 8,
  maxWaitingImmediate: 50,
});

/** From `EMAIL_FROM`, `EMAIL_REPLY_TO` and `STOREFRONT_PUBLIC_URL` (docs/contracts/config.md). */
export interface EmailDeliveryConfig {
  /** The sender; its display name is the shop name in mail. Required whenever a provider is loaded. */
  readonly from: EmailAddress | null;
  readonly replyTo: EmailAddress | null;
  /** The only origin of links in mail, without a trailing slash; never a request's `Host`. */
  readonly storefrontPublicUrl: string | null;
  readonly tuning: EmailDeliveryTuning;
}
