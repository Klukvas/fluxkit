import type { OutgoingEmail, ProviderAbortSignal } from "@fluxkit/core";
import { ResendHttp } from "../http.js";
import { ResendEmailProvider } from "../resend-provider.js";
import { captureLogger, STUB_API_KEY, STUB_PERSONAL, type StubResend } from "./stub-resend.js";

/* TEST ONLY. Invented messages and wiring for the plugin's specs; no real person, address or key. */

export const MESSAGE_ID = "6f1c2a9e-3b4d-4c5e-8f70-1a2b3c4d5e6f";

/** A mail as the API hands it over: rendered, sanitized, one recipient. */
export function message(overrides: Partial<OutgoingEmail> = {}): OutgoingEmail {
  return {
    from: { address: "shop@mail.example", displayName: "Fluxkit Demo Shop" },
    replyTo: { address: STUB_PERSONAL.replyTo, displayName: null },
    to: { address: STUB_PERSONAL.recipient, displayName: null },
    subject: STUB_PERSONAL.subject,
    html: "<p>Дякуємо за замовлення 7K3M-9QX2.</p>",
    text: "Дякуємо за замовлення 7K3M-9QX2.",
    tags: { category: "order" },
    ...overrides,
  };
}

/** A provider wired to the stub, with a captured log. */
export function providerOn(stub: StubResend, options: { apiKey?: string } = {}) {
  const logger = captureLogger();
  const http = new ResendHttp({ apiKey: options.apiKey ?? STUB_API_KEY, endpoint: stub.endpoint });
  return { provider: new ResendEmailProvider(http, logger), http, logger };
}

export const live = (): ProviderAbortSignal => new AbortController().signal;

export function aborted(): ProviderAbortSignal {
  const controller = new AbortController();
  controller.abort(new Error("timeout"));
  return controller.signal;
}

/** A signal that fires after `ms` (the API's send limit, shortened). */
export const within = (ms: number): ProviderAbortSignal => AbortSignal.timeout(ms);
