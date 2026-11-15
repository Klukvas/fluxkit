import type { Cart } from "@fluxkit/api-client";
import { createTranslator, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatMoney } from "../lib/money";
import { messagesByLocale } from "../messages";
import { FreeShippingProgress } from "./free-shipping-progress";

const money = (amount: number) => ({ amount, currency: "UAH" });
function render(freeShipping: Cart["freeShipping"], subtotal = 1234, locale: Locale = "en") {
  return renderToStaticMarkup(
    <FreeShippingProgress
      freeShipping={freeShipping}
      subtotal={money(subtotal)}
      t={createTranslator(messagesByLocale[locale], locale)}
      locale={locale}
      exponent={2}
    />,
  );
}

describe("FreeShippingProgress", () => {
  it.each(["en", "uk"] as const)(
    "formats the server remainder in %s and labels native progress",
    (locale) => {
      // Deliberately distinct server numbers: the view must not derive the remainder.
      const html = render({ threshold: money(5000), remaining: money(987) }, 1234, locale);
      const amount = formatMoney(money(987), 2, locale);
      expect(html).toContain(
        locale === "en"
          ? `${amount} more for free delivery`
          : `Ще ${amount} до безкоштовної доставки`,
      );
      expect(html).toContain('value="1234"');
      expect(html).toContain('max="5000"');
      const labelId = /<p id="([^"]+)"/.exec(html)?.[1];
      expect(labelId).toBeDefined();
      expect(html).toContain(`aria-labelledby="${labelId}"`);
      expect(html).toContain("tabular-nums");
      expect(html).toContain('class="fk-progress w-full rounded-control"');
      expect(html).not.toContain("style=");
    },
  );
  it.each(["en", "uk"] as const)(
    "shows the server reached state in %s and lets native progress clamp",
    (locale) => {
      const html = render({ threshold: money(1000), remaining: money(0) }, 1234, locale);
      expect(html).toContain(locale === "en" ? "Free delivery unlocked" : "Доставка безкоштовна");
      expect(html).toContain('value="1234"');
      expect(html).toContain('max="1000"');
      expect(html).not.toContain("more for free delivery");
    },
  );
  it("shows a zero threshold as reached without an invalid progress max", () => {
    const html = render({ threshold: money(0), remaining: money(0) });
    expect(html).toContain("Free delivery unlocked");
    expect(html).not.toContain("<progress");
  });
  it("renders nothing for null", () => {
    expect(render(null)).toBe("");
  });
});
