import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { LIQPAY_PATHS } from "../config.js";
import { encodeData, signData, signatureValid } from "../signature.js";

export const STUB_PUBLIC_KEY = "sandbox_public_invented12";
export const STUB_PRIVATE_KEY = "sandbox_private_invented34";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: string;
  readonly form: Readonly<Record<string, string>>;
  readonly decoded: unknown;
}

export interface StubAnswer {
  readonly status: number;
  readonly json?: Record<string, unknown>;
  readonly hang?: boolean;
  readonly delayMs?: number;
}

export type Override = (request: RecordedRequest) => StubAnswer | undefined;

interface StubRefund {
  status: string;
  amount: number;
  refund_ref: string;
}

interface StubOrder {
  orderId: string;
  amountMinor: number;
  status: string;
  refunds: StubRefund[];
  paytype?: string;
  sender_card_mask2?: string;
  create_date: string;
  end_date: string;
  err_code?: string;
}

export interface StubLiqPay {
  readonly origin: string;
  readonly requests: readonly RecordedRequest[];
  readonly orders: ReadonlyMap<string, StubOrder>;
  override(next: Override | undefined): void;
  register(orderId: string, amountMinor: number): void;
  pay(orderId: string, card?: { paytype: string; mask: string }): void;
  setStatus(orderId: string, status: string, errCode?: string): void;
  statusJson(orderId: string): Record<string, unknown>;
  webhookFor(orderId: string): { headers: Record<string, string>; rawBody: Uint8Array };
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of body.split("&")) {
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq < 0 ? pair : pair.slice(0, eq));
    const raw = eq < 0 ? "" : pair.slice(eq + 1);
    out[key] = decodeURIComponent(raw.replace(/\+/g, " "));
  }
  return out;
}

function decodeData(form: Record<string, string>): unknown {
  const data = form.data;
  if (data === undefined) return undefined;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function signedResponse(json: Record<string, unknown>): { body: string; headers: Record<string, string> } {
  const data = encodeData(json);
  const signature = signData(data, STUB_PRIVATE_KEY);
  const body = new URLSearchParams({ data, signature }).toString();
  return {
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

export async function startStubLiqPay(): Promise<StubLiqPay> {
  const requests: RecordedRequest[] = [];
  const orders = new Map<string, StubOrder>();
  let custom: Override | undefined;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const rawBody = await readBody(req);
    const form = parseForm(rawBody);
    const decoded = decodeData(form);
    const recorded: RecordedRequest = {
      method: req.method ?? "GET",
      path,
      url,
      headers: { ...req.headers } as Record<string, string | string[] | undefined>,
      rawBody,
      form,
      decoded,
    };
    requests.push(recorded);

    const overrideAnswer = custom?.(recorded);
    if (overrideAnswer?.hang) {
      return;
    }
    if (overrideAnswer?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, overrideAnswer.delayMs));
    }
    if (overrideAnswer !== undefined) {
      const payload =
        overrideAnswer.json === undefined
          ? { status: overrideAnswer.status, body: "" }
          : signedResponse(overrideAnswer.json);
      if (overrideAnswer.json !== undefined) {
        res.writeHead(overrideAnswer.status, payload.headers);
        res.end(payload.body);
      } else {
        res.writeHead(overrideAnswer.status);
        res.end();
      }
      return;
    }

    if (path === LIQPAY_PATHS.checkout) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (path !== LIQPAY_PATHS.request) {
      res.writeHead(404);
      res.end();
      return;
    }

    const data = form.data;
    const signature = form.signature;
    if (
      data === undefined ||
      signature === undefined ||
      !signatureValid(data, signature, STUB_PRIVATE_KEY)
    ) {
      res.writeHead(403);
      res.end(signedResponse({ status: "error", err_code: "err_auth" }).body);
      return;
    }

    const params = decoded as Record<string, unknown> | undefined;
    const action = typeof params?.action === "string" ? params.action : "";
    const orderId = typeof params?.order_id === "string" ? params.order_id : "";

    if (action === "status") {
      const order = orders.get(orderId);
      if (order === undefined) {
        res.writeHead(404);
        res.end(
          signedResponse({ status: "error", err_code: "payment_not_found", order_id: orderId }).body,
        );
        return;
      }
      const json = orderToJson(order);
      const out = signedResponse(json);
      res.writeHead(200, out.headers);
      res.end(out.body);
      return;
    }

    if (action === "refund") {
      const order = orders.get(orderId);
      if (order === undefined) {
        res.writeHead(404);
        res.end(
          signedResponse({ status: "error", err_code: "payment_not_found", order_id: orderId }).body,
        );
        return;
      }
      const amount = typeof params?.amount === "number" ? params.amount : 0;
      const refundRef = typeof params?.refund_ref === "string" ? params.refund_ref : "unknown";
      order.refunds.push({ status: "success", amount, refund_ref: refundRef });
      order.status = "reversed";
      order.end_date = new Date().toISOString().replace("T", " ").slice(0, 19);
      const json = { ...orderToJson(order), status: "sandbox" };
      const out = signedResponse(json);
      res.writeHead(200, out.headers);
      res.end(out.body);
      return;
    }

    res.writeHead(400);
    res.end(signedResponse({ status: "error", err_code: "err_missing" }).body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  function orderToJson(order: StubOrder): Record<string, unknown> {
    return {
      order_id: order.orderId,
      status: order.status,
      amount: order.amountMinor / 100,
      currency: "UAH",
      create_date: order.create_date,
      end_date: order.end_date,
      paytype: order.paytype,
      sender_card_mask2: order.sender_card_mask2,
      err_code: order.err_code,
      refunds: order.refunds.map((entry) => ({
        status: entry.status,
        amount: entry.amount,
        refund_ref: entry.refund_ref,
      })),
    };
  }

  return {
    origin: `http://127.0.0.1:${String(port)}`,
    get requests() {
      return requests;
    },
    get orders() {
      return orders;
    },
    override(next) {
      custom = next;
    },
    register(orderId, amountMinor) {
      const stamp = "2026-11-18 10:00:01";
      orders.set(orderId, {
        orderId,
        amountMinor,
        status: "processing",
        refunds: [],
        create_date: stamp,
        end_date: stamp,
      });
    },
    pay(orderId, card) {
      const order = orders.get(orderId);
      if (order === undefined) return;
      order.status = "success";
      order.end_date = "2026-11-18 10:05:00";
      order.paytype = card?.paytype ?? "card";
      order.sender_card_mask2 = card?.mask ?? "444403******1902";
    },
    setStatus(orderId, status, errCode) {
      const order = orders.get(orderId);
      if (order === undefined) return;
      order.status = status;
      order.err_code = errCode;
      order.end_date = "2026-11-18 10:06:00";
    },
    statusJson(orderId) {
      const order = orders.get(orderId);
      if (order === undefined) {
        return { status: "error", err_code: "payment_not_found" };
      }
      return orderToJson(order);
    },
    webhookFor(orderId) {
      const json = this.statusJson(orderId);
      const data = encodeData(json);
      const signature = signData(data, STUB_PRIVATE_KEY);
      const rawBody = new TextEncoder().encode(
        new URLSearchParams({ data, signature }).toString(),
      );
      return { headers: { "content-type": "application/x-www-form-urlencoded" }, rawBody };
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}