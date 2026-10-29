import { createHmac } from "node:crypto";
import { normalizeEmail } from "@fluxkit/core";

/** Injection token of the privacy configuration. */
export const PRIVACY_CONFIG = Symbol("PRIVACY_CONFIG");

export interface PrivacyConfig {
  /** `ORDER_TOKEN_SECRET`: keys the HMAC of a subject's email (its own label, ADR 0033 decision 9). */
  readonly tokenSecret: string | null;
}

/** The label of the third use of `ORDER_TOKEN_SECRET` (after the guest order token and the auth tokens). */
const SUBJECT_EMAIL_LABEL = "fluxkit:privacy-subject-email:v1:";

/**
 * HMAC-SHA256 (hex) of a normalized email under the privacy label: `privacy_request.subject_email_hash`. A repeated request
 * for the same address is found without storing the address; the hash alone cannot be reversed without the secret.
 */
export function subjectEmailHash(config: PrivacyConfig, email: string): string {
  if (config.tokenSecret === null) {
    // main.ts refuses to start without ORDER_TOKEN_SECRET; only a caller that built the app without it lands here.
    throw new Error("ORDER_TOKEN_SECRET is needed to record a privacy request");
  }
  return createHmac("sha256", config.tokenSecret)
    .update(SUBJECT_EMAIL_LABEL + normalizeEmail(email), "utf8")
    .digest("hex");
}
