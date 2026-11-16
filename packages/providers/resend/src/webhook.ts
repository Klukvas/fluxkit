import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  EMAIL_WEBHOOK_MAX_FACTS,
  validateEmailAddress,
  type EmailSuppressionReason,
  type EmailWebhookResult,
  type EmailWebhookVerifier,
} from "@fluxkit/core";

const SIGNED_TOLERANCE_SECONDS = 300;
const DELIVERY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EVENT_TIME = z.iso.datetime({ offset: true });

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function header(
  headers: Parameters<EmailWebhookVerifier>[0]["headers"],
  name: string,
  maximum: number,
): string | undefined {
  const value = headers[name];
  return typeof value === "string" && value.length <= maximum ? value : undefined;
}

function verifiedId(
  input: Parameters<EmailWebhookVerifier>[0],
  key: Uint8Array,
): string | undefined {
  const id = header(input.headers, "svix-id", 128);
  const timestamp = header(input.headers, "svix-timestamp", 12);
  const signatures = header(input.headers, "svix-signature", 4096);
  if (
    id === undefined ||
    !DELIVERY_ID_PATTERN.test(id) ||
    timestamp === undefined ||
    !/^[0-9]{1,12}$/.test(timestamp) ||
    signatures === undefined ||
    !Number.isFinite(input.now.getTime()) ||
    Math.abs(input.now.getTime() / 1000 - Number(timestamp)) > SIGNED_TOLERANCE_SECONDS
  ) {
    return undefined;
  }
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(input.rawBody)
    .digest();
  const valid = signatures.split(" ").some((part) => {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/.exec(part);
    if (match?.[1] === undefined) return false;
    const actual = Buffer.from(match[1], "base64");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  return valid ? id : undefined;
}

function parsedFact(body: Record<string, unknown>, id: string): EmailWebhookResult {
  const event = body.type;
  if (typeof event !== "string" || event.length > 128) return { ok: false, reason: "malformed" };
  let reason: EmailSuppressionReason;
  const data = object(body.data);
  if (event === "email.bounced") {
    const bounce = object(data?.bounce);
    if (typeof bounce?.type !== "string") return { ok: false, reason: "malformed" };
    if (bounce.type !== "Permanent") return { ok: true, facts: [], ignored: true };
    reason = "hard_bounce";
  } else if (event === "email.complained") reason = "complaint";
  else if (event === "email.suppressed" || event === "suppression.added") reason = "blocked";
  else return { ok: true, facts: [], ignored: true };
  if (data === undefined || typeof body.created_at !== "string" || body.created_at.length > 40) {
    return { ok: false, reason: "malformed" };
  }
  // TODO(fluxkit): not live-verified — subscriptions, exact event shapes/timestamps/retries and historical blocks.
  const eventAt = new Date(body.created_at);
  if (!EVENT_TIME.safeParse(body.created_at).success || !Number.isFinite(eventAt.getTime()))
    return { ok: false, reason: "malformed" };
  const recipients: unknown = event === "suppression.added" ? [data.email] : data.to;
  if (
    !Array.isArray(recipients) ||
    recipients.length < 1 ||
    recipients.length > EMAIL_WEBHOOK_MAX_FACTS
  ) {
    return { ok: false, reason: "malformed" };
  }
  const facts = [];
  for (const recipient of recipients) {
    const address = validateEmailAddress(recipient);
    if (!address.ok) return { ok: false, reason: "malformed" };
    facts.push({
      // The digest keeps keys address-free and stable when a retry changes recipient order.
      eventKey: `${id}:${createHash("sha256").update(address.address).digest("hex")}`,
      recipient: address.address,
      reason,
      eventAt,
    });
  }
  return { ok: true, facts, ignored: false };
}

/** Secret was validated by readResendWebhookSecret. Signature authentication always precedes JSON parsing. */
export function createResendWebhookVerifier(secret: string): EmailWebhookVerifier {
  const key = Buffer.from(secret.slice(6), "base64");
  return (input) => {
    const id = verifiedId(input, key);
    if (id === undefined) return { ok: false, reason: "unauthenticated" };
    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const record = object(body);
    return record === undefined ? { ok: false, reason: "malformed" } : parsedFact(record, id);
  };
}
