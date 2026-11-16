import { createHash, timingSafeEqual } from "node:crypto";
import {
  validateEmailAddress,
  type EmailSuppressionReason,
  type EmailWebhookResult,
  type EmailWebhookVerifier,
} from "@fluxkit/core";

const REASONS: Readonly<Record<string, EmailSuppressionReason | undefined>> = Object.freeze({
  hard_bounce: "hard_bounce",
  spam: "complaint",
  unsubscribed: "unsubscribe",
  blocked: "blocked",
});

function parsedFact(value: unknown): EmailWebhookResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "malformed" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.event !== "string" || body.event.length > 128)
    return { ok: false, reason: "malformed" };
  const reason = Object.hasOwn(REASONS, body.event) ? REASONS[body.event] : undefined;
  if (reason === undefined) return { ok: true, facts: [], ignored: true };
  const recipient = validateEmailAddress(body.email);
  if (
    !recipient.ok ||
    typeof body.id !== "number" ||
    !Number.isSafeInteger(body.id) ||
    body.id < 0 ||
    typeof body["message-id"] !== "string" ||
    body["message-id"].length < 1 ||
    body["message-id"].length > 255 ||
    !/^[\x21-\x7e]+$/.test(body["message-id"]) ||
    typeof body.ts_event !== "number" ||
    !Number.isSafeInteger(body.ts_event) ||
    body.ts_event < 0 ||
    body.ts_event > 8_640_000_000_000
  ) {
    return { ok: false, reason: "malformed" };
  }
  // TODO(fluxkit): not live-verified — tuple stability, payload spellings/timestamps/retries and single-object delivery (batching).
  const tuple = [body.id, body["message-id"], recipient.address, body.event, body.ts_event];
  return {
    ok: true,
    ignored: false,
    facts: [
      {
        eventKey: `v1:${createHash("sha256").update(JSON.stringify(tuple)).digest("hex")}`,
        recipient: recipient.address,
        reason,
        eventAt: new Date(body.ts_event * 1000),
      },
    ],
  };
}

/** Bearer authentication does not sign the body. Keep the token secret and use HTTPS at the edge. */
export function createBrevoWebhookVerifier(secret: string): EmailWebhookVerifier {
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return (input) => {
    // TODO(fluxkit): not live-verified — exact Authorization: Bearer <token> header emission.
    const authorization = input.headers.authorization;
    if (typeof authorization !== "string" || authorization.length > 1031) {
      return { ok: false, reason: "unauthenticated" };
    }
    const actual = createHash("sha256").update(authorization).digest();
    if (!timingSafeEqual(expected, actual)) return { ok: false, reason: "unauthenticated" };
    let body: unknown;
    try {
      body = JSON.parse(Buffer.from(input.rawBody).toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    return parsedFact(body);
  };
}
