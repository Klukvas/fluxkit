import { Logger } from "@nestjs/common";
import {
  PAYMENT_CODE_PATTERN,
  PAYMENT_LIMITS,
  PROVIDER_PAYMENT_ID_PATTERN,
  type AccountIdentity,
  type CheckCredentials,
  type CreateOutboundClient,
  type LocateWebhook,
} from "@fluxkit/core";
import { MONOBANK_PATHS, parseMonobankEnv } from "./config.js";
import { retryAfterSecondsOf } from "./answer-map.js";
import { MonobankHttp } from "./http.js";
import { MonobankPaymentProvider } from "./monobank-provider.js";

export const createOutboundClient: CreateOutboundClient<"payment"> = (secrets, context) => {
  const config = parseMonobankEnv({ MONOBANK_TOKEN: secrets.token });
  const provider = new MonobankPaymentProvider(
    new MonobankHttp({ token: config.token, transport: context.transport }),
    new Logger("Monobank"),
    context.now,
  );
  return {
    code: provider.code,
    capabilities: provider.capabilities,
    createPayment: (input, signal) => provider.createPayment(input, signal),
    getPayment: (id, signal) => provider.getPayment(id, signal),
    invalidatePayment: (id, signal) => provider.invalidatePayment(id, signal),
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

export const accountIdentity: AccountIdentity = async (secrets, context, signal) => {
  const config = parseMonobankEnv({ MONOBANK_TOKEN: secrets.token });
  const exchange = await new MonobankHttp({
    token: config.token,
    transport: context.transport,
  }).call({ method: "GET", path: MONOBANK_PATHS.details }, signal);
  if (exchange.kind === "failed") return { ok: false, code: "unavailable" };
  const { answer } = exchange;
  if (answer.status === 401 || answer.status === 403)
    return { ok: false, code: "invalid_credentials" };
  if (answer.status === 429) {
    const retryAfterSeconds = retryAfterSecondsOf(answer.retryAfter);
    return {
      ok: false,
      code: "rate_limited",
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    };
  }
  if (
    answer.status !== 200 ||
    typeof answer.json !== "object" ||
    answer.json === null ||
    !("merchantId" in answer.json)
  )
    return { ok: false, code: "unavailable" };
  const identity = answer.json.merchantId;
  if (typeof identity !== "string" || !/^[A-Za-z0-9_.-]{1,256}$/.test(identity))
    return { ok: false, code: "unavailable" };
  return { ok: true, identity };
};

export const checkCredentials: CheckCredentials = async (secrets, context, signal) => {
  const result = await accountIdentity(secrets, context, signal);
  return result.ok
    ? { code: "ok" }
    : {
        code: result.code,
        ...(result.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: result.retryAfterSeconds }),
      };
};

/** Unverified lookup hints only; the bound client still verifies the exact raw bytes. */
export const locateWebhook: LocateWebhook = (input) => {
  if (
    !(input.rawBody instanceof Uint8Array) ||
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > PAYMENT_LIMITS.webhookBodyMaxBytes
  )
    return null;
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.rawBody)) as unknown;
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const providerPaymentId =
    "invoiceId" in json &&
    typeof json.invoiceId === "string" &&
    PROVIDER_PAYMENT_ID_PATTERN.test(json.invoiceId)
      ? json.invoiceId
      : undefined;
  const reference =
    "reference" in json &&
    typeof json.reference === "string" &&
    PAYMENT_CODE_PATTERN.test(json.reference)
      ? json.reference
      : undefined;
  if (providerPaymentId !== undefined)
    return { providerPaymentId, ...(reference === undefined ? {} : { reference }) };
  return reference === undefined ? null : { reference };
};
