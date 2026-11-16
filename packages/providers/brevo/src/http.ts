import type { ProviderAbortSignal } from "@fluxkit/core";
import { BREVO_API_ORIGIN, BREVO_SEND_PATH, BREVO_USER_AGENT } from "./config.js";

/*
 * The plugin's only way to the network (ADR 0031 decisions 16 and 17; Brevo plan step 1): one `POST /v3/smtp/email` with Node's
 * `fetch`. Rules:
 * - The endpoint is the constant `https://api.brevo.com/v3/smtp/email`; redirects are refused (`redirect: "error"`), so no
 *   answer can send the key to another host. Only a test may name a local stub on 127.0.0.1 (the constructor refuses
 *   anything else).
 * - The key travels only in `api-key: <key>` (B1); never in the URL, the body, a log line or an error.
 * - The answer is read up to `BREVO_MAX_ANSWER_BYTES`, counted while streaming (and refused early by `content-length`),
 *   before anything is parsed.
 * - The time limit is the caller's signal (the API aborts a send after `EMAIL_SEND_TIMEOUT_MS`); the plugin adds none.
 * - Nothing here logs: the provider logs the outcome as a status and codes only.
 */

/** Largest answer read (ADR 0031 decision 16: "the response is capped at 64 KiB before parsing"). */
export const BREVO_MAX_ANSWER_BYTES = 64 * 1024;

/** The production endpoint: the only one outside tests. */
export const BREVO_SEND_URL = `${BREVO_API_ORIGIN}${BREVO_SEND_PATH}`;

/** A local stub endpoint a test may name instead (`http://127.0.0.1:<port>/v3/smtp/email`). */
const LOCAL_STUB_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}\/v3\/smtp\/email$/;

export interface BrevoAnswer {
  readonly status: number;
  /** The raw `retry-after` header, or `null`. */
  readonly retryAfter: string | null;
  readonly rateLimitReset?: string | null;
  /** The parsed JSON body; `undefined` when the body is empty, not JSON, or not declared as JSON. */
  readonly json: unknown;
}

/** How one exchange ended: an HTTP answer read within the cap, or a failure with a code (never an error text). */
export type BrevoExchange =
  | { readonly kind: "answered"; readonly answer: BrevoAnswer }
  | {
      readonly kind: "failed";
      /**
       * `aborted_before_send`: the signal had fired before `fetch` was called (nothing left the process);
       * `timeout`: the signal fired while the request or the answer was in flight; `network`: a transport failure or a
       * refused redirect; `too_large`: the answer exceeded the cap; `unreadable`: the body could not be read.
       */
      readonly code: "aborted_before_send" | "timeout" | "network" | "too_large" | "unreadable";
      /** The HTTP status when the failure happened while reading an answer. */
      readonly status?: number;
    };

export interface BrevoHttpOptions {
  readonly apiKey: string;
  /** TEST ONLY: a local stub endpoint on 127.0.0.1. Production code never passes it (the module factory does not). */
  readonly endpoint?: string;
}

class TooLarge extends Error {}

/** Reads at most `maxBytes` of the body; more throws `TooLarge` (the read is cancelled). */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJson(bytes: Uint8Array, contentType: string): unknown {
  if (!contentType.toLowerCase().includes("json") || bytes.byteLength === 0) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    // Not JSON (or not UTF-8) although it says so: the caller treats `undefined` as an answer it cannot read.
    return undefined;
  }
}

/**
 * A real `AbortSignal` that follows the caller's `ProviderAbortSignal` (the core type; the API passes an
 * `AbortController` signal, but the port promises only the interface). `release` detaches the listener.
 */
function follow(signal: ProviderAbortSignal): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      signal.removeEventListener("abort", onAbort);
    },
  };
}

/** HTTP to Brevo with this process's key. One instance per provider; it keeps no state between calls. */
export class BrevoHttp {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(options: BrevoHttpOptions) {
    const endpoint = options.endpoint ?? BREVO_SEND_URL;
    if (endpoint !== BREVO_SEND_URL && !LOCAL_STUB_URL.test(endpoint)) {
      throw new RangeError(
        "BrevoHttp calls only https://api.brevo.com/v3/smtp/email (a test may name a stub on 127.0.0.1)",
      );
    }
    this.apiKey = options.apiKey;
    this.endpoint = endpoint;
  }

  /**
   * Posts one JSON body with the idempotency key. Answers every HTTP status (the caller maps it); a transport failure,
   * an abort, a refused redirect or an answer over the cap is a `failed` exchange with a code.
   */
  async postEmail(body: string, callerSignal: ProviderAbortSignal): Promise<BrevoExchange> {
    if (callerSignal.aborted) {
      return { kind: "failed", code: "aborted_before_send" };
    }
    const { signal, release } = follow(callerSignal);
    try {
      let response: Response;
      try {
        response = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "api-key": this.apiKey,
            "content-type": "application/json",
            accept: "application/json",
            "user-agent": BREVO_USER_AGENT,
          },
          body,
          redirect: "error",
          signal,
        });
      } catch {
        // The error's text is not kept (it may name the URL); only its kind.
        return { kind: "failed", code: signal.aborted ? "timeout" : "network" };
      }
      const contentType = response.headers.get("content-type") ?? "";
      const retryAfter = response.headers.get("retry-after");
      let bytes: Uint8Array;
      try {
        bytes = await readCapped(response, BREVO_MAX_ANSWER_BYTES);
      } catch (error) {
        const code =
          error instanceof TooLarge ? "too_large" : signal.aborted ? "timeout" : "unreadable";
        return { kind: "failed", code, status: response.status };
      }
      return {
        kind: "answered",
        answer: {
          status: response.status,
          retryAfter,
          rateLimitReset: response.headers.get("x-sib-ratelimit-reset"),
          json: parseJson(bytes, contentType),
        },
      };
    } finally {
      release();
    }
  }
}
