import { describe, expect, it } from "vitest";
import { customerOrdersHref as ordersAreaCustomerOrdersHref } from "../orders/order-view";
import {
  CUSTOMER_STATUS_TONES,
  customerHref,
  customerOrdersHref,
  fullName,
  lockLabelKey,
  statusLabelKey,
} from "./customer-view";

const ID = "33333333-3333-4333-8333-333333333333";

describe("customer presentation", () => {
  it("says the status in words and with a tone", () => {
    expect(statusLabelKey(true)).toBe("customer.status.active");
    expect(statusLabelKey(false)).toBe("customer.status.deactivated");
    expect(CUSTOMER_STATUS_TONES.active).not.toBe(CUSTOMER_STATUS_TONES.deactivated);
    expect(lockLabelKey(true)).toBe("customer.lock.locked");
    expect(lockLabelKey(false)).toBe("customer.lock.notLocked");
  });

  it("joins the first and last name, skipping a missing part, as plain text", () => {
    expect(fullName("Olena", "Shevchenko")).toBe("Olena Shevchenko");
    expect(fullName("Olena", "")).toBe("Olena");
    expect(fullName("", " Shevchenko ")).toBe("Shevchenko");
    expect(fullName("", "")).toBe("");
    expect(fullName("<b>Olena</b>", "x")).toBe("<b>Olena</b> x");
  });

  it("links a customer's detail by id only, one encoded segment", () => {
    expect(customerHref(ID)).toBe(`/customers/${ID}`);
    expect(customerHref("a/b")).toBe("/customers/a%2Fb");
  });

  it("links the customer's orders through the customerId filter the orders list reads", () => {
    expect(customerOrdersHref(ID)).toBe(`/orders?customerId=${ID}`);
    expect(customerOrdersHref(ID)).toBe(ordersAreaCustomerOrdersHref(ID));
  });
});
