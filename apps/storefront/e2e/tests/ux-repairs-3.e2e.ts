import { expect, test } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

/**
 * UX repairs, batch 3A (plan `docs/plans/2026-11-06-ux-repairs-3-storefront.md`), from the second round of the simulated
 * shopper's review: the cart's delivery note, the order page of a closed order, the focus after the last cart line goes, the
 * product page before hydration and its chosen options. Each test uses its own product or order.
 */

test("the cart says under its total that delivery is calculated at checkout (item 1), in both languages", async ({
  page,
  shopper,
}) => {
  const screwdriver = await shopper.variantBySku("demo-screwdriver", "DEMO-SCREWDRIVER");
  await shopper.addToCart(screwdriver.id, 1);

  await page.goto("/en/cart");
  await waitForHydration(page);
  await expect(page.getByText("Delivery is calculated at checkout", { exact: true })).toBeVisible();
  await page.goto("/uk/cart");
  await expect(
    page.getByText("Доставка розраховується при оформленні замовлення", { exact: true }),
  ).toBeVisible();
});
