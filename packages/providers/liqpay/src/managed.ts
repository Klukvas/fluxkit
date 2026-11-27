import { Logger } from "@nestjs/common";
import {
  PAYMENT_LIMITS,
  PROVIDER_PAYMENT_ID_PATTERN,
  type CreateOutboundClient,
  type LocateWebhook,
} from "@fluxkit/core";
import { parseLiqPayEnv } from "./config.js";
import { LiqPayHttp } from "./http.js";
import { parseWebhookForm } from "./payload.js";
import { LiqPayPaymentProvider } from "./liqpay-provider.js";

export const createOutboundClient: CreateOutboundClient<"payment"> = (secrets, context) => {
  const config = parseLiqPayEnv({
    LIQPAY_PUBLIC_KEY: secrets.public_key,
    LIQPAY_PRIVATE_KEY: secrets.private_key,
  });
  const provider = new LiqPayPaymentProvider(
    new LiqPayHttp({ ...config, transport: context.transport }),
    new Logger("LiqPay"),
    context.now,
  );
  return {
    code: provider.code,
    capabilities: provider.capabilities,
    createPayment: (input, signal) =>
      context.transport.start(signal, () => ({
        completion: provider.createPayment(input, signal),
      })),
    getPayment: (id, signal) => provider.getPayment(id, signal),
    invalidatePayment: (id, signal) =>
      context.transport.start(signal, () => ({
        completion: provider.invalidatePayment(id, signal),
      })),
    refund: (input, signal) => provider.refund(input, signal),
    buildCheckoutHandoff: (input, signal) =>
      context.transport.start(signal, () => ({
        completion: provider.buildCheckoutHandoff(input, signal),
      })),
    verifyWebhook: (input, signal) =>
      context.transport.start(signal, () => ({
        completion: provider.verifyWebhook(input, signal),
      })),
  };
};

/** Unverified lookup hints only; order_id is the port's provider id and reference. */
export const locateWebhook: LocateWebhook = (input) => {
  if (
    !(input.rawBody instanceof Uint8Array) ||
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > PAYMENT_LIMITS.webhookBodyMaxBytes
  )
    return null;
  const contentType = input.headers["content-type"] ?? input.headers["Content-Type"];
  if (
    contentType === undefined ||
    !contentType.toLowerCase().includes("application/x-www-form-urlencoded")
  )
    return null;
  let json: unknown;
  try {
    const { data } = parseWebhookForm(input.rawBody);
    if (
      data === undefined ||
      data === "" ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      return null;
    const bytes = Buffer.from(data, "base64");
    if (bytes.toString("base64") !== data) return null;
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return null;
  }
  if (
    typeof json !== "object" ||
    json === null ||
    !("order_id" in json) ||
    typeof json.order_id !== "string" ||
    !PROVIDER_PAYMENT_ID_PATTERN.test(json.order_id)
  )
    return null;
  return { reference: json.order_id, providerPaymentId: json.order_id };
};
