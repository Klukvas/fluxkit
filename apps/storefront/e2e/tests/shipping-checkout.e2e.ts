import type { Page, Request } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import {
  fillCheckoutForm,
  fillContactDetails,
  orderNumberOnPage,
  rowValue,
  tokenOf,
  uah,
} from "../support/flows.ts";

/*
 * The delivery step against the real stack (shipping plan step 10): a flat-rate courier, a pickup point of the fake provider
 * chosen with the keyboard, a store pickup, and a delivery price changed behind the shopper's back. The shop has no shipping
 * method by default (every other scenario relies on that); each test creates its own and the hook below deactivates them.
 */

test.afterEach(async ({ admin }) => {
  await admin.deactivateShippingMethods();
});

const SKU = { slug: "demo-hoodie", black: "DEMO-HOODIE-BLACK-M" } as const;

function summaryOf(page: Page) {
  return page.getByRole("region", { name: "Your order" });
}

/** The JSON body of a checkout request, for what the browser really sent. */
function bodyOf(request: Request): { expectedTotal: { amount: number }; shipping?: unknown } {
  return JSON.parse(request.postData() ?? "{}") as never;
}

test("a flat-rate courier order: the total on the page is the total of the order, and the order page shows the delivery", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  await admin.createShippingMethod({
    code: `courier_${String(testInfo.retry)}`,
    title: "Courier",
    kind: "address",
    pricing: { type: "flat", amount: 5000 },
  });
  const hoodie = await shopper.variantBySku(SKU.slug, SKU.black);
  await shopper.addToCart(hoodie.id, 1);
  const expectedTotal = hoodie.price.amount + 5000;

  await page.goto("/en/checkout");
  const delivery = page.getByRole("group", { name: "Delivery" });
  // The only method is chosen already, with its price, and the address is asked for.
  await expect(delivery.getByRole("radio", { name: /Courier/ })).toBeChecked();
  await expect(delivery.getByText(uah(5000))).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shipping address" })).toBeVisible();

  const summary = summaryOf(page);
  await expect(rowValue(summary, "Subtotal")).toHaveText(uah(hoodie.price.amount));
  await expect(rowValue(summary, "Delivery")).toHaveText(uah(5000));
  await expect(rowValue(summary, "Total")).toHaveText(uah(expectedTotal));

  const email = uniqueEmail(testInfo, "courier");
  await fillCheckoutForm(page, { email });
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/store/checkout")) {
      posts.push(request);
    }
  });
  await page.getByRole("button", { name: "Place the order" }).click();

  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  await orderNumberOnPage(page);
  // The browser sent the server's total of the option, with the method and the address.
  expect(posts).toHaveLength(1);
  const sent = bodyOf(posts[0] as Request);
  expect(sent.expectedTotal.amount).toBe(expectedTotal);
  expect(sent.shipping).toEqual({ methodCode: `courier_${String(testInfo.retry)}` });

  const totals = page.getByRole("region", { name: "Totals" });
  await expect(rowValue(totals, "Shipping")).toHaveText(uah(5000));
  await expect(rowValue(totals, "Total")).toHaveText(uah(expectedTotal));
  const deliverySection = page.getByRole("region", { name: "Delivery" });
  await expect(deliverySection).toContainText("Courier");
  await expect(deliverySection).toContainText(uah(5000));
  await expect(page.getByRole("heading", { name: "Shipping address" })).toBeVisible();
  // What the displayed total promised is what the shop stored.
  const stored = await admin.orderOf(email);
  expect(stored.total.amount).toBe(expectedTotal);
});

test("a pickup point of the fake provider chosen with the keyboard, an order without an address, and the waybill's tracking on the order page", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  await admin.createShippingMethod({
    code: `branch_${String(testInfo.retry)}`,
    title: "Pickup point",
    kind: "pickup_point",
    providerCode: "fake",
    pricing: { type: "flat", amount: 4500 },
  });
  const hoodie = await shopper.variantBySku(SKU.slug, "DEMO-HOODIE-BLACK-L");
  await shopper.addToCart(hoodie.id, 1);
  const expectedTotal = hoodie.price.amount + 4500;

  const lookups: string[] = [];
  const hosts = new Set<string>();
  page.on("request", (request) => {
    if (request.url().startsWith("http")) hosts.add(new URL(request.url()).origin);
    if (request.url().includes("/store/shipping/providers/")) lookups.push(request.url());
  });

  const email = uniqueEmail(testInfo, "pickup");
  await page.goto("/en/checkout");
  await expect(page.getByRole("radio", { name: /Pickup point/ })).toBeChecked();
  // A pickup point has no address.
  await expect(page.getByRole("heading", { name: "Shipping address" })).toHaveCount(0);
  await fillContactDetails(page, { email });

  // City: type fast (one search after the pause, none for one character), then choose with the arrow keys and Enter.
  const city = page.getByRole("combobox", { name: "City" });
  await city.click();
  await city.pressSequentially("Kyiv");
  await expect(page.getByRole("option", { name: "Kyiv, Kyiv" })).toBeVisible();
  await expect(city).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("status").filter({ hasText: "1 result" })).toBeAttached();
  expect(lookups.filter((url) => url.includes("/cities"))).toHaveLength(1);
  expect(lookups.every((url) => !/[?&]q=.?(&|$)/.test(url))).toBe(true);
  await page.keyboard.press("ArrowDown");
  await expect(city).toHaveAttribute("aria-activedescendant", /option-0$/);
  await page.keyboard.press("Enter");
  await expect(city).toHaveValue("Kyiv, Kyiv");
  await expect(city).toHaveAttribute("aria-expanded", "false");

  // Branch or locker: Tab moves on (no trap), the list of the city is there, Escape closes it without choosing.
  await page.keyboard.press("Tab");
  const point = page.getByRole("combobox", { name: "Branch or parcel locker" });
  await expect(point).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(point).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(point).toHaveAttribute("aria-expanded", "false");
  await expect(point).toHaveValue("");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(point).toHaveAttribute("aria-activedescendant", /option-1$/);
  await page.keyboard.press("Enter");
  await expect(point).toHaveValue("Parcel locker 2: Fake locker 2, Kyiv");

  const summary = summaryOf(page);
  await expect(rowValue(summary, "Total")).toHaveText(uah(expectedTotal));
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/store/checkout")) {
      posts.push(request);
    }
  });
  await page.getByRole("button", { name: "Place the order" }).click();

  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  const link = page.url();
  await orderNumberOnPage(page);
  expect(posts).toHaveLength(1);
  const sent = bodyOf(posts[0] as Request) as Record<string, unknown>;
  expect(sent["shipping"]).toEqual({
    methodCode: `branch_${String(testInfo.retry)}`,
    pickupPointRef: "fake-city-kyiv-point-2",
  });
  // The API refuses an address with a pickup point: none was sent.
  expect(sent).not.toHaveProperty("shippingAddress");
  expect((sent["expectedTotal"] as { amount: number }).amount).toBe(expectedTotal);

  const deliverySection = page.getByRole("region", { name: "Delivery" });
  await expect(deliverySection).toContainText("Pickup point");
  await expect(deliverySection).toContainText("Parcel locker 2, Kyiv: Fake locker 2, Kyiv");
  await expect(page.getByRole("heading", { name: "Shipping address" })).toHaveCount(0);
  await expect(rowValue(page.getByRole("region", { name: "Totals" }), "Total")).toHaveText(
    uah(expectedTotal),
  );
  // No tracking before the shop created a waybill.
  await expect(page.getByRole("heading", { name: "Tracking" })).toHaveCount(0);

  // The browser talked to our origin only: never to a carrier.
  expect([...hosts]).toEqual([new URL(link).origin]);

  // The shop pays-marks the order and creates the waybill; the private link now shows the tracking.
  const stored = await admin.orderOf(email);
  expect(stored.total.amount).toBe(expectedTotal);
  await admin.markPaid(stored);
  const tracking = await admin.createShipment(stored.id);
  // A reload (the address is the same document with a fragment, a goto would not load it again).
  await page.reload();
  const trackingSection = page.getByRole("heading", { name: "Tracking" });
  await expect(trackingSection).toBeVisible();
  await expect(page.getByText(tracking, { exact: true })).toBeVisible();
  await expect(page.getByText("Waybill created", { exact: true })).toBeVisible();
  expect(tokenOf(link)).toMatch(/^[A-Za-z0-9_-]{16,}$/);
});

test("a store pickup needs no address and is free; the order page says Free", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  await admin.createShippingMethod({
    code: `store_${String(testInfo.retry)}`,
    title: "Pick up in the store",
    kind: "store_pickup",
    description: "Open 9 to 18 at 1 Example Street.",
    pricing: { type: "flat", amount: 0 },
  });
  const hoodie = await shopper.variantBySku(SKU.slug, "DEMO-HOODIE-BLUE-L");
  await shopper.addToCart(hoodie.id, 1);

  await page.goto("/en/checkout");
  await expect(page.getByRole("radio", { name: /Pick up in the store/ })).toBeChecked();
  await expect(page.getByText("Open 9 to 18 at 1 Example Street.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shipping address" })).toHaveCount(0);
  const summary = summaryOf(page);
  await expect(rowValue(summary, "Delivery")).toHaveText("Free");
  await expect(rowValue(summary, "Total")).toHaveText(uah(hoodie.price.amount));

  await fillContactDetails(page, { email: uniqueEmail(testInfo, "store") });
  await page.getByRole("button", { name: "Place the order" }).click();
  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  await orderNumberOnPage(page);
  await expect(rowValue(page.getByRole("region", { name: "Totals" }), "Shipping")).toHaveText(
    "Free",
  );
  await expect(page.getByRole("region", { name: "Delivery" })).toContainText(
    "Pick up in the store",
  );
});

test("a delivery price changed behind the shopper's back is shown and agreed to again; nothing is resubmitted by itself", async ({
  page,
  shopper,
  admin,
}, testInfo) => {
  const method = await admin.createShippingMethod({
    code: `change_${String(testInfo.retry)}`,
    title: "Courier",
    kind: "address",
    pricing: { type: "flat", amount: 5000 },
  });
  const hoodie = await shopper.variantBySku(SKU.slug, "DEMO-HOODIE-BLACK-S");
  await shopper.addToCart(hoodie.id, 1);
  const oldTotal = hoodie.price.amount + 5000;
  const newTotal = hoodie.price.amount + 6000;

  const posts: Request[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/store/checkout")) {
      posts.push(request);
    }
  });
  const email = uniqueEmail(testInfo, "changed");
  await page.goto("/en/checkout");
  await fillCheckoutForm(page, { email });
  const summary = summaryOf(page);
  await expect(rowValue(summary, "Total")).toHaveText(uah(oldTotal));
  const place = page.getByRole("button", { name: "Place the order" });
  await expect(place).toBeEnabled();

  await admin.repriceShippingMethod(method.id, { type: "flat", amount: 6000 });
  await place.click();

  // 409 shipping_changed: the options are read again, the new price and total are shown, the submit waits for the shopper.
  await expect(page.getByText("The delivery price has changed", { exact: true })).toBeVisible();
  await expect(rowValue(summary, "Total")).toHaveText(uah(newTotal));
  await expect(rowValue(summary, "Delivery")).toHaveText(uah(6000));
  await expect(summary).toContainText(uah(oldTotal));
  await expect(place).toBeDisabled();
  await expect(
    page.getByText("The delivery price has changed. Check it and confirm to continue."),
  ).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(bodyOf(posts[0] as Request).expectedTotal.amount).toBe(oldTotal);

  await page.getByRole("button", { name: "I agree to the new price" }).click();
  await expect(place).toBeEnabled();
  expect(posts).toHaveLength(1);
  await place.click();

  await expect(page).toHaveURL(/\/en\/order\/[^#?]+#t=/);
  await orderNumberOnPage(page);
  expect(posts).toHaveLength(2);
  expect(bodyOf(posts[1] as Request).expectedTotal.amount).toBe(newTotal);
  // A changed total is a new attempt: a new idempotency key.
  expect(posts[1]?.headers()["idempotency-key"]).not.toBe(posts[0]?.headers()["idempotency-key"]);
  await expect(rowValue(page.getByRole("region", { name: "Totals" }), "Total")).toHaveText(
    uah(newTotal),
  );
  const stored = await admin.orderOf(email);
  expect(stored.total.amount).toBe(newTotal);
});
