import { describe, expect, it } from "vitest";
import {
  redactEmailVariables,
  REDACTED,
  VARIABLE_TEXT_LIMIT,
} from "./email-variables-redaction.js";

describe("what the admin sees of frozen mail variables (an allowlist the template declares)", () => {
  it("hides every value of an account mail and keeps the keys, even when its template lists them", () => {
    expect(
      redactEmailVariables(
        "customer.password_reset",
        { tokenId: "2d1b4e2e-0000-4000-8000-000000000000" },
        ["tokenId"],
      ),
    ).toEqual({ tokenId: REDACTED });
    expect(redactEmailVariables("customer.anything", { a: 1, b: { c: "x" } }, undefined)).toEqual({
      a: REDACTED,
      b: REDACTED,
    });
  });

  it("shows the values of the keys the template declares, as stored", () => {
    const variables = {
      orderNumber: "AAAA-0001",
      currency: "UAH",
      total: 100,
      lines: [{ title: "Mug", quantity: 2, lineTotal: 100 }],
      delivery: { methodTitle: "Courier", pickupPoint: null, city: "Kyiv" },
    };
    expect(redactEmailVariables("order.placed", variables, Object.keys(variables))).toEqual(
      variables,
    );
    expect(
      redactEmailVariables("admin.test", { providerCode: "resend" }, ["providerCode"]),
    ).toEqual({ providerCode: "resend" });
  });

  it("hides the value of every key the template does not declare, whatever its name (review F3)", () => {
    // Keys a name denylist missed: a one-time code, a magic link, an href, a nested target.
    expect(
      redactEmailVariables(
        "feature.thing",
        {
          orderNumber: "AAAA-0002",
          href: "https://shop.example/x",
          code: "123456",
          otp: "654321",
          magic: "m",
          resetUri: "https://shop.example/r",
          nested: { target: "https://shop.example/t" },
        },
        ["orderNumber"],
      ),
    ).toEqual({
      orderNumber: "AAAA-0002",
      href: REDACTED,
      code: REDACTED,
      otp: REDACTED,
      magic: REDACTED,
      resetUri: REDACTED,
      nested: REDACTED,
    });
  });

  it("hides every value when the template declares nothing or is not registered any more", () => {
    expect(
      redactEmailVariables("feature.thing", { orderNumber: "A", total: 1 }, undefined),
    ).toEqual({ orderNumber: REDACTED, total: REDACTED });
    expect(redactEmailVariables("feature.thing", { orderNumber: "A" }, [])).toEqual({
      orderNumber: REDACTED,
    });
  });

  it("cuts long texts and stops at a depth no template reaches", () => {
    const long = "x".repeat(VARIABLE_TEXT_LIMIT + 50);
    const shown = redactEmailVariables("order.placed", { title: long }, ["title"]).title as string;
    expect(shown).toHaveLength(VARIABLE_TEXT_LIMIT + 1);
    expect(shown.endsWith("…")).toBe(true);
    let deep: unknown = "end";
    for (let level = 0; level < 10; level += 1) {
      deep = { next: deep };
    }
    expect(
      JSON.stringify(
        redactEmailVariables("order.placed", deep as Record<string, unknown>, ["next"]),
      ),
    ).toContain(REDACTED);
  });

  it("answers an empty object for a value that is not an object", () => {
    expect(redactEmailVariables("order.placed", null, ["orderNumber"])).toEqual({});
    expect(redactEmailVariables("order.placed", [1], ["orderNumber"])).toEqual({});
  });
});
