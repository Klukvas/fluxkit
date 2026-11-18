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
  sender_card_type?: string;
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
  pay(orderId: string, card?: { paytype?: string; cardType?: string; mask?: string }): void;
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

/** Direct JSON body as documented for `/api/request` status and refund answers. */
function jsonResponse(json: Record<string, unknown>): {
  body: string;
  headers: Record<string, string>;
} {
  return {
    body: JSON.stringify(json),
    headers: { "content-type": "application/json" },
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
      if (overrideAnswer.json !== undefined) {
        const payload = jsonResponse(overrideAnswer.json);
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
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "error", err_code: "err_auth" }));
      return;
    }

    const params = decoded as Record<string, unknown> | undefined;
    const action = typeof params?.action === "string" ? params.action : "";
    const orderId = typeof params?.order_id === "string" ? params.order_id : "";

    if (action === "status") {
      const order = orders.get(orderId);
      if (order === undefined) {
        const out = jsonResponse({
          status: "error",
          err_code: "payment_not_found",
          order_id: orderId,
        });
        res.writeHead(404, out.headers);
        res.end(out.body);
        return;
      }
      const out = jsonResponse(orderToJson(order));
      res.writeHead(200, out.headers);
      res.end(out.body);
      return;
    }

    if (action === "refund") {
      const order = orders.get(orderId);
      if (order === undefined) {
        const out = jsonResponse({
          result: "error",
          status: "error",
          err_code: "payment_not_found",
        });
        res.writeHead(404, out.headers);
        res.end(out.body);
        return;
      }
      const amount =
        typeof params?.amount === "number"
          ? params.amount
          : typeof params?.amount === "string"
            ? Number(params.amount)
            : 0;
      const refundRef = typeof params?.refund_ref === "string" ? params.refund_ref : "unknown";
      order.refunds.push({ status: "success", amount, refund_ref: refundRef });
      order.status = "reversed";
      order.end_date = String(Date.now());
      // Documented refund answer: result/status/payment_id (no order_id/amount required).
      const out = jsonResponse({
        result: "ok",
        wait_amount: false,
        payment_id: "2417662437",
        status: "reversed",
      });
      res.writeHead(200, out.headers);
      res.end(out.body);
      return;
    }

    const missing = jsonResponse({ status: "error", err_code: "err_missing" });
    res.writeHead(400, missing.headers);
    res.end(missing.body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  function orderToJson(order: StubOrder): Record<string, unknown> {
    const whole = Math.trunc(order.amountMinor / 100);
    const frac = Math.abs(order.amountMinor % 100);
    const amountText = `${String(whole)}.${String(frac).padStart(2, "0")}`;
    return {
      order_id: order.orderId,
      status: order.status,
      // Docs often return decimal strings and millisecond epoch strings.
      amount: amountText,
      currency: "UAH",
      create_date: order.create_date,
      end_date: order.end_date,
      paytype: order.paytype,
      sender_card_type: order.sender_card_type,
      sender_card_mask2: order.sender_card_mask2,
      err_code: order.err_code,
      // Fluxkit's payment-provider contract requires getPayment to list refunds under our refund UUID after a
      // successful refund call. Whether live LiqPay status answers echo `refund_ref` / a `refunds[]` list is UNKNOWN
      // until S1; the stub models the shape Fluxkit needs so lost-refund reconciliation can be tested locally.
      ...(order.refunds.length === 0
        ? {}
        : {
            refunds: order.refunds.map((entry) => ({
              status: entry.status,
              amount: entry.amount,
              refund_ref: entry.refund_ref,
            })),
          }),
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
      const stamp = "1731916801000";
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
      order.end_date = "1731917100000";
      order.paytype = card?.paytype ?? "card";
      order.sender_card_type = card?.cardType ?? "visa";
      order.sender_card_mask2 = card?.mask ?? "444403******1902";
    },
    setStatus(orderId, status, errCode) {
      const order = orders.get(orderId);
      if (order === undefined) return;
      order.status = status;
      order.err_code = errCode;
      order.end_date = "1731917160000";
    },
    statusJson(orderId) {
      const order = orders.get(orderId);
      if (order === undefined) {
        return { status: "error", err_code: "payment_not_found" };
      }
      return orderToJson(order);
    },
    webhookFor(orderId) {
      const order = orders.get(orderId);
      const json =
        order === undefined
          ? { status: "error", err_code: "payment_not_found" }
          : orderToJson(order);
      const data = encodeData(json);
      const signature = signData(data, STUB_PRIVATE_KEY);
      const rawBody = new TextEncoder().encode(new URLSearchParams({ data, signature }).toString());
      return { headers: { "content-type": "application/x-www-form-urlencoded" }, rawBody };
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
