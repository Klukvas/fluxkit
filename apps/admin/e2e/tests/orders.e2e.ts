import type { Page } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

async function search(page: Page, text: string, status: string): Promise<void> {
  const filters = page.getByRole("main").getByRole("form", { name: "Filter orders" });
  await filters.getByRole("combobox", { name: "Status" }).selectOption({ label: status });
  await filters.getByRole("searchbox", { name: "Order number or email" }).fill(text);
  await filters.getByRole("button", { name: "Apply" }).click();
}

test("orders: filter by status and q, detail, mark paid with a reference, fulfil; another order cancelled with a reason", async ({
  page,
  signIn,
  shopper,
}, testInfo) => {
  const u = unique(testInfo);
  const paidEmail = `e2e-buyer-${u}@example.com`;
  const cancelEmail = `e2e-canceller-${u}@example.com`;
  const toPay = await shopper.placeGuestOrder(paidEmail, "demo-screwdriver", "DEMO-SCREWDRIVER");
  const toCancel = await shopper.placeGuestOrder(
    cancelEmail,
    "demo-screwdriver",
    "DEMO-SCREWDRIVER",
  );
  expect(toPay.total).toEqual({ amount: 18900, currency: "UAH" });

  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/orders`);
  const list = main.getByRole("table", { name: "Orders, newest first" });

  // Status and number: exactly this order; the same number with another status: nothing.
  await search(page, toPay.number, "Awaiting payment");
  await expect(page).toHaveURL(/status=awaiting_payment/);
  await expect(list.getByRole("row")).toHaveCount(2);
  await expect(list.getByRole("link", { name: toPay.number })).toBeVisible();
  await search(page, toPay.number, "Paid");
  await expect(main.getByText("No order matches")).toBeVisible();
  // By email, any status.
  await search(page, paidEmail, "Any status");
  await expect(list.getByRole("row")).toHaveCount(2);
  await list.getByRole("link", { name: toPay.number }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${toPay.number}` }),
  ).toBeVisible();
  await expect(main).toContainText(paidEmail);
  await expect(main).toContainText("DEMO-SCREWDRIVER");
  await expect(main.getByText("Awaiting payment").first()).toBeVisible();

  // Mark paid: the amount is the total, read-only; reference and confirmation are required.
  await main.getByRole("button", { name: "Mark paid" }).click();
  const pay = page.getByRole("dialog", { name: `Mark order ${toPay.number} paid` });
  await expect(pay).toContainText("Amount received");
  await expect(pay).toContainText("189.00");
  await expect(pay.getByRole("textbox", { name: /Amount/ })).toHaveCount(0);
  await expect(pay.getByRole("spinbutton")).toHaveCount(0);
  const reference = `BANK-${u}`;
  await pay.getByRole("textbox", { name: "Payment reference" }).fill(reference);
  await pay.getByRole("checkbox", { name: /I received this amount/ }).check();
  // The answer is held back until the dialog has been tried with Escape (step 13 review, G15).
  let release: () => void = () => undefined;
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route("**/admin/orders/*/mark-paid", async (route) => {
    await held;
    await route.continue();
  });
  const paid = page.waitForRequest((request) => request.url().endsWith("/mark-paid"));
  await pay.getByRole("button", { name: "Mark paid" }).click();
  expect((await paid).postDataJSON()).toEqual({ reference, amount: toPay.total });
  // While the write runs the dialog cannot be closed: its buttons are disabled and Escape does nothing.
  await expect(pay.getByRole("button", { name: "Sending…" })).toBeDisabled();
  await expect(pay.getByRole("button", { name: "Close" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(pay).toBeVisible();
  await expect(pay.getByRole("textbox", { name: "Payment reference" })).toHaveValue(reference);
  const answered = page.waitForResponse((response) => response.url().endsWith("/mark-paid"));
  release();
  expect((await answered).status()).toBe(200);
  await page.unroute("**/admin/orders/*/mark-paid");
  await expect(
    main.getByText("The order is marked paid. The history below shows the change."),
  ).toBeVisible();
  await expect(pay).toBeHidden();
  await expect(main).toContainText(reference);
  const history = main.getByRole("table", { name: `Status history of order ${toPay.number}` });
  await expect(history).toContainText("Awaiting payment → Paid");

  // Fulfil.
  await main.getByRole("button", { name: "Mark fulfilled" }).click();
  const fulfil = page.getByRole("alertdialog", { name: `Mark order ${toPay.number} fulfilled` });
  await fulfil.getByRole("button", { name: "Mark fulfilled" }).click();
  await expect(
    main.getByText("The order is marked fulfilled. The history below shows the change."),
  ).toBeVisible();
  await expect(history).toContainText("Paid → Fulfilled");
  await expect(main.getByRole("button", { name: "Mark fulfilled" })).toHaveCount(0);
  await expect(main.getByRole("button", { name: "Cancel the order" })).toHaveCount(0);

  // The other order: cancelled with a reason.
  await page.goto(`${SPA}/orders`);
  await search(page, toCancel.number, "Awaiting payment");
  await list.getByRole("link", { name: toCancel.number }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Order ${toCancel.number}` }),
  ).toBeVisible();
  await main.getByRole("button", { name: "Cancel the order" }).click();
  const cancel = page.getByRole("alertdialog", { name: `Cancel order ${toCancel.number}` });
  await expect(cancel).toContainText(
    "The order's reserved stock is released, so the units can be sold again.",
  );
  const reason = `Customer asked by phone ${u}`;
  await cancel.getByRole("textbox", { name: "Reason" }).fill(reason);
  await cancel.getByRole("button", { name: "Cancel the order" }).click();
  await expect(
    main.getByText("The order is cancelled. The history below shows the change."),
  ).toBeVisible();
  const cancelledHistory = main.getByRole("table", {
    name: `Status history of order ${toCancel.number}`,
  });
  await expect(cancelledHistory).toContainText("Awaiting payment → Cancelled");
  await expect(cancelledHistory).toContainText(reason);

  // The list agrees with the detail.
  await page.goto(`${SPA}/orders`);
  await search(page, toCancel.number, "Cancelled");
  await expect(list.getByRole("link", { name: toCancel.number })).toBeVisible();
});
