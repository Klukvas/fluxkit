import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * TEST ONLY. A local stand-in for Monobank acquiring on 127.0.0.1, shaped after the documented facts of ADR 0032 / the
 * payments plan (M3 to M16; the OpenAPI spec "Acquiring v2410" embedded in https://api.monobank.ua/docs/acquiring.html).
 * Nothing was observed live: no token was available. Every token, id, reference, name and card number here is INVENTED.
 * It has its own P-256 key pair and signs webhooks like M12 (base64 DER ECDSA over SHA-256 of the raw body), serves the
 * public key like `GET /api/merchant/pubkey`, records every request (method, path, query, headers, raw body) so specs can
 * pin the exact request, and a spec can replace any answer. Its error bodies are `{errCode, errText}` (M16) and their
 * texts ECHO the token and request values on purpose, so the secrets spec can prove the plugin never keeps them.
 *
 * Where the documents are silent the stub picks the stricter or the safer reading (marked "stub rule"):
 * - create is NOT idempotent (M5): every create makes a new invoice;
 * - a refund (`invoice/cancel`) is NOT deduplicated by `extRef` (M13 UNKNOWN): a resend would refund twice here;
 * - unknown top-level members of a create are refused `400 BAD_REQUEST`;
 * - `invoice/remove` of an unpaid invoice makes it `expired`; of a paid one answers `400 BAD_REQUEST`;
 * - a partial refund keeps `success` with a lower `finalAmount`; refunding the rest makes the invoice `reversed`;
 * - a missing token is `400 BAD_REQUEST` (the pubkey route documents "400: token missing"), a wrong one `403 FORBIDDEN`.
 */

export const STUB_TOKEN = "uStubMonoToken_0123456789abcdefGHIJKLmnop";

/** The documented page host (M23 UNKNOWN; the example host of the OpenAPI spec). */
export const STUB_PAGE_ORIGIN = "https://pay.mbnk.biz";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** The URL as received (path and query). */
  readonly url: string;
  readonly query: Readonly<Record<string, string>>;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: string;
  /** The parsed JSON body, or `undefined` when it was not JSON. */
  readonly body: unknown;
}

export interface StubAnswer {
  readonly status: number;
  readonly json?: unknown;
  /** A raw body instead of JSON (with `headers` for its content type). */
  readonly body?: Buffer | string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Never answers (the caller's signal must end the call). */
  readonly hang?: boolean;
  readonly delayMs?: number;
  /** Sends the body in two chunks without a content-length (the size cap must count while reading). */
  readonly chunked?: boolean;
}

export type Override = (request: RecordedRequest) => StubAnswer | undefined;

export interface StubCancel {
  status: "processing" | "success" | "failure";
  amount: number;
  ccy: number;
  createdDate: string;
  modifiedDate: string;
  approvalCode: string;
  rrn: string;
  extRef?: string;
}

export interface StubInvoice {
  invoiceId: string;
  status: string;
  amount: number;
  ccy: number;
  finalAmount?: number;
  reference?: string;
  destination?: string;
  createdDate: string;
  modifiedDate: string;
  failureReason?: string;
  errCode?: string;
  cancelList: StubCancel[];
  paymentInfo?: Record<string, unknown>;
  /** The create body as received (specs read it). */
  readonly request: Record<string, unknown>;
}

/** The create members the stub accepts (M3, the ones the plugin may send); anything else is refused (stub rule). */
const KNOWN_CREATE_MEMBERS = new Set([
  "amount",
  "ccy",
  "merchantPaymInfo",
  "redirectUrl",
  "webHookUrl",
  "validity",
  "paymentType",
]);

export interface StubMonobank {
  /** `http://127.0.0.1:<port>` */
  readonly origin: string;
  readonly requests: readonly RecordedRequest[];
  readonly invoices: ReadonlyMap<string, StubInvoice>;
  /** The current public key (the one `GET /api/merchant/pubkey` answers). */
  readonly publicKey: KeyObject;
  /** Replaces the default answer while set (return `undefined` to fall through). */
  override(next: Override | undefined): void;
  /** Makes an invoice paid (`success`) with an invented card. */
  pay(invoiceId: string, card?: { system: string; maskedPan: string }): void;
  /** Sets any raw status (and an optional payment error code). */
  setStatus(invoiceId: string, status: string, errCode?: string): void;
  /** The status answer of an invoice exactly as `GET /api/merchant/invoice/status` would send it. */
  statusJson(invoiceId: string): Record<string, unknown>;
  /** Signs `rawBody` with the current private key: base64 DER ECDSA-SHA256 (M12). */
  sign(rawBody: Uint8Array): string;
  /** A webhook exactly as Monobank would send it about the invoice (body = the status answer, M8; header `x-sign`). */
  webhookFor(invoiceId: string): { headers: Record<string, string>; rawBody: Uint8Array };
  /** A new key pair: earlier signatures no longer verify with the served key (rotation). */
  rotateKey(): void;
  /** How `invoice/cancel` answers from now on (default `success`). */
  setRefundOutcome(status: "processing" | "success" | "failure"): void;
  close(): Promise<void>;
}

function error(status: number, errCode: string, errText: string): StubAnswer {
  return { status, json: { errCode, errText } };
}

/** The stub's own clock: starts at a fixed instant and moves one second per change (no wall clock). */
function clock(): () => string {
  let ms = Date.UTC(2026, 9, 29, 10, 0, 0);
  return () => {
    ms += 1_000;
    return new Date(ms).toISOString().replace(".000Z", "Z");
  };
}

export async function startStubMonobank(): Promise<StubMonobank> {
  const requests: RecordedRequest[] = [];
  const invoices = new Map<string, StubInvoice>();
  const tick = clock();
  let pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  let override: Override | undefined;
  let refundOutcome: "processing" | "success" | "failure" = "success";
  let counter = 0;

  const statusJson = (invoice: StubInvoice): Record<string, unknown> => ({
    invoiceId: invoice.invoiceId,
    status: invoice.status,
    ...(invoice.failureReason === undefined ? {} : { failureReason: invoice.failureReason }),
    ...(invoice.errCode === undefined ? {} : { errCode: invoice.errCode }),
    amount: invoice.amount,
    ccy: invoice.ccy,
    ...(invoice.finalAmount === undefined ? {} : { finalAmount: invoice.finalAmount }),
    createdDate: invoice.createdDate,
    modifiedDate: invoice.modifiedDate,
    ...(invoice.reference === undefined ? {} : { reference: invoice.reference }),
    ...(invoice.destination === undefined ? {} : { destination: invoice.destination }),
    cancelList: invoice.cancelList.map((entry) => ({ ...entry })),
    ...(invoice.paymentInfo === undefined ? {} : { paymentInfo: { ...invoice.paymentInfo } }),
  });

  const find = (id: string): StubInvoice => {
    const invoice = invoices.get(id);
    if (invoice === undefined) {
      throw new Error(`stub: no invoice ${id}`);
    }
    return invoice;
  };

  const defaultAnswer = (request: RecordedRequest): StubAnswer => {
    const routes: Record<string, string> = {
      "/api/merchant/invoice/create": "POST",
      "/api/merchant/invoice/status": "GET",
      "/api/merchant/invoice/cancel": "POST",
      "/api/merchant/invoice/remove": "POST",
      "/api/merchant/pubkey": "GET",
    };
    const method = routes[request.path];
    if (method === undefined) {
      return { status: 404, body: "not found", headers: { "content-type": "text/plain" } };
    }
    if (request.method !== method) {
      return error(
        405,
        "METHOD_NOT_ALLOWED",
        `Method not allowed: ${request.method} ${request.path}`,
      );
    }
    const token = request.headers["x-token"];
    if (typeof token !== "string" || token === "") {
      return error(400, "BAD_REQUEST", "empty 'X-Token'");
    }
    if (token !== STUB_TOKEN) {
      // Echoes a fragment of what was sent, as an unhelpful service might.
      return error(403, "FORBIDDEN", `forbidden: ${token.slice(0, 24)}`);
    }
    if (request.path === "/api/merchant/pubkey") {
      const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
      return { status: 200, json: { key: Buffer.from(pem).toString("base64") } };
    }
    if (request.path === "/api/merchant/invoice/status") {
      const id = request.query.invoiceId;
      if (id === undefined || id === "") {
        return error(400, "BAD_REQUEST", "empty 'invoiceId'");
      }
      const invoice = invoices.get(id);
      return invoice === undefined
        ? error(404, "NOT_FOUND", `invalid 'invoiceId' ${id} for token ${STUB_TOKEN.slice(4, 20)}`)
        : { status: 200, json: statusJson(invoice) };
    }
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !contentType.includes("application/json")) {
      return error(400, "BAD_REQUEST", "content type must be JSON");
    }
    const body = request.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return error(400, "BAD_REQUEST", "invalid JSON body");
    }
    const fields = body as Record<string, unknown>;
    if (request.path === "/api/merchant/invoice/create") {
      for (const member of Object.keys(fields)) {
        if (!KNOWN_CREATE_MEMBERS.has(member)) {
          return error(400, "BAD_REQUEST", `unknown field '${member}'`); // stub rule
        }
      }
      if (!Number.isSafeInteger(fields.amount) || (fields.amount as number) < 1) {
        return error(400, "BAD_REQUEST", "invalid 'amount'");
      }
      if (fields.ccy !== undefined && fields.ccy !== 980) {
        return error(400, "BAD_REQUEST", "invalid 'ccy'"); // stub rule: the shop's merchant takes UAH only (M18)
      }
      const info = fields.merchantPaymInfo as Record<string, unknown> | undefined;
      if (info !== undefined) {
        if (typeof info !== "object" || info === null) {
          return error(400, "INVALID_MERCHANT_PAYM_INFO", "invalid 'merchantPaymInfo'");
        }
        if (typeof info.destination === "string" && [...info.destination].length > 280) {
          return error(
            400,
            "INVALID_MERCHANT_PAYM_INFO",
            `destination too long: ${info.destination}`,
          );
        }
        const basket = info.basketOrder;
        if (basket !== undefined) {
          if (!Array.isArray(basket)) {
            return error(400, "INVALID_MERCHANT_PAYM_INFO", "invalid 'basketOrder'");
          }
          for (const item of basket as Record<string, unknown>[]) {
            if (
              typeof item.name !== "string" ||
              typeof item.qty !== "number" ||
              !Number.isSafeInteger(item.sum) ||
              typeof item.code !== "string"
            ) {
              return error(
                400,
                "INVALID_MERCHANT_PAYM_INFO",
                `invalid basket item ${String(item.name)}`,
              );
            }
          }
        }
      }
      if (
        fields.paymentType !== undefined &&
        fields.paymentType !== "debit" &&
        fields.paymentType !== "hold"
      ) {
        return error(400, "BAD_REQUEST", "invalid 'paymentType'");
      }
      counter += 1;
      const invoiceId = `p2_stub${String(counter).padStart(6, "0")}`;
      const now = tick();
      invoices.set(invoiceId, {
        invoiceId,
        status: "created",
        amount: fields.amount as number,
        ccy: (fields.ccy as number | undefined) ?? 980,
        ...(typeof info?.reference === "string" ? { reference: info.reference } : {}),
        ...(typeof info?.destination === "string" ? { destination: info.destination } : {}),
        createdDate: now,
        modifiedDate: now,
        cancelList: [],
        request: fields,
      });
      return { status: 200, json: { invoiceId, pageUrl: `${STUB_PAGE_ORIGIN}/${invoiceId}` } };
    }
    const id = fields.invoiceId;
    if (typeof id !== "string" || id === "") {
      return error(400, "BAD_REQUEST", "empty 'invoiceId'");
    }
    const invoice = invoices.get(id);
    if (invoice === undefined) {
      return error(404, "NOT_FOUND", `invalid 'invoiceId' ${id}`);
    }
    if (request.path === "/api/merchant/invoice/remove") {
      if (invoice.status !== "created") {
        return error(400, "BAD_REQUEST", `invoice ${id} cannot be removed`); // stub rule
      }
      invoice.status = "expired";
      invoice.modifiedDate = tick();
      return { status: 200, body: "", headers: { "content-type": "application/json" } };
    }
    // invoice/cancel
    if (invoice.status !== "success") {
      return error(500, "CANCEL_NOT_AVAILABLE", `cannot cancel ${id}`);
    }
    const refunded = invoice.cancelList
      .filter((entry) => entry.status !== "failure")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const remaining = invoice.amount - refunded;
    const amount = fields.amount === undefined ? remaining : fields.amount;
    if (!Number.isSafeInteger(amount) || (amount as number) < 1 || (amount as number) > remaining) {
      return error(400, "WRONG_CANCEL_AMOUNT", `wrong amount ${String(amount)} for ${id}`);
    }
    const now = tick();
    const entry: StubCancel = {
      status: refundOutcome,
      amount: amount as number,
      ccy: invoice.ccy,
      createdDate: now,
      modifiedDate: now,
      approvalCode: "123456",
      rrn: "000000000001",
      ...(typeof fields.extRef === "string" ? { extRef: fields.extRef } : {}),
    };
    invoice.cancelList.push(entry);
    if (refundOutcome === "success") {
      invoice.finalAmount = remaining - (amount as number);
      if (invoice.finalAmount === 0) {
        invoice.status = "reversed"; // stub rule (ADR 0032 open question 6)
      }
    }
    invoice.modifiedDate = now;
    return { status: 200, json: { status: refundOutcome, createdDate: now, modifiedDate: now } };
  };

  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
      const rawBody = Buffer.concat(chunks).toString("utf8");
      let body: unknown;
      try {
        body = rawBody === "" ? undefined : (JSON.parse(rawBody) as unknown);
      } catch {
        body = undefined;
      }
      const recorded: RecordedRequest = {
        method: incoming.method ?? "GET",
        path: url.pathname,
        url: incoming.url ?? "/",
        query: Object.fromEntries(url.searchParams.entries()),
        headers: { ...incoming.headers },
        rawBody,
        body,
      };
      requests.push(recorded);
      const answer = override?.(recorded) ?? defaultAnswer(recorded);
      if (answer.hang === true) {
        return;
      }
      const send = () => {
        if (response.destroyed) return;
        if (answer.body !== undefined) {
          const bytes = Buffer.from(answer.body);
          if (answer.chunked === true) {
            response.writeHead(answer.status, { ...answer.headers });
            const half = Math.floor(bytes.length / 2);
            response.write(bytes.subarray(0, half));
            response.end(bytes.subarray(half));
            return;
          }
          response.writeHead(answer.status, {
            "content-length": String(bytes.length),
            ...answer.headers,
          });
          response.end(bytes);
          return;
        }
        const text = answer.json === undefined ? "" : JSON.stringify(answer.json);
        const bytes = Buffer.from(text);
        if (answer.chunked === true) {
          response.writeHead(answer.status, {
            "content-type": "application/json",
            ...answer.headers,
          });
          const half = Math.floor(bytes.length / 2);
          response.write(bytes.subarray(0, half));
          response.end(bytes.subarray(half));
          return;
        }
        response.writeHead(answer.status, {
          "content-type": "application/json",
          "content-length": String(bytes.length),
          ...answer.headers,
        });
        response.end(bytes);
      };
      if (answer.delayMs !== undefined && answer.delayMs > 0) {
        setTimeout(send, answer.delayMs);
      } else {
        send();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const stub: StubMonobank = {
    origin: `http://127.0.0.1:${String(port)}`,
    requests,
    invoices,
    get publicKey() {
      return pair.publicKey;
    },
    override(next) {
      override = next;
    },
    pay(invoiceId, card = { system: "visa", maskedPan: "444403******1902" }) {
      const invoice = find(invoiceId);
      invoice.status = "success";
      invoice.finalAmount = invoice.amount;
      invoice.paymentInfo = {
        maskedPan: card.maskedPan,
        approvalCode: "662476",
        rrn: "060189181768",
        tranId: "13194036",
        terminal: "MI001088",
        bank: "Вигаданий Банк",
        paymentSystem: card.system,
        paymentMethod: "pan",
        fee: 1,
        country: "804",
      };
      invoice.modifiedDate = tick();
    },
    setStatus(invoiceId, status, errCode) {
      const invoice = find(invoiceId);
      invoice.status = status;
      if (errCode !== undefined) {
        invoice.errCode = errCode;
        invoice.failureReason = "Вигадана причина відмови";
      }
      invoice.modifiedDate = tick();
    },
    statusJson(invoiceId) {
      return statusJson(find(invoiceId));
    },
    sign(rawBody) {
      return sign("sha256", rawBody, { key: pair.privateKey, dsaEncoding: "der" }).toString(
        "base64",
      );
    },
    webhookFor(invoiceId) {
      const rawBody = new TextEncoder().encode(JSON.stringify(statusJson(find(invoiceId))));
      return {
        headers: { "content-type": "application/json", "x-sign": stub.sign(rawBody) },
        rawBody,
      };
    },
    rotateKey() {
      pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    },
    setRefundOutcome(status) {
      refundOutcome = status;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((closeError) => {
          if (closeError === undefined) resolve();
          else reject(closeError);
        });
      }),
  };
  return stub;
}
