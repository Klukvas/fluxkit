import type {
  CreatedPayment,
  Order,
  ProblemDetails,
  ShopperPaymentFailureCategory,
  ShopperPaymentStatus,
  StoreResult,
} from "@fluxkit/api-client";
import { NetworkError } from "@fluxkit/api-client";
import { locales } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { messagesByLocale } from "../messages";
import {
  DEFAULT_WAIT_SECONDS,
  createPaymentOutcome,
  paymentFailureKey,
  paymentSection,
  paymentStatusKey,
  secondsLeft,
} from "./payment-model";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";
const PAGE = "https://pay.fake.invalid/pay/fake-pay-000001";

const created = (
  overrides: Partial<CreatedPayment> = {},
  status = 201,
): StoreResult<CreatedPayment> => ({
  ok: true,
  status,
  data: {
    paymentId: ID,
    status: "waiting",
    redirectUrl: PAGE,
    expiresAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  },
});

function failure(
  status: number,
  code: string,
  extra: Partial<ProblemDetails> = {},
  retryAfter: string | null = null,
): StoreResult<CreatedPayment> {
  return {
    ok: false,
    status,
    problem: { type: "about:blank", title: "t", status, code, detail: "never shown", ...extra },
    retryAfter,
  } as StoreResult<CreatedPayment>;
}

const rule = (name: string) => failure(409, "rule_violation", { rule: name });

describe("createPaymentOutcome: the outcome table of 'Pay now'", () => {
  it("redirects to the https page of a waiting attempt and forgets the key", () => {
    expect(createPaymentOutcome(created())).toEqual({
      kind: "redirect",
      attempt: "clear",
      url: PAGE,
      paymentId: ID,
    });
    // A replay of the same key answers 200 with the same body.
    expect(createPaymentOutcome(created({}, 200))).toMatchObject({ kind: "redirect", url: PAGE });
  });

  it.each([
    ["an http page", "http://pay.example.com/1"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a missing page", null],
  ])("never redirects to %s: the page could not be opened", (_name, redirectUrl) => {
    const outcome = createPaymentOutcome(created({ redirectUrl }));
    expect(outcome).toMatchObject({ kind: "noPage", attempt: "clear" });
    expect(JSON.stringify(outcome)).not.toContain("javascript");
  });

  it("goes to the status page when the answer is an attempt that is already processing or paid", () => {
    for (const status of ["processing", "paid"] as ShopperPaymentStatus[]) {
      expect(createPaymentOutcome(created({ status, redirectUrl: null }))).toMatchObject({
        kind: "processing",
        paymentId: ID,
      });
    }
  });

  it("treats a failed or expired attempt in the answer as 'no page'", () => {
    for (const status of ["failed", "expired"] as ShopperPaymentStatus[]) {
      expect(createPaymentOutcome(created({ status, redirectUrl: null }))).toMatchObject({
        kind: "noPage",
      });
    }
  });

  it.each([
    ["payment_in_progress", "paymentInProgress"],
    ["order_not_payable", "notPayable"],
    ["payment_not_available", "unavailable"],
    ["payment_window_too_short", "unavailable"],
  ])("maps the 409 rule %s to %s", (name, kind) => {
    expect(createPaymentOutcome(rule(name))).toMatchObject({ kind, attempt: "clear" });
  });

  it("maps 503 payment_provider_unavailable with canRetry true to a retry button (a new key next time)", () => {
    const outcome = createPaymentOutcome(
      failure(
        503,
        "payment_provider_unavailable",
        { payment: { paymentId: ID, status: "failed", canRetry: true } },
        "30",
      ),
    );
    expect(outcome).toEqual({
      kind: "providerUnavailable",
      attempt: "clear",
      canRetry: true,
      waitSeconds: 30,
      paymentId: ID,
    });
  });

  it("maps 503 with canRetry false to a wait with the Retry-After countdown, keeping the key", () => {
    const outcome = createPaymentOutcome(
      failure(
        503,
        "payment_provider_unavailable",
        { payment: { paymentId: ID, status: "processing", canRetry: false } },
        "95",
      ),
    );
    expect(outcome).toEqual({
      kind: "providerUnavailable",
      attempt: "keep",
      canRetry: false,
      waitSeconds: 95,
      paymentId: ID,
    });
  });

  it("uses the documented default wait when Retry-After is missing or unusable", () => {
    for (const retryAfter of [null, "soon", "0", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
      const outcome = createPaymentOutcome(
        failure(
          503,
          "payment_provider_unavailable",
          { payment: { paymentId: ID, status: "processing", canRetry: false } },
          retryAfter,
        ),
      );
      expect(outcome).toMatchObject({ waitSeconds: DEFAULT_WAIT_SECONDS });
    }
  });

  it("keeps the key for a 503 without a payment member and for any other 5xx (the attempt may exist)", () => {
    expect(createPaymentOutcome(failure(503, "service_unavailable"))).toMatchObject({
      kind: "retry",
      attempt: "keep",
    });
    expect(createPaymentOutcome(failure(500, "internal_error"))).toMatchObject({
      kind: "retry",
      attempt: "keep",
    });
  });

  it("keeps the key after a network failure or a timeout", () => {
    const thrown = new NetworkError("down", {
      cause: new TypeError("fetch failed"),
      aborted: false,
    });
    expect(createPaymentOutcome({ thrown })).toMatchObject({ kind: "retry", attempt: "keep" });
  });

  it("maps 429 to a rate-limited message with the wait, keeping the key", () => {
    expect(createPaymentOutcome(failure(429, "too_many_requests", {}, "12"))).toMatchObject({
      kind: "rateLimited",
      attempt: "keep",
      failure: { retryAfterSeconds: 12 },
    });
  });

  it("maps 401 to signedOut, 404 and 400 to notFound, and a reused key to a fresh start", () => {
    expect(createPaymentOutcome(failure(401, "unauthorized"))).toMatchObject({ kind: "signedOut" });
    expect(createPaymentOutcome(failure(404, "not_found"))).toMatchObject({ kind: "notFound" });
    expect(createPaymentOutcome(failure(400, "validation_failed"))).toMatchObject({
      kind: "notFound",
    });
    expect(createPaymentOutcome(failure(409, "idempotency_key_reused"))).toMatchObject({
      kind: "keyReused",
      attempt: "clear",
    });
  });

  it("falls back to a generic failure for an unknown 409 rule", () => {
    expect(createPaymentOutcome(rule("something_new"))).toMatchObject({ kind: "failed" });
  });
});

describe("secondsLeft", () => {
  it("counts whole seconds up to the end of the wait and never goes negative", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 50_000)).toBe(0);
  });
});

function order(
  status: Order["status"],
  payment: Order["payment"],
): Pick<Order, "status" | "payment"> {
  return { status, payment };
}

describe("paymentSection: what the order page offers", () => {
  const latest = (status: ShopperPaymentStatus, over: object = {}) => ({
    paymentId: ID,
    status,
    failureCategory: null,
    expiresAt: "2026-10-29T12:00:00.000Z",
    redirectUrl: null,
    ...over,
  });

  it("is hidden when online payment is off, or when the order cannot be paid online and has no attempt", () => {
    expect(
      paymentSection(
        order("awaiting_payment", { canPay: true, providers: ["fake"], latest: null }),
        false,
      ),
    ).toBeNull();
    expect(
      paymentSection(
        order("awaiting_payment", { canPay: false, providers: [], latest: null }),
        true,
      ),
    ).toBeNull();
  });

  it("offers Pay now when the API says canPay", () => {
    const model = paymentSection(
      order("awaiting_payment", { canPay: true, providers: ["fake"], latest: null }),
      true,
    );
    expect(model).toMatchObject({ action: "pay", status: null, continueUrl: null });
  });

  it("offers Continue payment for a waiting attempt with a safe page, without creating a new attempt", () => {
    const model = paymentSection(
      order("awaiting_payment", {
        canPay: true,
        providers: ["fake"],
        latest: latest("waiting", { redirectUrl: PAGE }),
      }),
      true,
    );
    expect(model).toMatchObject({ action: "continue", continueUrl: PAGE, status: "waiting" });
  });

  it("never offers an unsafe page; a waiting attempt without a usable page falls back to Pay now", () => {
    const model = paymentSection(
      order("awaiting_payment", {
        canPay: true,
        providers: ["fake"],
        latest: latest("waiting", { redirectUrl: "javascript:alert(1)" }),
      }),
      true,
    );
    expect(model).toMatchObject({ action: "pay", continueUrl: null });
  });

  it("offers nothing while the attempt is processing (canPay is false) but lets the shopper check the status", () => {
    const model = paymentSection(
      order("awaiting_payment", {
        canPay: false,
        providers: ["fake"],
        latest: latest("processing"),
      }),
      true,
    );
    expect(model).toMatchObject({ action: "checkStatus", status: "processing" });
  });

  it("shows a failed attempt with Pay now again when canPay", () => {
    const model = paymentSection(
      order("awaiting_payment", {
        canPay: true,
        providers: ["fake"],
        latest: latest("failed", { failureCategory: "declined" }),
      }),
      true,
    );
    expect(model).toMatchObject({ action: "pay", status: "failed", failureCategory: "declined" });
  });

  it("shows the paid attempt and no action on a paid order", () => {
    const model = paymentSection(
      order("paid", { canPay: false, providers: [], latest: latest("paid") }),
      true,
    );
    expect(model).toMatchObject({ action: "none", status: "paid" });
  });

  it("offers no action on a cancelled or expired order even when the answer says canPay", () => {
    for (const status of ["cancelled", "expired", "fulfilled"] as Order["status"][]) {
      const model = paymentSection(
        order(status, { canPay: true, providers: ["fake"], latest: latest("expired") }),
        true,
      );
      expect(model?.action ?? "none").toBe("none");
    }
  });
});

describe("message keys exist in every locale", () => {
  const statuses: ShopperPaymentStatus[] = ["waiting", "processing", "paid", "failed", "expired"];
  const categories: ShopperPaymentFailureCategory[] = [
    "declined",
    "expired",
    "technical",
    "not_accepted",
  ];

  it("has a translated status and failure text for every shopper status and category", () => {
    for (const locale of locales) {
      for (const status of statuses) {
        expect(
          messagesByLocale[locale][paymentStatusKey(status)],
          `${locale} ${status}`,
        ).toBeTruthy();
      }
      for (const category of categories) {
        expect(
          messagesByLocale[locale][paymentFailureKey(category)],
          `${locale} ${category}`,
        ).toBeTruthy();
      }
      expect(messagesByLocale[locale][paymentFailureKey(null)]).toBeTruthy();
    }
  });

  it("falls back to neutral keys for a value the storefront does not know yet", () => {
    expect(paymentStatusKey("brand_new" as ShopperPaymentStatus)).toBe("payment.status.unknown");
    expect(paymentFailureKey("brand_new" as ShopperPaymentFailureCategory)).toBe(
      "payment.failure.technical",
    );
  });
});
