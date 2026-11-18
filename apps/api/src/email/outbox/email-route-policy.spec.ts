import { describe, expect, it } from "vitest";
import {
  assignedProvider,
  isEmailRoutePair,
  orderEmailProviders,
  parseEmailRouteMode,
} from "./email-route-policy.js";

const chain = [{ code: "resend" }, { code: "brevo" }];

describe("email route assignment", () => {
  it("gives odd turns to Resend and even turns to Brevo", () => {
    expect([1, 2, 3, 4].map(assignedProvider)).toEqual(["resend", "brevo", "resend", "brevo"]);
  });

  it("puts the assigned provider first and keeps the other behind it", () => {
    expect(orderEmailProviders(chain, "brevo").map((item) => item.code)).toEqual([
      "brevo",
      "resend",
    ]);
    expect(orderEmailProviders(chain, "resend")).toBe(chain);
    expect(orderEmailProviders(chain, null)).toBe(chain);
    expect(() => orderEmailProviders(chain, "testmail")).toThrow("email_route_assignment_unknown");
  });

  it("recognizes only the Resend and Brevo pair and refuses any other stored mode", () => {
    expect(isEmailRoutePair(["resend", "brevo"])).toBe(true);
    expect(isEmailRoutePair(["brevo", "resend", "fake"])).toBe(true);
    expect(isEmailRoutePair(["resend"])).toBe(false);
    expect(isEmailRoutePair(["fake", "fake_fallback"])).toBe(false);
    expect(parseEmailRouteMode("equal")).toBe("equal");
    expect(parseEmailRouteMode("resend")).toBe("resend");
    expect(() => parseEmailRouteMode(undefined)).toThrow("email_route_mode_invalid");
    expect(() => parseEmailRouteMode("both")).toThrow("email_route_mode_invalid");
  });
});
