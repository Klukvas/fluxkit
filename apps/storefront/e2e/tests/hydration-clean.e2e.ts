import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";

/**
 * The server and the browser render the same text on the main shopping pages, in every language (plan
 * docs/plans/2026-11-08-design-changeability.md, WP3 M2): the messages are merged from the area files and the fork's
 * overrides on the server, and the browser receives the picked subset of THAT result. A text that differs between the two
 * shows as a hydration error in the console. Same signal as `mobile-ux.e2e.ts` (`HYDRATION`), here on every console line,
 * not only errors, and on uncaught page errors.
 */

const HYDRATION = /hydrat|#418|#423|#425/i;

function collectConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on("console", (message) => lines.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => lines.push(`pageerror: ${error.message}`));
  return lines;
}

/** Waits until the header's cart badge read the cart: the islands are hydrated (both languages). */
async function hydrated(page: Page): Promise<void> {
  await expect(page.getByRole("banner").getByRole("link", { name: /Cart|Кошик/ })).toContainText(
    /in the cart|у кошику/,
  );
}

for (const locale of ["uk", "en"] as const) {
  test(`home, a product page, the catalog, the cart and the checkout hydrate without a mismatch (${locale})`, async ({
    page,
    shopper,
  }) => {
    // A cart with a line, so the cart and the checkout render their full forms rather than the empty state.
    const tee = await shopper.variantBySku("demo-t-shirt", "DEMO-T-SHIRT-BLACK-M");
    await shopper.addToCart(tee.id, 1);
    const lines = collectConsole(page);
    for (const path of ["", "/p/demo-hoodie", "/catalog", "/cart", "/checkout"]) {
      await page.goto(`/${locale}${path}`);
      await hydrated(page);
      await page.waitForLoadState("load");
      expect(
        lines.filter((line) => HYDRATION.test(line)),
        `/${locale}${path}`,
      ).toEqual([]);
    }
  });
}
