import type { AdminShipment, ProblemDetails } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  SHIPMENT_REFUSAL_RULES,
  createFieldErrors,
  createNotice,
  describeShipmentProblem,
  reconcileNotice,
  retrySeconds,
} from "./shipment-outcome";

function problem(extra: Partial<ProblemDetails>): ProblemDetails {
  return {
    type: "about:blank",
    title: "x",
    status: 409,
    code: "rule_violation",
    detail: "SECRET-ENGLISH-DETAIL",
    ...extra,
  };
}

const base = { trackingNumber: null } as AdminShipment;

describe("createNotice: the three outcomes of a create (201)", () => {
  it("created: names the tracking number", () => {
    expect(
      createNotice({
        shipment: { ...base, status: "created", trackingNumber: "FAKE000001" },
        failure: null,
      }),
    ).toEqual({ kind: "created", trackingNumber: "FAKE000001" });
  });

  it("failed: carries the typed reason and the raw carrier codes, nothing else", () => {
    expect(
      createNotice({
        shipment: { ...base, status: "failed" },
        failure: { reason: "invalid_credentials", providerCodes: ["E_1", "has space"] },
      }),
    ).toEqual({ kind: "failed", reason: "invalid_credentials", providerCodes: ["E_1"] });
    expect(createNotice({ shipment: { ...base, status: "failed" }, failure: null })).toMatchObject({
      kind: "failed",
      reason: "rejected",
    });
  });

  it("unknown: tells the admin the result is unknown (no retry), and so does anything unexpected", () => {
    expect(createNotice({ shipment: { ...base, status: "unknown" }, failure: null })).toEqual({
      kind: "unknownCreate",
    });
    expect(createNotice({ shipment: { ...base, status: "pending" }, failure: null })).toEqual({
      kind: "unknownCreate",
    });
  });
});

describe("reconcileNotice", () => {
  it("says found for a created waybill and none for a failed one", () => {
    expect(reconcileNotice({ status: "created" })).toEqual({ kind: "reconciled", found: true });
    expect(reconcileNotice({ status: "failed" })).toEqual({ kind: "reconciled", found: false });
  });
});

describe("describeShipmentProblem", () => {
  it("explains every documented 409 reason with a message of its own", () => {
    expect([...SHIPMENT_REFUSAL_RULES].sort()).toEqual(
      [
        "awaiting_stock",
        "carrier_invalid_credentials",
        "carrier_not_supported",
        "carrier_rejected",
        "invalid_transition",
        "label_not_available",
        "no_carrier",
        "order_not_paid",
        "provider_not_enabled",
        "reconcile_too_early",
        "shipment_exists",
        "shipment_not_tracked",
        "shipment_not_unknown",
      ].sort(),
    );
    for (const rule of SHIPMENT_REFUSAL_RULES) {
      expect(describeShipmentProblem(409, problem({ rule }), null)).toEqual({
        key: `shipment.refusal.${rule}`,
      });
    }
  });

  it("shows a carrier refusal's raw codes in small print, filtered to the documented shape", () => {
    expect(
      describeShipmentProblem(
        409,
        problem({
          rule: "carrier_rejected",
          reason: "rejected",
          providerCodes: ["E_1", "E 2", "E3"],
        }),
        null,
      ),
    ).toEqual({ key: "shipment.refusal.carrier_rejected", code: "E_1, E3" });
  });

  it("answers a 503 with a retry hint from Retry-After, and without one when the header is not a plausible wait", () => {
    const unavailable = problem({
      status: 503,
      code: "shipping_provider_unavailable",
      reason: "unavailable",
      providerCodes: [],
    });
    expect(describeShipmentProblem(503, unavailable, "30")).toEqual({
      key: "shipment.unavailableRetry",
      values: { seconds: 30 },
    });
    expect(describeShipmentProblem(503, unavailable, null)).toEqual({
      key: "shipment.unavailable",
    });
    expect(describeShipmentProblem(503, unavailable, "soon")).toEqual({
      key: "shipment.unavailable",
    });
  });

  it("leaves every other answer to the shell's messages and never returns the English detail", () => {
    expect(describeShipmentProblem(404, problem({ status: 404, code: "not_found" }), null)).toEqual(
      {
        key: "errors.code.not_found",
      },
    );
    expect(describeShipmentProblem(403, problem({ status: 403, code: "forbidden" }), null)).toEqual(
      {
        key: "errors.code.forbidden",
      },
    );
    expect(
      JSON.stringify(describeShipmentProblem(409, problem({ rule: "brand_new_rule" }), null)),
    ).not.toContain("SECRET");
  });
});

describe("retrySeconds", () => {
  it("reads whole seconds from 1 to an hour, nothing else", () => {
    expect(retrySeconds("30")).toBe(30);
    expect(retrySeconds("3600")).toBe(3600);
    for (const header of [null, "", "0", "-5", "3601", "1.5", "1e2", "Wed, 21 Oct 2026", "99999"]) {
      expect(retrySeconds(header), String(header)).toBeNull();
    }
  });
});

describe("createFieldErrors", () => {
  const fields = ["weightGrams", "lengthMm", "description", "declaredValue"];

  it("puts each path on its field; declaredValue.* on the declared value; the rest in the summary", () => {
    const mapped = createFieldErrors(
      problem({
        status: 400,
        code: "validation_failed",
        errors: [
          { path: "weightGrams", code: "too_big" },
          { path: "declaredValue.currency", code: "currency_mismatch" },
          { path: "payer", code: "invalid_value" },
          { path: "nonsense", code: "unknown_field" },
        ],
      }),
      fields,
    );
    expect(mapped.fields).toEqual({
      weightGrams: { key: "errors.reason.too_big" },
      declaredValue: { key: "errors.generic", code: "currency_mismatch" },
    });
    expect(mapped.other).toEqual([
      { key: "errors.reason.invalid_value" },
      { key: "errors.reason.unknown_field" },
    ]);
  });
});
