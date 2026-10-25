import { describe, expect, it } from "vitest";
import { CARRIER_REPORTED_SHIPMENT_STATUSES } from "@fluxkit/core";
import { mapNovaPostStatus, NOVA_POST_STATUS_TABLE } from "./status-map.js";

/*
 * The status table of the tracking page (https://api-portal.novapost.com/methods/methods/shipments/tracking-shipment.md),
 * "build your integration logic on the numeric code". Only 1 and 2 were observed (spike 7a, H25); the rest is the
 * documented meaning, UNVERIFIED against real parcels.
 */
describe("Nova Post tracking status mapping", () => {
  it.each([
    ["1", "created"],
    ["2", "cancelled"],
    ["4", "in_transit"],
    ["5", "in_transit"],
    ["6", "in_transit"],
    ["13", "in_transit"],
    ["16", "in_transit"],
    ["17", "in_transit"],
    ["19", "in_transit"],
    ["30", "in_transit"],
    ["31", "in_transit"],
    ["80", "in_transit"],
    ["81", "in_transit"],
    ["101", "in_transit"],
    ["104", "in_transit"],
    ["110", "in_transit"],
    ["111", "in_transit"],
    ["112", "in_transit"],
    ["114", "in_transit"],
    ["115", "in_transit"],
    ["116", "in_transit"],
    ["119", "in_transit"],
    ["120", "in_transit"],
    ["121", "in_transit"],
    ["122", "in_transit"],
    ["123", "in_transit"],
    ["125", "in_transit"],
    ["126", "in_transit"],
    ["127", "in_transit"],
    ["128", "in_transit"],
    ["133", "in_transit"],
    ["134", "in_transit"],
    ["135", "in_transit"],
    ["138", "in_transit"],
    ["197", "in_transit"],
    ["198", "in_transit"],
    ["199", "in_transit"],
    ["7", "arrived"],
    ["8", "arrived"],
    ["9", "delivered"],
    ["10", "delivered"],
    ["11", "delivered"],
    ["102", "returning"],
    ["103", "returning"],
    ["131", "returning"],
    ["132", "returning"],
  ] as const)("code %s is %s", (code, status) => {
    expect(mapNovaPostStatus(code)).toBe(status);
  });

  it.each([
    "99",
    "105",
    "106",
    "113",
    "117",
    "118",
    "130",
    "141",
    "144",
    "149",
    "155",
    "999",
    "3",
    "108",
    "12345",
  ])("code %s has no normalized status (the shipment keeps its own)", (code) => {
    expect(mapNovaPostStatus(code)).toBeNull();
  });

  it("never reports returned (no code means it) and only reports carrier statuses", () => {
    const reported = new Set(Object.values(NOVA_POST_STATUS_TABLE));
    expect(reported.has("returned")).toBe(false);
    for (const status of reported) {
      expect(CARRIER_REPORTED_SHIPMENT_STATUSES).toContain(status);
    }
  });

  it("is frozen, so no caller can change the table", () => {
    expect(Object.isFrozen(NOVA_POST_STATUS_TABLE)).toBe(true);
  });

  it("does not map something that is not a digit code", () => {
    for (const code of ["", " 1", "1.0", "-1", "01x", "Ready to send"]) {
      expect(mapNovaPostStatus(code), code).toBeNull();
    }
  });
});
