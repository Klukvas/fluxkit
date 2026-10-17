import { describe, expect, it } from "vitest";
import * as core from "../index.js";
import { ORDER_READ_PORT, type OrderReadPort } from "./read-port.js";

describe("the order read port contract", () => {
  it("has the token plugins inject, distinct from the payment port's", () => {
    expect(ORDER_READ_PORT).toBe("fluxkit:order-read-port");
    expect(ORDER_READ_PORT).not.toBe(core.ORDER_PAYMENTS_PORT);
  });

  it("is exported from the package entry point", () => {
    expect(core.ORDER_READ_PORT).toBe(ORDER_READ_PORT);
  });

  it("can be implemented by a plain object (a plugin test double): reads only, one method", async () => {
    const port: OrderReadPort = { getOrder: () => Promise.resolve(undefined) };
    expect(await port.getOrder("00000000-0000-4000-8000-000000000001")).toBeUndefined();
    expect(Object.keys(port)).toEqual(["getOrder"]);
  });
});
