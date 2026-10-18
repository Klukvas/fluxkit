import {
  GUEST_ACCESS_DAYS,
  GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH,
  ORDER_PAYMENT_TTL_MINUTES,
} from "@fluxkit/core";
import { loadEnv, ORDER_TOKEN_SECRET_MIN_LENGTH } from "@fluxkit/config";
import { describe, expect, it } from "vitest";
import { DEFAULT_ORDERS_CONFIG } from "./orders-config.js";

describe("orders config", () => {
  it("the defaults of the config package equal the core defaults (the package repeats them on purpose)", () => {
    expect(DEFAULT_ORDERS_CONFIG).toEqual({
      paymentTtlMinutes: ORDER_PAYMENT_TTL_MINUTES.default,
      guestAccessDays: GUEST_ACCESS_DAYS.default,
    });
  });

  it("the shortest ORDER_TOKEN_SECRET of the config package is the shortest secret core accepts", () => {
    expect(ORDER_TOKEN_SECRET_MIN_LENGTH).toBe(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH);
    const base = { DATABASE_URL: "postgres://x" };
    const shortest = "s".repeat(GUEST_ACCESS_TOKEN_SECRET_MIN_LENGTH);
    expect(loadEnv({ ...base, ORDER_TOKEN_SECRET: shortest }).orderTokenSecret).toBe(shortest);
    expect(() => loadEnv({ ...base, ORDER_TOKEN_SECRET: shortest.slice(1) })).toThrow(
      /ORDER_TOKEN_SECRET/,
    );
  });

  it("the bounds of the environment variables are the bounds core enforces", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(
      loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: String(ORDER_PAYMENT_TTL_MINUTES.min) })
        .orderPaymentTtlMinutes,
    ).toBe(ORDER_PAYMENT_TTL_MINUTES.min);
    expect(
      loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: String(ORDER_PAYMENT_TTL_MINUTES.max) })
        .orderPaymentTtlMinutes,
    ).toBe(ORDER_PAYMENT_TTL_MINUTES.max);
    expect(() =>
      loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: String(ORDER_PAYMENT_TTL_MINUTES.min - 1) }),
    ).toThrow(/ORDER_PAYMENT_TTL_MINUTES/);
    expect(() =>
      loadEnv({ ...base, ORDER_PAYMENT_TTL_MINUTES: String(ORDER_PAYMENT_TTL_MINUTES.max + 1) }),
    ).toThrow(/ORDER_PAYMENT_TTL_MINUTES/);
    expect(
      loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: String(GUEST_ACCESS_DAYS.min) })
        .orderGuestAccessDays,
    ).toBe(GUEST_ACCESS_DAYS.min);
    expect(
      loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: String(GUEST_ACCESS_DAYS.max) })
        .orderGuestAccessDays,
    ).toBe(GUEST_ACCESS_DAYS.max);
    expect(() =>
      loadEnv({ ...base, ORDER_GUEST_ACCESS_DAYS: String(GUEST_ACCESS_DAYS.max + 1) }),
    ).toThrow(/ORDER_GUEST_ACCESS_DAYS/);
  });
});
