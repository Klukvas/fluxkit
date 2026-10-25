import type { CarrierReportedShipmentStatus } from "@fluxkit/core";

/*
 * Nova Post tracking codes (`currentStatus.statusCode`) mapped to the normalized shipment statuses (plan step 7b). Source:
 * the code table of https://api-portal.novapost.com/methods/methods/shipments/tracking-shipment.md ("build your integration
 * logic on the numeric code"). Observed on production: 1 (a fresh shipment) and 2 (after a delete), spike 7a H25; every
 * other row is the documented meaning, UNVERIFIED against real parcels. A code that is not here has no normalized status:
 * the API keeps the shipment's status and stores the raw code. No code means "returned to the sender", so the plugin never
 * reports `returned`.
 */

function rows(
  codes: readonly string[],
  status: CarrierReportedShipmentStatus,
): [string, CarrierReportedShipmentStatus][] {
  return codes.map((code) => [code, status]);
}

function range(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
}

export const NOVA_POST_STATUS_TABLE: Readonly<Record<string, CarrierReportedShipmentStatus>> =
  Object.freeze(
    Object.fromEntries([
      // 1 Ready to send.
      ...rows(["1"], "created"),
      // 2 Deleted (by the sender, or by our cancel).
      ...rows(["2"], "cancelled"),
      // Accepted, sent, in the recipient's city, sorting centres, customs, airports, with the courier, redirecting,
      // temporary storage, a failed or postponed targeted delivery, waiting for the recipient's data.
      ...rows(
        [
          "4",
          "5",
          "6",
          "13",
          "16",
          "17",
          "19",
          "30",
          "31",
          "80",
          "81",
          "101",
          "104",
          "110",
          "111",
          "112",
          ...range(114, 116),
          ...range(119, 123),
          ...range(125, 128),
          ...range(133, 135),
          "138",
          ...range(197, 199),
        ],
        "in_transit",
      ),
      // 7 Arrived at the division, 8 arrived at the postomat.
      ...rows(["7", "8"], "arrived"),
      // 9 Closed (received), 10 and 11 closed with the money transfer sent or received.
      ...rows(["9", "10", "11"], "delivered"),
      // 102 Return ordered, 103 refusal, 131 return of uncleared cargo, 132 preparing for return.
      ...rows(["102", "103", "131", "132"], "returning"),
    ]),
  );

const DIGITS = /^\d{1,6}$/;

/** The normalized status of a Nova Post code, or `null` when the code (or a non-code) has none. */
export function mapNovaPostStatus(code: string): CarrierReportedShipmentStatus | null {
  if (!DIGITS.test(code)) {
    return null;
  }
  return NOVA_POST_STATUS_TABLE[code] ?? null;
}
