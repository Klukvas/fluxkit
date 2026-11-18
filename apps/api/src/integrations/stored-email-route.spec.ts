import { describe, expect, it } from "vitest";
import { storedEmailActivationAllowed, storedEmailChain } from "./stored-email-route.js";

describe("stored email route", () => {
  it("lets one provider of any code be on, and a second only for Resend and Brevo", () => {
    expect(storedEmailActivationAllowed([], "testmail")).toBe(true);
    expect(storedEmailActivationAllowed(["resend"], "brevo")).toBe(true);
    expect(storedEmailActivationAllowed(["brevo"], "resend")).toBe(true);
    expect(storedEmailActivationAllowed(["testmail"], "fake")).toBe(false);
    expect(storedEmailActivationAllowed(["resend"], "testmail")).toBe(false);
    expect(storedEmailActivationAllowed(["resend", "brevo"], "testmail")).toBe(false);
  });

  it("keeps a single provider and always sends Resend before Brevo", () => {
    expect(storedEmailChain([{ providerCode: "testmail" }])).toEqual([
      { providerCode: "testmail" },
    ]);
    expect(
      storedEmailChain([{ providerCode: "brevo" }, { providerCode: "resend" }]).map(
        (row) => row.providerCode,
      ),
    ).toEqual(["resend", "brevo"]);
    expect(() =>
      storedEmailChain([{ providerCode: "testmail" }, { providerCode: "fake" }]),
    ).toThrow("More than one email integration is enabled.");
  });
});
