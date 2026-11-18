import type { PaymentHandoff, StoreClient, StoreResult } from "@fluxkit/api-client";
import { describe, expect, it, vi } from "vitest";
import {
  fetchPaymentHandoff,
  isAllowedHandoffActionUrl,
  submitHandoffForm,
} from "./payment-handoff";
import type { PaymentReturn } from "./payment-return";

const ID = "6f1c1d8e-5f0a-4f6e-9a0b-0c2f4b7d1a11";
const SAFE: PaymentHandoff = {
  actionUrl: "https://www.liqpay.ua/api/3/checkout",
  fields: { data: "abc", signature: "sig" },
};

describe("isAllowedHandoffActionUrl", () => {
  it("allows only https www.liqpay.ua without credentials", () => {
    expect(isAllowedHandoffActionUrl(SAFE.actionUrl)).toBe(true);
    expect(isAllowedHandoffActionUrl("https://www.liqpay.ua/api/3/checkout?x=1")).toBe(true);
    expect(isAllowedHandoffActionUrl("http://www.liqpay.ua/api/3/checkout")).toBe(false);
    expect(isAllowedHandoffActionUrl("https://liqpay.ua/api/3/checkout")).toBe(false);
    expect(isAllowedHandoffActionUrl("https://evil.example/")).toBe(false);
    expect(isAllowedHandoffActionUrl("https://user:pass@www.liqpay.ua/")).toBe(false);
    expect(isAllowedHandoffActionUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("fetchPaymentHandoff", () => {
  const guest: PaymentReturn = {
    kind: "guest",
    number: "7K3M-9QX2",
    accessToken: "A".repeat(43),
    paymentId: ID,
  };

  it("returns ok only when the API answer has an allow-listed actionUrl", async () => {
    const getOrderPaymentHandoff = vi.fn((): Promise<StoreResult<PaymentHandoff>> =>
      Promise.resolve({ ok: true, status: 200, data: SAFE }),
    );
    const client = { getOrderPaymentHandoff } as unknown as StoreClient;
    expect(await fetchPaymentHandoff(client, guest, ID)).toEqual({ kind: "ok", handoff: SAFE });

    getOrderPaymentHandoff.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { ...SAFE, actionUrl: "https://evil.example/pay" },
    });
    expect(await fetchPaymentHandoff(client, guest, ID)).toEqual({ kind: "error" });
  });

  it("maps 404 / 409 to not_found / unavailable", async () => {
    const getOrderPaymentHandoff = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        problem: { status: 404, code: "not_found" },
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        problem: { status: 409, code: "rule_violation", rule: "handoff_unavailable" },
      });
    const client = { getOrderPaymentHandoff } as unknown as StoreClient;
    expect(await fetchPaymentHandoff(client, guest, ID)).toEqual({ kind: "not_found" });
    expect(await fetchPaymentHandoff(client, guest, ID)).toEqual({ kind: "unavailable" });
  });
});

describe("submitHandoffForm", () => {
  it("builds a hidden POST form and submits it for an allow-listed URL", () => {
    const submitted: string[] = [];
    const form = {
      method: "",
      action: "",
      acceptCharset: "",
      style: { display: "" },
      appendChild: vi.fn(),
      submit: () => submitted.push("ok"),
    };
    const input = { type: "", name: "", value: "" };
    const document = {
      createElement: vi.fn((tag: string) => (tag === "form" ? form : { ...input })),
      body: { appendChild: vi.fn() },
    } as unknown as Document;

    expect(submitHandoffForm(document, SAFE)).toBe(true);
    expect(form.method).toBe("POST");
    expect(form.action).toBe(SAFE.actionUrl);
    expect(submitted).toEqual(["ok"]);
    expect(submitHandoffForm(document, { ...SAFE, actionUrl: "https://evil.example/" })).toBe(
      false,
    );
  });
});
