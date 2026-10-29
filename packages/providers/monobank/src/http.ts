import type { ProviderAbortSignal } from "@fluxkit/core";
import {
  MONOBANK_API_ORIGIN,
  MONOBANK_PATHS,
  MONOBANK_TOKEN_HEADER,
  type MonobankPath,
} from "./config.js";

/*
 * The plugin's only way to the network (ADR 0032 decisions 14 and 15; payments plan step 7): Node's `fetch` to the fixed
 * routes of `https://api.monobank.ua`. Rules:
 * - The origin is the constant `MONOBANK_API_ORIGIN`; redirects are refused (`redirect: "error"`), so no answer can send
 *   the token to another host. Only a test may name a local stub on 127.0.0.1 (the constructor refuses anything else).
 * - The token travels only in the `X-Token` header (M1); never in the URL, a body, a log line or an error. The only
 *   query value ever sent is an `invoiceId`, encoded by `URLSearchParams`.
 * - The answer is read up to `MONOBANK_MAX_ANSWER_BYTES`, counted while streaming (and refused early by
 *   `content-length`), before anything is parsed.
 * - The time limit is the caller's signal (the API aborts a call after `PAYMENT_PROVIDER_TIMEOUT_MS`); the plugin adds
 *   none and never retries.
 * - Nothing here logs: the provider logs outcomes as reasons and codes only.
 */

/** Largest answer read (ADR 0032 decision 14: "64 KiB answer cap"; core `PAYMENT_LIMITS.providerAnswerMaxBytes`). */
export const MONOBANK_MAX_ANSWER_BYTES = 64 * 1024;

/** A local stub origin a test may name instead (`http://127.0.0.1:<port>`). */
const LOCAL_STUB_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

const KNOWN_PATHS: ReadonlySet<string> = new Set(Object.values(MONOBANK_PATHS));

export interface MonobankAnswer {
  readonly status: number;
  /** The raw `retry-after` header, or `null` (M17: UNKNOWN whether Monobank sends one). */
  readonly retryAfter: string | null;
  /** The parsed JSON body; `undefined` when the body is empty, not JSON, not UTF-8 or not declared as JSON. */
  readonly json: unknown;
  /** Whether the body was empty (the `invoice/remove` success is documented as an empty answer, M14). */
  readonly empty: boolean;
}

/** How one exchange ended: an HTTP answer read within the cap, or a failure with a code (never an error text). */
export type MonobankExchange =
  | { readonly kind: "answered"; readonly answer: MonobankAnswer }
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

export interface MonobankHttpOptions {
  readonly token: string;
  /** TEST ONLY: a local stub origin on 127.0.0.1. Production code never passes it (the module factory does not). */
  readonly origin?: string;
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

export interface MonobankRequest {
  readonly method: "GET" | "POST";
  readonly path: MonobankPath;
  /** Only `invoiceId` (`GET /api/merchant/invoice/status?invoiceId=`). */
  readonly invoiceId?: string;
  /** A JSON text for a `POST`. */
  readonly body?: string;
}

/** HTTP to Monobank with this process's token. One instance per provider; it keeps no state between calls. */
export class MonobankHttp {
  private readonly token: string;
  private readonly origin: string;

  constructor(options: MonobankHttpOptions) {
    const origin = options.origin ?? MONOBANK_API_ORIGIN;
    if (origin !== MONOBANK_API_ORIGIN && !LOCAL_STUB_ORIGIN.test(origin)) {
      throw new RangeError(
        "MonobankHttp calls only https://api.monobank.ua (a test may name a stub on 127.0.0.1)",
      );
    }
    this.token = options.token;
    this.origin = origin;
  }

  /**
   * One request to one of the fixed routes. Answers every HTTP status (the caller maps it); a transport failure, an
   * abort, a refused redirect or an answer over the cap is a `failed` exchange with a code. Never repeats a request.
   */
  async call(
    request: MonobankRequest,
    callerSignal: ProviderAbortSignal,
  ): Promise<MonobankExchange> {
    if (!KNOWN_PATHS.has(request.path)) {
      throw new RangeError("MonobankHttp calls only the plugin's fixed routes");
    }
    if (callerSignal.aborted) {
      return { kind: "failed", code: "aborted_before_send" };
    }
    const url = new URL(request.path, this.origin);
    if (request.invoiceId !== undefined) {
      url.search = new URLSearchParams({ invoiceId: request.invoiceId }).toString();
    }
    const headers: Record<string, string> = {
      [MONOBANK_TOKEN_HEADER]: this.token,
      accept: "application/json",
    };
    if (request.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const { signal, release } = follow(callerSignal);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: request.method,
          headers,
          ...(request.body === undefined ? {} : { body: request.body }),
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
        bytes = await readCapped(response, MONOBANK_MAX_ANSWER_BYTES);
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
          json: parseJson(bytes, contentType),
          empty: bytes.byteLength === 0,
        },
      };
    } finally {
      release();
    }
  }
}
