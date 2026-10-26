import { describe, expect, it } from "vitest";
import {
  redactEmailVariables,
  REDACTED,
  VARIABLE_TEXT_LIMIT,
} from "./email-variables-redaction.js";

describe("what the admin sees of frozen mail variables", () => {
  it("hides every value of an account mail and keeps the keys", () => {
    expect(
      redactEmailVariables("customer.password_reset", {
        tokenId: "2d1b4e2e-0000-4000-8000-000000000000",
      }),
    ).toEqual({ tokenId: REDACTED });
    expect(redactEmailVariables("customer.anything", { a: 1, b: { c: "x" } })).toEqual({
      a: REDACTED,
      b: REDACTED,
    });
  });

  it("shows order data as stored", () => {
    const variables = {
      orderNumber: "AAAA-0001",
      currency: "UAH",
      total: 100,
      lines: [{ title: "Mug", quantity: 2, lineTotal: 100 }],
      delivery: { methodTitle: "Courier", pickupPoint: null, city: "Kyiv" },
    };
    expect(redactEmailVariables("order.placed", variables)).toEqual(variables);
    expect(redactEmailVariables("admin.test", { providerCode: "resend" })).toEqual({
      providerCode: "resend",
    });
  });

  it("hides the value of any key that names a secret or a link, at any depth", () => {
    expect(
      redactEmailVariables("feature.thing", {
        accessToken: "t",
        nested: { resetLink: "https://x", deep: [{ apiKey: "k", fine: 1 }] },
        Password: "p",
        shopUrl: "u",
      }),
    ).toEqual({
      accessToken: REDACTED,
      nested: { resetLink: REDACTED, deep: [{ apiKey: REDACTED, fine: 1 }] },
      Password: REDACTED,
      shopUrl: REDACTED,
    });
  });

  it("cuts long texts and stops at a depth no template reaches", () => {
    const long = "x".repeat(VARIABLE_TEXT_LIMIT + 50);
    const shown = redactEmailVariables("order.placed", { title: long }).title as string;
    expect(shown).toHaveLength(VARIABLE_TEXT_LIMIT + 1);
    expect(shown.endsWith("…")).toBe(true);
    let deep: unknown = "end";
    for (let level = 0; level < 10; level += 1) {
      deep = { next: deep };
    }
    expect(
      JSON.stringify(redactEmailVariables("order.placed", deep as Record<string, unknown>)),
    ).toContain(REDACTED);
  });

  it("answers an empty object for a value that is not an object", () => {
    expect(redactEmailVariables("order.placed", null)).toEqual({});
    expect(redactEmailVariables("order.placed", [1])).toEqual({});
  });
});
