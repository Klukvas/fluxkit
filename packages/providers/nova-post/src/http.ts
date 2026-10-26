import { z } from "zod";
import {
  CARRIER_CODE_PATTERN,
  MAX_PROVIDER_CODES,
  SHIPPING_PROVIDER_TIMEOUTS_MS,
  type ProviderFailureReason,
} from "@fluxkit/core";

/*
 * The plugin's only way to the network (plan step 7b): Node's `fetch` to the configured base URL, the JWT cache, the size
 * caps and the carrier codes of a failure. Rules:
 * - The key travels ONLY in the query of `GET /clients/authorization`; that URL is never logged or put in an error.
 * - Every other call sends `Authorization: <jwt>`, the raw token (spike 7a H04: `Bearer <jwt>` answers 401).
 * - Nothing here logs a URL with a query, a request or response body, the key or the JWT: only the operation, the HTTP
 *   status or the kind of failure, carrier codes and the duration.
 */

export interface NovaPostLogger {
  log(message: string): void;
  warn(message: string): void;
}

/** A failure of one call, typed like the port's `ProviderResult`. The message never carries carrier text. */
export class NovaPostCallError extends Error {
  constructor(
    readonly operation: string,
    readonly reason: ProviderFailureReason,
    readonly codes: readonly string[],
  ) {
    super(`Nova Post ${operation} failed: ${reason}`);
    this.name = "NovaPostCallError";
  }
}

/** Response size caps, applied before parsing (plan step 7b; 390 KB was seen for a page of 100 divisions). */
export const NOVA_POST_SIZE_CAPS = Object.freeze({
  settlements: 1024 * 1024,
  divisions: 2 * 1024 * 1024,
  shipments: 4 * 1024 * 1024,
  tracking: 1024 * 1024,
  label: 10 * 1024 * 1024,
  small: 256 * 1024,
});

/** How long a JWT is kept when its `exp` cannot be read, and how long before `exp` it is replaced. */
export const JWT_FALLBACK_LIFETIME_MS = 50 * 60_000;
export const JWT_REFRESH_MARGIN_MS = 5 * 60_000;

export interface RequestSpec {
  /** For logs and errors: the port operation (`searchCities`, ...). */
  readonly operation: string;
  readonly method: "GET" | "POST" | "DELETE";
  /** A path under the base URL, starting with `/`, without a query. */
  readonly path: string;
  /** Arrays become `name[]=value` (as the spike sent them, built by URLSearchParams). */
  readonly query?: Readonly<Record<string, string | number | readonly (string | number)[]>>;
  readonly body?: unknown;
  readonly accept?: string;
  readonly language?: "uk" | "en";
  readonly maxBytes: number;
  /** The ceiling of this request (a core timeout), combined with the caller's signal. */
  readonly timeoutMs: number;
  /** A `401` refreshes the JWT and repeats the call once. Never for a create (no idempotency, spike 7a H22). */
  readonly retryOn401: boolean;
}

export interface Answer {
  readonly status: number;
  readonly contentType: string;
  readonly bytes: Uint8Array;
  /** The parsed JSON body, `undefined` when the body is not JSON. */
  readonly json: unknown;
}

export interface NovaPostHttpOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly logger: NovaPostLogger;
  /** The clock for the JWT's lifetime (tests replace it). */
  readonly now?: () => number;
}

const authorizationAnswerSchema = z.looseObject({ jwt: z.string().min(10).max(16_384) });

const SNAKE_CODE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

/**
 * A field path as validation errors name them (`phone`, `parcels.0.actualWeight`, `sender.divisionId`, `client_order`;
 * `items[1].name` is kept as `items.1.name`). A name is lower camelCase (every capital starts a word of at least one more
 * letter or digit) or snake_case; an index has 1 to 3 digits. A key that only fits `CARRIER_CODE_PATTERN` is not enough:
 * the carrier may echo a value as a key (a phone, a fragment of the key or the JWT), and a code is logged and returned.
 */
const FIELD_NAME = "[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)*(?:_[a-z0-9]+)*";
const FIELD_PATH = new RegExp(`^${FIELD_NAME}(?:\\.(?:${FIELD_NAME}|\\d{1,3}))*$`);
const LONG_DIGIT_RUN = /\d{4,}/;
const FIELD_PATH_MAX = 32;

/** The key as a field-path code, or `undefined` when it does not look like one (never echoed then). */
export function fieldPathOf(key: string): string | undefined {
  const dotted = key.replace(/\[(\d{1,3})\]/g, ".$1");
  return dotted.length <= FIELD_PATH_MAX &&
    FIELD_PATH.test(dotted) &&
    !LONG_DIGIT_RUN.test(dotted) &&
    CARRIER_CODE_PATTERN.test(dotted)
    ? dotted
    : undefined;
}

function errorsOf(json: unknown): Record<string, unknown> | undefined {
  const errors = (json as { errors?: unknown } | null | undefined)?.errors;
  return typeof errors === "object" && errors !== null && !Array.isArray(errors)
    ? (errors as Record<string, unknown>)
    : undefined;
}

/**
 * The carrier codes of an error answer: the HTTP status, then the error KEYS that are field paths (`fieldPathOf`), then
 * `errorMessage`-like values only when they are snake_case codes (`shipment_was_deleted`) without a long digit run.
 * Free text ("Invalid token", "Contact Sender contains ...") is never kept: it can echo a name, a phone or the key.
 */
export function carrierCodesOf(status: number | string, json: unknown): string[] {
  const codes = [String(status)];
  for (const [key, value] of Object.entries(errorsOf(json) ?? {})) {
    const path = fieldPathOf(key);
    if (path !== undefined) {
      codes.push(path);
    }
    if (
      typeof value === "string" &&
      SNAKE_CODE.test(value) &&
      !LONG_DIGIT_RUN.test(value) &&
      CARRIER_CODE_PATTERN.test(value)
    ) {
      codes.push(value);
    }
  }
  return [...new Set(codes)].slice(0, MAX_PROVIDER_CODES);
}

/**
 * Whether an error answer names a field of the request (a key other than `errorMessage` that is a field path): a
 * validation refusal of what we sent. A `422` that names no field is how production dressed a server error (H27).
 */
export function namesRequestField(json: unknown): boolean {
  return Object.keys(errorsOf(json) ?? {}).some(
    (key) => key !== "errorMessage" && fieldPathOf(key) !== undefined,
  );
}

/** Whether the error answer carries this snake_case code (`shipment_was_deleted`, ...). */
export function hasCarrierCode(json: unknown, code: string): boolean {
  const errors = (json as { errors?: unknown } | null | undefined)?.errors;
  return (
    typeof errors === "object" &&
    errors !== null &&
    Object.values(errors as Record<string, unknown>).some((value) => value === code)
  );
}

/** The `exp` claim of a JWT in milliseconds, or `undefined` (the token is never logged, only read here). */
export function jwtExpiryMs(jwt: string): number | undefined {
  const payload = jwt.split(".")[1];
  if (payload === undefined) {
    return undefined;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : undefined;
  } catch {
    // An unreadable payload is not an error: the fallback lifetime applies.
    return undefined;
  }
}

function buildUrl(base: string, path: string, query: RequestSpec["query"]): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value as readonly (string | number)[]) {
        search.append(`${name}[]`, String(item));
      }
    } else {
      search.append(name, String(value as string | number));
    }
  }
  const text = search.toString();
  return `${base}${path}${text === "" ? "" : `?${text}`}`;
}

/** Reads at most `maxBytes` of the body; more is `too_large` (the read is cancelled). */
async function readCapped(
  response: Response,
  maxBytes: number,
  operation: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new NovaPostCallError(operation, "unavailable", ["too_large"]);
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
      throw new NovaPostCallError(operation, "unavailable", ["too_large"]);
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
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    // Not JSON although it says so: the caller treats `undefined` as a malformed answer.
    return undefined;
  }
}

/** Waits for `work` until `signal` fires (then rejects with an `aborted` failure); `work` itself goes on. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal, operation: string): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(new NovaPostCallError(operation, "unavailable", ["aborted"]));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new NovaPostCallError(operation, "unavailable", ["aborted"]));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

interface CachedToken {
  readonly jwt: string;
  readonly validUntil: number;
}

/**
 * HTTP to Nova Post with the JWT of this process. One authorization runs at a time (single flight); callers wait for it
 * with their own signal, and the authorization request has its own limit, so one caller's abort fails no other caller.
 */
export class NovaPostHttp {
  private token: CachedToken | undefined;
  private pending: Promise<string> | undefined;
  private readonly now: () => number;

  constructor(private readonly options: NovaPostHttpOptions) {
    this.now = options.now ?? Date.now;
  }

  /** A valid JWT: the cached one, the one being fetched, or a new one (`fresh` skips the cache). */
  async jwt(signal: AbortSignal, operation: string, fresh = false): Promise<string> {
    if (!fresh && this.token !== undefined && this.now() < this.token.validUntil) {
      return this.token.jwt;
    }
    if (this.pending === undefined) {
      const started = this.authorize(operation).finally(() => {
        if (this.pending === started) {
          this.pending = undefined;
        }
      });
      this.pending = started;
    }
    return untilAborted(this.pending, signal, operation);
  }

  /** Forgets `jwt` when it is still the cached token (a 401 proved it dead; a newer token is kept). */
  invalidate(jwt: string): void {
    if (this.token?.jwt === jwt) {
      this.token = undefined;
    }
  }

  /**
   * One call. Answers every HTTP status (the caller maps it), except: a transport failure, a timeout, an abort or a body
   * over the cap throw `unavailable`; a `401` after the one allowed refresh (or on a call that may not repeat) throws
   * `invalid_credentials` and forgets the token.
   */
  async request(spec: RequestSpec, signal: AbortSignal): Promise<Answer> {
    const jwt = await this.jwt(signal, spec.operation);
    const first = await this.send(spec, jwt, signal);
    if (first.status !== 401) {
      return first;
    }
    this.invalidate(jwt);
    if (!spec.retryOn401) {
      throw new NovaPostCallError(spec.operation, "invalid_credentials", ["401"]);
    }
    const again = await this.jwt(signal, spec.operation);
    const second = await this.send(spec, again, signal);
    if (second.status === 401) {
      this.invalidate(again);
      throw new NovaPostCallError(spec.operation, "invalid_credentials", ["401"]);
    }
    return second;
  }

  private async authorize(operation: string): Promise<string> {
    // Its own limit, not a caller's signal: callers wait for it with theirs (single flight).
    const signal = AbortSignal.timeout(SHIPPING_PROVIDER_TIMEOUTS_MS.lookup);
    const url = buildUrl(this.options.baseUrl, "/clients/authorization", {
      apiKey: this.options.apiKey,
    });
    const answer = await this.fetch("authorization", url, { method: "GET" }, signal, {
      maxBytes: NOVA_POST_SIZE_CAPS.small,
      accept: "application/json",
    });
    if (answer.status === 200) {
      const parsed = authorizationAnswerSchema.safeParse(answer.json);
      if (!parsed.success) {
        throw new NovaPostCallError(operation, "unavailable", ["malformed_answer"]);
      }
      const jwt = parsed.data.jwt;
      const now = this.now();
      const expiry = jwtExpiryMs(jwt);
      this.token = {
        jwt,
        validUntil:
          expiry === undefined ? now + JWT_FALLBACK_LIFETIME_MS : expiry - JWT_REFRESH_MARGIN_MS,
      };
      return jwt;
    }
    const codes = carrierCodesOf(answer.status, answer.json);
    // 422 "API key expired" / "api key status is ...", 401, 403: the key does not work.
    if (answer.status === 401 || answer.status === 403 || answer.status === 422) {
      throw new NovaPostCallError(operation, "invalid_credentials", codes);
    }
    throw new NovaPostCallError(
      operation,
      answer.status === 429 || answer.status >= 500 ? "unavailable" : "rejected",
      codes,
    );
  }

  private send(spec: RequestSpec, jwt: string, signal: AbortSignal): Promise<Answer> {
    const headers: Record<string, string> = { authorization: jwt };
    if (spec.language !== undefined) {
      headers["accept-language"] = spec.language;
    }
    let body: string | undefined;
    if (spec.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(spec.body);
    }
    const ceiling = AbortSignal.timeout(spec.timeoutMs);
    return this.fetch(
      spec.operation,
      buildUrl(this.options.baseUrl, spec.path, spec.query),
      { method: spec.method, headers, body },
      AbortSignal.any([signal, ceiling]),
      { maxBytes: spec.maxBytes, accept: spec.accept ?? "application/json" },
    );
  }

  /** One HTTP exchange; never logs the URL (the authorization URL carries the key). */
  private async fetch(
    operation: string,
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
    signal: AbortSignal,
    read: { maxBytes: number; accept: string },
  ): Promise<Answer> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method,
        headers: { ...init.headers, accept: read.accept },
        body: init.body,
        redirect: "error",
        signal,
      });
    } catch {
      // The error's text may contain the URL (and so the key): only its kind is kept.
      const kind = signal.aborted ? "timeout" : "network";
      this.options.logger.warn(`${operation}: ${kind} after ${String(elapsed())} ms`);
      throw new NovaPostCallError(operation, "unavailable", [kind]);
    }
    const contentType = response.headers.get("content-type") ?? "";
    let bytes: Uint8Array;
    try {
      bytes = await readCapped(response, read.maxBytes, operation);
    } catch (error) {
      const codes =
        error instanceof NovaPostCallError ? error.codes : [signal.aborted ? "timeout" : "network"];
      this.options.logger.warn(
        `${operation}: HTTP ${String(response.status)} body unreadable (${codes.join(",")}) after ${String(elapsed())} ms`,
      );
      throw new NovaPostCallError(operation, "unavailable", codes);
    }
    const json = parseJson(bytes, contentType);
    if (response.status >= 400) {
      this.options.logger.warn(
        `${operation}: HTTP ${String(response.status)} (${carrierCodesOf(response.status, json).join(",")}) after ${String(elapsed())} ms`,
      );
    }
    return { status: response.status, contentType, bytes, json };
  }
}
