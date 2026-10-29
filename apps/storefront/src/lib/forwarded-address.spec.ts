import { describe, expect, it } from "vitest";
import { forwardableAddresses } from "./forwarded-address";

describe("forwardableAddresses (the X-Forwarded-For of a page request, passed on to the API)", () => {
  it("passes on what the edge proxy wrote, address by address", () => {
    expect(forwardableAddresses("203.0.113.5")).toBe("203.0.113.5");
    expect(forwardableAddresses(" 203.0.113.5 ,  198.51.100.7 ")).toBe("203.0.113.5, 198.51.100.7");
    expect(forwardableAddresses("2001:db8::1")).toBe("2001:db8::1");
  });

  it("passes on nothing when there is no header", () => {
    expect(forwardableAddresses(null)).toBeNull();
    expect(forwardableAddresses("")).toBeNull();
    expect(forwardableAddresses("   ")).toBeNull();
  });

  it.each([
    "unknown",
    "203.0.113.5:8080",
    "203.0.113.5; evil",
    "203.0.113.999",
    "203.0.113.5, ",
    "203.0.113.5,,198.51.100.7",
    "<script>",
    "203.0.113.5\r\nX-Injected: 1",
  ])("passes on nothing for %j, so a bad header never becomes the shopper's address", (header) => {
    expect(forwardableAddresses(header)).toBeNull();
  });

  it("passes on nothing for a chain longer than the 10 hops TRUST_PROXY allows", () => {
    const chain = Array.from({ length: 11 }, (_, index) => `203.0.113.${String(index + 1)}`);
    expect(forwardableAddresses(chain.join(", "))).toBeNull();
    expect(forwardableAddresses(chain.slice(0, 10).join(", "))).toBe(chain.slice(0, 10).join(", "));
  });
});
