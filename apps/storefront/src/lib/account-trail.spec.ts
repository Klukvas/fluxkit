import { describe, expect, it } from "vitest";
import { accountTrail } from "./account-trail";

describe("accountTrail (breadcrumbs of the account pages)", () => {
  it("is Home / My account on the overview, the overview being the current page", () => {
    expect(accountTrail("/account")).toEqual([
      { labelKey: "breadcrumbs.home", href: "/" },
      { labelKey: "nav.account.overview" },
    ]);
    expect(accountTrail("/account/")).toEqual(accountTrail("/account"));
  });

  it("names the section of a section page, linking back to the overview", () => {
    expect(accountTrail("/account/orders")).toEqual([
      { labelKey: "breadcrumbs.home", href: "/" },
      { labelKey: "nav.account.overview", href: "/account" },
      { labelKey: "nav.account.orders" },
    ]);
    expect(accountTrail("/account/profile").at(-1)).toEqual({ labelKey: "nav.account.profile" });
    expect(accountTrail("/account/data").at(-1)).toEqual({ labelKey: "nav.account.privacy" });
  });

  it("ends with the order number on an order page, the orders list linked", () => {
    expect(accountTrail("/account/orders/GCAD-8X10")).toEqual([
      { labelKey: "breadcrumbs.home", href: "/" },
      { labelKey: "nav.account.overview", href: "/account" },
      { labelKey: "nav.account.orders", href: "/account/orders" },
      { label: "GCAD-8X10" },
    ]);
  });

  it("never shows a path segment that is not an order number", () => {
    expect(accountTrail("/account/orders/%3Cscript%3E").at(-1)).toEqual({
      labelKey: "nav.account.orders",
    });
    expect(accountTrail("/account/orders/%E0%A4%A").at(-1)).toEqual({
      labelKey: "nav.account.orders",
    });
  });

  it("answers nothing for a path that is not an account section", () => {
    expect(accountTrail("/cart")).toEqual([]);
    expect(accountTrail("/account/login")).toEqual([]);
    expect(accountTrail("/accounting")).toEqual([]);
  });
});
