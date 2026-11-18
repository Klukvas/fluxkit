import { describe, expect, it } from "vitest";
import { isLiqPayNotFoundAnswer, liqpayErrorCodeOf, mapLiqPayError } from "./answer-map.js";

describe("LiqPay error mapping", () => {
  it("reads payment_not_found / order_not_found from err_code", () => {
    expect(liqpayErrorCodeOf({ status: "error", err_code: "payment_not_found" })).toBe(
      "payment_not_found",
    );
    expect(isLiqPayNotFoundAnswer({ status: "error", err_code: "payment_not_found" })).toBe(true);
    expect(isLiqPayNotFoundAnswer({ status: "error", err_code: "order_not_found" })).toBe(true);
    expect(isLiqPayNotFoundAnswer({ status: "error", err_code: "err_auth" })).toBe(false);
  });

  it("maps non-2xx payment_not_found to not_found", () => {
    const failure = mapLiqPayError({
      status: 404,
      retryAfter: null,
      json: { status: "error", err_code: "payment_not_found" },
      empty: false,
      rawForm: undefined,
    });
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.reason).toBe("not_found");
    }
  });
});
