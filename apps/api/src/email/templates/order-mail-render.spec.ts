import { describe, expect, it } from "vitest";
import { emailTheme } from "@fluxkit/theme";
import { OrderCancelledEmailTemplate } from "./order-cancelled.template.js";
import { OrderExpiredEmailTemplate } from "./order-expired.template.js";
import { OrderPaidEmailTemplate } from "./order-paid.template.js";
import { OrderPlacedEmailTemplate } from "./order-placed.template.js";
import { ShipmentCreatedEmailTemplate } from "./shipment-created.template.js";
import { renderEmail, type RegisteredEmailTemplate } from "./email-renderer.js";
import { EMAIL_THEME } from "./email-theme.js";
import {
  boundedOrderMailText,
  ORDER_MAIL_MAX_LINES,
  ORDER_MAIL_TEXT_MAX_CODE_POINTS,
  ORDER_PLACED_SAMPLE,
  type OrderPlacedVariables,
} from "./order-mail-variables.js";

type Provider = { template: unknown; catalogs: RegisteredEmailTemplate["catalogs"] };
const entryOf = (provider: Provider): RegisteredEmailTemplate => ({
  template: provider.template as RegisteredEmailTemplate["template"],
  catalogs: provider.catalogs,
  source: "spec",
});

const placed = entryOf(new OrderPlacedEmailTemplate());
const paid = entryOf(new OrderPaidEmailTemplate());
const cancelled = entryOf(new OrderCancelledEmailTemplate());
const expired = entryOf(new OrderExpiredEmailTemplate());
const shipped = entryOf(new ShipmentCreatedEmailTemplate());

const LINK = "https://shop.example.com/uk/order/7K3M-9QX2#t=TOKEN";
const options = (
  locale: string,
  action: string | null = LINK,
  shopName: string | null = "Shop",
) => ({
  locale,
  defaultLocale: "uk",
  theme: EMAIL_THEME,
  links: { storefront: `https://shop.example.com/${locale}`, action },
  shopName,
});

function placedWith(overrides: Partial<OrderPlacedVariables>): OrderPlacedVariables {
  return { ...ORDER_PLACED_SAMPLE, ...overrides };
}

describe("order.placed rendering (plan 6.3)", () => {
  it("prints the number, the lines, the totals from minor units, the delivery, the deadline and the link, in uk and en", () => {
    for (const locale of ["uk", "en"]) {
      const mail = renderEmail(placed, ORDER_PLACED_SAMPLE, options(locale));
      for (const part of [mail.html, mail.text]) {
        expect(part).toContain("7K3M-9QX2");
        expect(part).toContain("Sample product");
        expect(part).toContain("Sample variant");
        expect(part).toContain("2000.00 UAH");
        expect(part).toContain("2500.00 UAH");
        expect(part).toContain("80.00 UAH");
        expect(part).toContain("100.00 UAH");
        expect(part).toContain("2480.00 UAH");
        expect(part).toContain("Sample pickup point, sample street 1");
        expect(part).toContain("2030-01-01 12:00 UTC");
        expect(part).toContain(LINK);
      }
      expect(mail.html).toContain(`href="${LINK}"`);
      expect(mail.subject).toContain("7K3M-9QX2");
      expect(mail.category).toBe("order");
    }
    const uk = renderEmail(placed, ORDER_PLACED_SAMPLE, options("uk"));
    const en = renderEmail(placed, ORDER_PLACED_SAMPLE, options("en"));
    expect(uk.subject).toBe("Замовлення 7K3M-9QX2 прийнято — Shop");
    expect(en.subject).toBe("Order 7K3M-9QX2 accepted at Shop");
    expect(uk.text).toContain("Разом: 2480.00 UAH");
    expect(en.text).toContain("Total: 2480.00 UAH");
  });

  it.each([
    ["JPY", 1_500, "1500 JPY"],
    ["KWD", 12_345, "12.345 KWD"],
    ["UAH", 5, "0.05 UAH"],
  ])(
    "formats %s at render time with the currency's exponent (no hardcoded symbol)",
    (currency, amount, text) => {
      const variables = placedWith({
        currency,
        lines: [{ title: "Thing", variantTitle: null, quantity: 1, lineTotal: amount }],
        subtotal: amount,
        shipping: 0,
        discount: 0,
        total: amount,
      });
      const mail = renderEmail(placed, variables, options("en"));
      expect(mail.text).toContain(`Total: ${text}`);
      expect(mail.html).toContain(text);
      expect(mail.html).not.toMatch(/[₴$€£¥]/);
    },
  );

  it("leaves out the discount row when there is none, the deadline once the order is not awaiting payment, and the link when the source made none", () => {
    const mail = renderEmail(
      placed,
      placedWith({ discount: 0, payBefore: null }),
      options("en", null),
    );
    expect(mail.text).not.toContain("Discount");
    expect(mail.text).not.toContain("waiting for payment");
    expect(mail.text).not.toContain("View your order");
    expect(mail.html).not.toContain('<a href="https://shop.example.com/uk/order');
  });

  it("names a delivery city for an address method and the count of lines it does not list", () => {
    const mail = renderEmail(
      placed,
      placedWith({
        delivery: { methodTitle: "Courier", pickupPoint: null, city: "Lviv" },
        moreLines: 3,
      }),
      options("en"),
    );
    expect(mail.text).toContain("Method: Courier");
    expect(mail.text).toContain("Delivery city: Lviv");
    expect(mail.text).toContain("More lines in your order: 3");
  });

  it("prints no section for an order without a shipping method", () => {
    const mail = renderEmail(
      placed,
      placedWith({ delivery: { methodTitle: null, pickupPoint: null, city: null } }),
      options("en"),
    );
    expect(mail.text).not.toContain("Delivery\n");
  });

  it("escapes hostile titles, a hostile shop name and keeps the subject header-safe", () => {
    const hostile = `<img src=x onerror=alert(1)>"&\r\nBcc: evil@example.org`;
    const mail = renderEmail(
      placed,
      placedWith({
        lines: [{ title: hostile, variantTitle: hostile, quantity: 1, lineTotal: 100 }],
        delivery: {
          methodTitle: hostile,
          pickupPoint: { number: hostile, city: hostile, description: hostile },
          city: null,
        },
      }),
      options("en", LINK, hostile),
    );
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&amp;");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.text.trim().length).toBeGreaterThan(0);
  });

  it("is deterministic and styled from the email theme only", () => {
    const first = renderEmail(placed, ORDER_PLACED_SAMPLE, options("uk"));
    expect(renderEmail(placed, ORDER_PLACED_SAMPLE, options("uk"))).toEqual(first);
    const colors = new Set(first.html.match(/#[0-9a-fA-F]{3,8}\b/g));
    expect([...colors].every((color) => Object.values(emailTheme.color).includes(color))).toBe(
      true,
    );
    expect(first.html).not.toMatch(/<(script|img|link|style|iframe)\b/);
  });

  it("refuses variables outside the schema or money no currency can print (variables_invalid, render_failed)", () => {
    expect(() =>
      renderEmail(placed, { ...ORDER_PLACED_SAMPLE, total: 1.5 }, options("en")),
    ).toThrow(expect.objectContaining({ code: "variables_invalid" }));
    expect(() =>
      renderEmail(placed, { ...ORDER_PLACED_SAMPLE, currency: "RUB" }, options("en")),
    ).toThrow(expect.objectContaining({ code: "variables_invalid" }));
    expect(() =>
      renderEmail(placed, { ...ORDER_PLACED_SAMPLE, extra: "x" }, options("en")),
    ).toThrow(expect.objectContaining({ code: "variables_invalid" }));
    expect(() =>
      renderEmail(placed, { ...ORDER_PLACED_SAMPLE, payBefore: "tomorrow" }, options("en")),
    ).toThrow(expect.objectContaining({ code: "variables_invalid" }));
  });
});

describe("the other order mails", () => {
  it("order.paid prints the number and the total formatted from minor units, with the link", () => {
    const variables = { orderNumber: "7K3M-9QX2", currency: "KWD", total: 12_345 };
    const en = renderEmail(paid, variables, options("en"));
    expect(en.text).toContain("12.345 KWD");
    expect(en.text).toContain("7K3M-9QX2");
    expect(en.text).toContain(LINK);
    expect(en.subject).toBe("Payment for order 7K3M-9QX2 received");
    const uk = renderEmail(paid, variables, options("uk"));
    expect(uk.subject).toBe("Оплату замовлення 7K3M-9QX2 отримано");
    expect(uk.html).toContain("12.345 KWD");
  });

  it.each([
    ["order.cancelled", cancelled, "Order 7K3M-9QX2 cancelled", "Замовлення 7K3M-9QX2 скасовано"],
    ["order.expired", expired, "Order 7K3M-9QX2 expired", "Замовлення 7K3M-9QX2 втратило чинність"],
  ])("%s has the number, no link and no button", (_key, entry, en, uk) => {
    const variables = { orderNumber: "7K3M-9QX2" };
    const english = renderEmail(entry, variables, options("en", null));
    expect(english.subject).toBe(en);
    expect(english.text).toContain("7K3M-9QX2");
    expect(english.html).not.toContain("#t=");
    expect(renderEmail(entry, variables, options("uk", null)).subject).toBe(uk);
    // Never a link of its own, even when the context carries one.
    expect(renderEmail(entry, variables, options("en")).text).not.toContain("#t=");
  });

  it("shipment.created prints the tracking number and the carrier, or just the tracking number", () => {
    const variables = {
      orderNumber: "7K3M-9QX2",
      carrierTitle: "Sample carrier",
      trackingNumber: "20450000000000",
    };
    const mail = renderEmail(shipped, variables, options("en"));
    expect(mail.text).toContain("Tracking number: 20450000000000");
    expect(mail.text).toContain("Sample carrier");
    expect(mail.text).toContain(LINK);
    const bare = renderEmail(shipped, { ...variables, carrierTitle: null }, options("uk"));
    expect(bare.text).toContain("Номер відстеження: 20450000000000");
    expect(bare.text).not.toContain("Sample carrier");
    expect(() =>
      renderEmail(shipped, { ...variables, trackingNumber: "<b>x</b>" }, options("en")),
    ).toThrow(expect.objectContaining({ code: "variables_invalid" }));
  });
});

describe("the variables of order.placed stay small", () => {
  it("cuts a text at the bound by code points, never inside a surrogate pair", () => {
    const long = "😀".repeat(ORDER_MAIL_TEXT_MAX_CODE_POINTS + 5);
    const cut = boundedOrderMailText(long);
    expect([...cut]).toHaveLength(ORDER_MAIL_TEXT_MAX_CODE_POINTS + 1);
    expect(cut.endsWith("…")).toBe(true);
    expect(boundedOrderMailText("short")).toBe("short");
  });

  it("fits the 16 KiB cap with the most lines of the longest four-byte texts", () => {
    const text = boundedOrderMailText("😀".repeat(500));
    const worst = placedWith({
      lines: Array.from({ length: ORDER_MAIL_MAX_LINES }, () => ({
        title: text,
        variantTitle: text,
        quantity: 999,
        lineTotal: 1_000_000_000_000,
      })),
      moreLines: 88,
      delivery: {
        methodTitle: text,
        pickupPoint: { number: text, city: text, description: text },
        city: null,
      },
    });
    const parsed = placed.template.variablesSchema.safeParse(worst);
    expect(parsed.success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(worst), "utf8")).toBeLessThanOrEqual(16 * 1024);
  });
});
