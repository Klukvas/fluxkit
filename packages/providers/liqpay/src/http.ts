import type { ProviderAbortSignal } from "@fluxkit/core";
import { LIQPAY_API_ORIGIN, LIQPAY_PATHS, type LiqPayPath } from "./config.js";
import { encodeData, signData } from "./signature.js";

/*
 * The plugin's only way to the network (ADR 0059): POST application/x-www-form-urlencoded with `data` and `signature`
 * to the fixed routes of the LiqPay API origin constant.
 */

export const LIQPAY_MAX_ANSWER_BYTES = 64 * 1024;

/** A local stub origin a test may name instead (`http://127.0.0.1:<port>`). */
const LOCAL_STUB_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;

const KNOWN_PATHS: ReadonlySet<string> = new Set(Object.values(LIQPAY_PATHS));

export interface LiqPayAnswer {
  readonly status: number;
  readonly retryAfter: string | null;
  /** Decoded JSON from a urlencoded `data` field when present and valid. */
  readonly json: unknown;
  readonly empty: boolean;
  readonly rawForm: Readonly<Record<string, string>> | undefined;
}

export type LiqPayExchange =
  | { readonly kind: "answered"; readonly answer: LiqPayAnswer }
  | {
      readonly kind: "failed";
      readonly code: "aborted_before_send" | "timeout" | "network" | "too_large" | "unreadable";
      readonly status?: number;
    };

export interface LiqPayHttpOptions {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly origin?: string;
}

export interface LiqPayRequest {
  readonly path: LiqPayPath;
  readonly params: Record<string, unknown>;
}

class TooLarge extends Error {}

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

function parseUrlencodedForm(bytes: Uint8Array): Record<string, string> {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const out: Record<string, string> = {};
  for (const pair of text.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    const raw = eq < 0 ? "" : pair.slice(eq + 1);
    out[key] = decodeURIComponent(raw.replace(/\+/g, " "));
  }
  return out;
}

function decodeDataField(data: string | undefined): unknown {
  if (data === undefined || data === "") {
    return undefined;
  }
  try {
    const jsonText = Buffer.from(data, "base64").toString("utf8");
    return JSON.parse(jsonText) as unknown;
  } catch {
    return undefined;
  }
}

export class LiqPayHttp {
  readonly publicKey: string;
  readonly privateKey: string;
  private readonly origin: string;

  constructor(options: LiqPayHttpOptions) {
    const origin = options.origin ?? LIQPAY_API_ORIGIN;
    if (origin !== LIQPAY_API_ORIGIN && !LOCAL_STUB_ORIGIN.test(origin)) {
      throw new RangeError(
        "LiqPayHttp calls only https://www.liqpay.ua (a test may name a stub on 127.0.0.1)",
      );
    }
    this.publicKey = options.publicKey;
    this.privateKey = options.privateKey;
    this.origin = origin;
  }

  buildSignedBody(params: Record<string, unknown>): { data: string; signature: string } {
    const withKey = { ...params, public_key: this.publicKey, version: params.version ?? 7 };
    const data = encodeData(withKey);
    const signature = signData(data, this.privateKey);
    return { data, signature };
  }

  async call(request: LiqPayRequest, callerSignal: ProviderAbortSignal): Promise<LiqPayExchange> {
    if (!KNOWN_PATHS.has(request.path)) {
      throw new RangeError("LiqPayHttp calls only the plugin's fixed routes");
    }
    if (callerSignal.aborted) {
      return { kind: "failed", code: "aborted_before_send" };
    }
    const url = new URL(request.path, this.origin);
    const { data, signature } = this.buildSignedBody(request.params);
    const body = new URLSearchParams({ data, signature }).toString();
    const { signal, release } = follow(callerSignal);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json, */*",
            "content-type": "application/x-www-form-urlencoded",
          },
          body,
          redirect: "error",
          signal,
        });
      } catch {
        return { kind: "failed", code: signal.aborted ? "timeout" : "network" };
      }
      const retryAfter = response.headers.get("retry-after");
      let bytes: Uint8Array;
      try {
        bytes = await readCapped(response, LIQPAY_MAX_ANSWER_BYTES);
      } catch (error) {
        const code =
          error instanceof TooLarge ? "too_large" : signal.aborted ? "timeout" : "unreadable";
        return { kind: "failed", code, status: response.status };
      }
      const rawForm = bytes.byteLength === 0 ? undefined : parseUrlencodedForm(bytes);
      const json = decodeDataField(rawForm?.data);
      return {
        kind: "answered",
        answer: {
          status: response.status,
          retryAfter,
          json,
          empty: bytes.byteLength === 0,
          rawForm,
        },
      };
    } finally {
      release();
    }
  }
}
