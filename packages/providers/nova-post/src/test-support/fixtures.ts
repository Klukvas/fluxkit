import type { WaybillRequest } from "@fluxkit/core";
import { NovaPostHttp } from "../http.js";
import { NovaPostShippingProvider } from "../nova-post-provider.js";
import {
  captureLogger,
  STUB_API_KEY,
  STUB_CITY_ID,
  STUB_PERSONAL,
  STUB_SENDER_DIVISION_ID,
  type StubCarrier,
} from "./stub-carrier.js";

/* TEST ONLY. Invented settings and requests for the plugin's specs; no real person, phone or division. */

export const VALID_SETTINGS = Object.freeze({
  senderName: STUB_PERSONAL.senderName,
  senderPhone: STUB_PERSONAL.senderPhone,
  senderDivisionId: STUB_SENDER_DIVISION_ID,
  payerDefault: "Recipient",
  defaultParcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100 },
});

export function waybillRequest(overrides: Partial<WaybillRequest> = {}): WaybillRequest {
  return {
    clientReference: "7K3M-9QX2",
    service: null,
    payer: "recipient",
    declaredValue: { amount: 125_050, currency: "UAH" },
    parcel: { weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100, seats: 1 },
    description: "Order 7K3M-9QX2",
    recipient: {
      firstName: STUB_PERSONAL.recipientFirstName,
      lastName: STUB_PERSONAL.recipientLastName,
      phone: STUB_PERSONAL.recipientPhone,
    },
    destination: {
      kind: "pickup_point",
      cityRef: String(STUB_CITY_ID),
      pickupPointRef: "700005",
    },
    settings: VALID_SETTINGS,
    ...overrides,
  };
}

/** A provider wired to the stub carrier, with a captured log and an optional clock. */
export function providerOn(
  stub: StubCarrier,
  options: { now?: () => number; apiKey?: string } = {},
) {
  const logger = captureLogger();
  const http = new NovaPostHttp({
    baseUrl: stub.baseUrl,
    apiKey: options.apiKey ?? STUB_API_KEY,
    logger,
    now: options.now,
  });
  return { provider: new NovaPostShippingProvider(http, logger), http, logger };
}

export const live = (): AbortSignal => new AbortController().signal;
