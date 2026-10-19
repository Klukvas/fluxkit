import { describe, expect, it } from "vitest";
import { availabilityDisplay, canAddToCart } from "./availability";

describe("availabilityDisplay", () => {
  it("maps each API status to a message key and a badge variant, never to a quantity", () => {
    expect(availabilityDisplay("in_stock")).toEqual({
      messageKey: "availability.in_stock",
      variant: "success",
    });
    expect(availabilityDisplay("low_stock")).toEqual({
      messageKey: "availability.low_stock",
      variant: "warning",
    });
    expect(availabilityDisplay("out_of_stock")).toEqual({
      messageKey: "availability.out_of_stock",
      variant: "danger",
    });
  });
});

describe("canAddToCart", () => {
  it("allows in stock and low stock, and not out of stock (a backorder variant reports in_stock)", () => {
    expect(canAddToCart("in_stock")).toBe(true);
    expect(canAddToCart("low_stock")).toBe(true);
    expect(canAddToCart("out_of_stock")).toBe(false);
  });
});
