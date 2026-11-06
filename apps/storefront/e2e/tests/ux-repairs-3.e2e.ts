import { randomUUID } from "node:crypto";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
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

/** The payment block's words (`payment.*`): the heading, every action and the expired attempt's text. */
const PAYMENT_WORDS = {
  en: {
    heading: "Payment",
    actions: /^(Pay now|Pay again|Continue payment|Check payment status)$/,
    expired: "The payment link expired",
    cancelled: "Cancelled",
  },
  uk: {
    heading: "Оплата",
    actions: /^(Оплатити зараз|Оплатити ще раз|Продовжити оплату|Перевірити статус оплати)$/,
    expired: "Посилання на оплату втратило чинність",
    cancelled: "Скасовано",
  },
} as const;

test("a cancelled order's page shows no payment block and no pay action, although the order had an attempt (item 4)", async ({
  page,
  shopper,
}, testInfo) => {
  // A digital product: no delivery method or address is needed, whatever another file activated.
  const ebook = await shopper.variantBySku("demo-e-book", "DEMO-E-BOOK");
  await shopper.addToCart(ebook.id, 1);
  const order = await shopper.checkout({
    email: uniqueEmail(testInfo, "cancelled-pay"),
    idempotencyKey: randomUUID(),
    shipping: false,
  });
  // The shopper started a payment and left it on the provider's page; then the order is cancelled.
  const payment = await shopper.startGuestPayment(order, randomUUID());
  expect(payment.status).toBe("waiting");
  await shopper.cancelGuestOrder(order);

  for (const locale of ["en", "uk"] as const) {
    const words = PAYMENT_WORDS[locale];
    await page.goto(`/${locale}/order/${order.number}#t=${order.accessToken ?? ""}`);
    const main = page.getByRole("main");
    await expect(main.getByText(words.cancelled, { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("heading", { name: words.heading, exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: words.actions })).toHaveCount(0);
    await expect(main.getByRole("link", { name: words.actions })).toHaveCount(0);
    await expect(main).not.toContainText(words.expired);
  }
});

test("removing the last cart line by keyboard moves the focus to the cart heading, and the removal is still announced (item 5)", async ({
  page,
  shopper,
}) => {
  // A digital product without stock: no other file can sell it out.
  const pack = (await shopper.product("demo-template-pack")).variants[0];
  if (pack === undefined) throw new Error("The seed has no variant for demo-template-pack.");
  await shopper.addToCart(pack.id, 1);
  await page.goto("/en/cart");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Remove Demo Template Pack" }).focus();
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 2, name: "Your cart is empty" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "Item removed." })).toContainText(
    "Items in the cart: 0.",
  );
  // The next Tab goes on from the heading into the page (the empty state's link), not from the top of the document.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Browse the catalog" })).toBeFocused();
});
