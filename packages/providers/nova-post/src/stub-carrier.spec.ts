import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RequestSpec } from "./http.js";
import { live, providerOn, waybillRequest } from "./test-support/fixtures.js";
import { startStubCarrier, type StubCarrier } from "./test-support/stub-carrier.js";

/*
 * The stub carrier refuses what production refused (review finding 6), so a plugin request that production would refuse
 * cannot pass the specs. Each request here goes through the plugin's HTTP client straight to the stub (no plugin rules).
 */
describe("the stub carrier is as strict as production was", () => {
  let stub: StubCarrier;

  beforeEach(async () => {
    stub = await startStubCarrier();
  });

  afterEach(async () => {
    await stub.close();
  });

  const call = async (spec: Partial<RequestSpec> & Pick<RequestSpec, "method" | "path">) => {
    const { http } = providerOn(stub);
    const answer = await http.request(
      { operation: "stubSpec", maxBytes: 1024 * 1024, timeoutMs: 5000, retryOn401: false, ...spec },
      live(),
    );
    return { status: answer.status, json: answer.json };
  };

  /** The create body the plugin sends for the fixture request, as the stub recorded it. */
  const pluginBody = async (): Promise<Record<string, unknown>> => {
    const { provider } = providerOn(stub);
    const created = await provider.createWaybill(waybillRequest(), live());
    expect(created.ok).toBe(true);
    return structuredClone(stub.of("createShipment")[0]?.body) as Record<string, unknown>;
  };

  it("refuses a create body with a missing field or a one-word contact name", async () => {
    const body = await pluginBody();
    const parcels = body.parcels as Record<string, unknown>[];
    delete parcels[0]?.actualWeight;
    expect(await call({ method: "POST", path: "/shipments", body })).toEqual({
      status: 422,
      json: {
        errors: { "parcels.0.actualWeight": "The parcels.0.actualWeight field is required." },
      },
    });
    const oneWordSender = await pluginBody();
    (oneWordSender.sender as Record<string, unknown>).name = "Відправник";
    expect(await call({ method: "POST", path: "/shipments", body: oneWordSender })).toEqual({
      status: 422,
      json: { errors: { errorMessage: "Contact Sender contains less than 2 words" } },
    });
    const oneWordRecipient = await pluginBody();
    (oneWordRecipient.recipient as Record<string, unknown>).name = "Ярина";
    expect(
      (await call({ method: "POST", path: "/shipments", body: oneWordRecipient })).status,
    ).toBe(422);
    expect((await call({ method: "POST", path: "/shipments", body: {} })).status).toBe(422);
  });

  it("prints only with type=marking", async () => {
    const body = await pluginBody();
    const number = stub.shipments[0]?.number ?? "";
    expect(body.clientOrder).toBeTypeOf("string");
    const refused: RequestSpec["query"][] = [
      { numbers: [number] },
      { numbers: [number], type: ["marking"] },
      { numbers: [number], type: "invoice" },
    ];
    for (const query of refused) {
      expect(
        (await call({ method: "GET", path: "/shipments/print", query })).status,
        JSON.stringify(query),
      ).toBe(422);
    }
    expect(
      (
        await call({
          method: "GET",
          path: "/shipments/print",
          query: { numbers: [number], type: "marking" },
        })
      ).status,
    ).toBe(200);
  });

  it("honours countryCodes[] on settlements (lowercase or missing is 422, H09)", async () => {
    const refused: RequestSpec["query"][] = [
      { textSearch: "тест" },
      { countryCodes: ["ua"], textSearch: "тест" },
    ];
    for (const query of refused) {
      expect((await call({ method: "GET", path: "/settlements", query })).status).toBe(422);
    }
    expect(
      (
        await call({
          method: "GET",
          path: "/settlements",
          query: { countryCodes: ["UA"], textSearch: "тест" },
        })
      ).status,
    ).toBe(200);
  });
});
