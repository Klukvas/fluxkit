import type { IncomingMessage, ServerResponse } from "node:http";

export const EMAIL_WEBHOOK_BODY_MAX_BYTES = 64 * 1024;

/** The path prefix of the email webhook route (ADR 0056 decision 2). */
export const EMAIL_WEBHOOK_PATH = "/webhooks/email";

/** Where the raw body bytes of a webhook request are kept for the controller. */
export const RAW_EMAIL_WEBHOOK_BODY = Symbol("fluxkit:raw-email-webhook-body");

export type RequestWithRawEmailWebhookBody = IncomingMessage & {
  [RAW_EMAIL_WEBHOOK_BODY]?: Buffer;
};

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
 * Reads the EXACT bytes of an email webhook request, before any JSON parser sees them (ADR 0056 decision 2):
 * Resend signs the raw body; Brevo authenticates before parsing. Never re-serialize JSON for verification. Mounted by the app
 * factory on `EMAIL_WEBHOOK_PATH` only, before Nest registers its JSON parser, so the raw bytes of every other route
 * are never kept (scoped to this route; no dependency). Once the stream is read the JSON
 * parser skips the request. A body over `EMAIL_WEBHOOK_BODY_MAX_BYTES` (64 KiB, by `Content-Length` or as it
 * arrives) is refused with 413 before the rest is read. The bytes are never logged.
 */
export function emailWebhookRawBody(
  maxBytes: number = EMAIL_WEBHOOK_BODY_MAX_BYTES,
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
        try {
          (request as RequestWithRawEmailWebhookBody)[RAW_EMAIL_WEBHOOK_BODY] = Buffer.concat(
            chunks,
            size,
          );
        } catch (cause) {
          next(cause);
          return;
        }
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
