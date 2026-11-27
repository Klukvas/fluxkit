import { readFile } from "node:fs/promises";
import { parseIntegrationSecretDeclarations } from "@fluxkit/core";
import { describe, expect, it } from "vitest";

// The admin lists a provider only when core accepts its manifest; LiqPay's key is a pair of one purpose (ADR 0060).
describe("the LiqPay manifest", () => {
  it("declares both outbound keys in a form the integrations store accepts", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { fluxkit?: { secrets?: unknown } };
    const parsed = parseIntegrationSecretDeclarations(manifest.fluxkit?.secrets);
    expect(parsed).toEqual({
      ok: true,
      fields: [
        { field: "public_key", purpose: "outbound", envVariable: "LIQPAY_PUBLIC_KEY" },
        { field: "private_key", purpose: "outbound", envVariable: "LIQPAY_PRIVATE_KEY" },
      ],
    });
  });
});
