import type { IncomingMessage, ServerResponse } from "node:http";
import { PAYMENT_LIMITS } from "@fluxkit/core";

/** The path prefix of the payment webhook route (ADR 0032 decision 12). */
export const PAYMENT_WEBHOOK_PATH = "/webhooks/payments";

/** Where the raw body bytes of a webhook request are kept for the controller. */
export const RAW_WEBHOOK_BODY = Symbol("fluxkit:raw-webhook-body");

export type RequestWithRawWebhookBody = IncomingMessage & { [RAW_WEBHOOK_BODY]?: Buffer };

/** A client error with its own status, which the problem filter answers like a body-parser error (no detail echoed). */
class WebhookBodyError extends Error {
  constructor(
    readonly status: number,
    readonly type: string,
  ) {
    super(type);
  }
}

/**
 * Reads the EXACT bytes of a payment webhook request, before any JSON parser sees them (ADR 0032 decisions 12 and 14):
 * the signature covers the raw body, and a parsed body is never re-serialized for verification. Mounted by the app
 * factory on `PAYMENT_WEBHOOK_PATH` only, before Nest registers its JSON parser, so the raw bytes of every other route
 * are never kept (the "rawBody" of decision 12, scoped to this route; no dependency). Once the stream is read the JSON
 * parser skips the request. A body over `PAYMENT_LIMITS.webhookBodyMaxBytes` (64 KiB, by `Content-Length` or as it
 * arrives) is refused with 413 before the rest is read. The bytes are never logged.
 */
export function paymentWebhookRawBody(
  maxBytes: number = PAYMENT_LIMITS.webhookBodyMaxBytes,
): (request: IncomingMessage, response: ServerResponse, next: (error?: unknown) => void) => void {
  return (request, _response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    const declared = Number(request.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      next(new WebhookBodyError(413, "entity.too.large"));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const finish = (error?: unknown): void => {
      if (finished) {
        return;
      }
      finished = true;
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      if (error === undefined) {
        (request as RequestWithRawWebhookBody)[RAW_WEBHOOK_BODY] = Buffer.concat(chunks, size);
      } else {
        // Drain what is left so the connection can answer; nothing more is kept.
        request.resume();
      }
      next(error);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBytes) {
        finish(new WebhookBodyError(413, "entity.too.large"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => finish();
    const onError = (): void => finish(new WebhookBodyError(400, "request.aborted"));
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  };
}
