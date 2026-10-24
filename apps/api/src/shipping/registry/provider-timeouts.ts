import { SHIPPING_PROVIDER_TIMEOUTS_MS } from "@fluxkit/core";

/**
 * How long the shipment routes and the tracking job give one provider call (ADR 0029 decision 9: the API decides, not the
 * plugin). Production always uses `DEFAULT_SHIPMENT_CALL_TIMEOUTS` (the core waybill limit, 15 s, for every waybill call);
 * only specs pass shorter ones (`startApp({ shipmentCallTimeouts })`) so a "carrier never answers" case does not wait 15 s.
 */
export interface ShipmentCallTimeouts {
  /** `createWaybill`, `findWaybill` and `cancelWaybill`. */
  readonly waybillMs: number;
  /** One `track` call (one page of the tracking job, or one refresh). */
  readonly trackingMs: number;
  /** `fetchLabel`. */
  readonly labelMs: number;
}

export const DEFAULT_SHIPMENT_CALL_TIMEOUTS: ShipmentCallTimeouts = Object.freeze({
  waybillMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
  trackingMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
  labelMs: SHIPPING_PROVIDER_TIMEOUTS_MS.waybill,
});

/** Injection token of the `ShipmentCallTimeouts` in force (global, from `ShippingRegistryModule`). */
export const SHIPMENT_CALL_TIMEOUTS = Symbol("fluxkit:shipment-call-timeouts");
