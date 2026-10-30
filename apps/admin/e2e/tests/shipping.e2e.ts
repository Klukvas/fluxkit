import { readFileSync } from "node:fs";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import { delayAnimationFrames } from "../support/late-frames.ts";

/**
 * Shipping (plan step 11). The API of this suite runs with `SHIPPING_PROVIDERS_ENABLED=fake` (the test-only carrier of the
 * template). While a delivery method is ACTIVE every checkout of goods must name one, so a scenario that activates a method
 * switches every method off again at its end (also when it fails): the other scenarios place plain orders.
 */

test("shipping methods: create and activate a flat method, edit it, a method in use cannot be deleted", async ({
  page,
  signIn,
  owner,
  shopper,
}, testInfo) => {
  const u = unique(testInfo);
  const code = `flat_${u}`;
  const unusedCode = `unused_${u}`;
  try {
    await signIn("manager");
    const nav = page.getByRole("navigation", { name: "Admin sections" });
    await nav.getByRole("link", { name: "Shipping" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Shipping" })).toBeVisible();
    const main = page.getByRole("main");
    await main.getByRole("link", { name: "New delivery method" }).first().click();
    await expect(
      page.getByRole("heading", { level: 1, name: "New delivery method" }),
    ).toBeVisible();

    // Create: the price is typed as a decimal and sent in minor units; the countries are upper-cased.
    await main.getByRole("textbox", { name: "Code", exact: true }).fill(code);
    await main.getByRole("textbox", { name: "Title (Ukrainian)" }).fill(`Кур'єр ${u}`);
    await main.getByRole("textbox", { name: "Title (English)" }).fill(`Courier ${u}`);
    await main.getByRole("textbox", { name: "Carrier code" }).fill("fake");
    await main.getByRole("textbox", { name: "Countries" }).fill("ua");
    await main.getByRole("textbox", { name: "Price, UAH" }).fill("80.50");
    await main.getByRole("checkbox", { name: "Active (offered at checkout)" }).check();
    const created = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/admin/shipping/methods"),
    );
    await main.getByRole("button", { name: "Create method" }).click();
    expect((await created).postDataJSON()).toEqual({
      code,
      title: { uk: `Кур'єр ${u}`, en: `Courier ${u}` },
      kind: "address",
      providerCode: "fake",
      pricing: { type: "flat", amount: 8050 },
      countryCodes: ["UA"],
      isActive: true,
    });
    await expect(main.getByText(`The delivery method “Courier ${u}” was created.`)).toBeVisible();
    await main.getByRole("link", { name: "Open the method" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Courier ${u}` })).toBeVisible();
    await expect(main.getByText("Active", { exact: true }).first()).toBeVisible();

    // The code is shown but never editable; the price comes back as the decimal that was typed.
    await expect(main.getByRole("textbox", { name: "Code", exact: true })).toHaveValue(code);
    await expect(main.getByRole("textbox", { name: "Code", exact: true })).not.toBeEditable();
    const price = main.getByRole("textbox", { name: "Price, UAH" });
    await expect(price).toHaveValue("80.50");

    // Edit: only the changed field is sent, as minor units.
    await price.fill("1.005");
    await main.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText("At most 2 digits after the dot.")).toBeVisible();
    await price.fill("120");
    const patched = page.waitForRequest(
      (request) =>
        request.method() === "PATCH" && request.url().includes("/admin/shipping/methods/"),
    );
    await main.getByRole("button", { name: "Save changes" }).click();
    expect((await patched).postDataJSON()).toEqual({ pricing: { type: "flat", amount: 12000 } });
    await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
    await page.reload();
    await expect(main.getByRole("textbox", { name: "Price, UAH" })).toHaveValue("120.00");

    // The list shows the method with its type, carrier, price and status.
    await page.goto(`${SPA}/shipping`);
    const row = main.getByRole("row", { name: new RegExp(code) });
    await expect(row).toContainText("Delivery to an address");
    await expect(row).toContainText("fake");
    await expect(row).toContainText("Active");

    // An order is placed with the method: it can no longer be deleted, and the screen says what to do instead.
    await shopper.placeGuestOrderWithShipping(
      `e2e-ship-${u}@example.com`,
      "demo-screwdriver",
      "DEMO-SCREWDRIVER",
      code,
    );
    await row.getByRole("link", { name: code }).click();
    await main.getByRole("button", { name: "Delete the method" }).click();
    const dialog = page.getByRole("alertdialog", { name: `Delete the method ${code}?` });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete the method" }).click();
    await expect(
      dialog.getByText(
        /Orders were placed with this method, so it cannot be deleted\. Deactivate it instead/,
      ),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // Deactivate it instead.
    await main.getByRole("checkbox", { name: "Active (offered at checkout)" }).uncheck();
    await main.getByRole("button", { name: "Save changes" }).click();
    await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
    await page.goto(`${SPA}/shipping`);
    await expect(main.getByRole("row", { name: new RegExp(code) })).toContainText("Inactive");

    // A method no order used can be deleted, after a confirmation.
    const unused = await owner.createShippingMethod({
      code: unusedCode,
      title: { uk: `Нікому ${u}`, en: `Unused ${u}` },
      kind: "address",
      pricing: { type: "carrier_on_delivery" },
      countryCodes: ["UA"],
    });
    await page.goto(`${SPA}/shipping/methods/${unused.id}`);
    await main.getByRole("button", { name: "Delete the method" }).click();
    await page
      .getByRole("alertdialog", { name: `Delete the method ${unusedCode}?` })
      .getByRole("button", { name: "Delete the method" })
      .click();
    await expect(main.getByText("The delivery method was deleted.")).toBeVisible();
    await page.goto(`${SPA}/shipping`);
    await expect(main.getByRole("link", { name: unusedCode })).toHaveCount(0);
  } finally {
    await owner.deactivateAllShippingMethods();
  }
});

test("shipping methods: tiers and a pickup point are typed as decimals and a bad tier is refused before sending", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const code = `tiers_${u}`;
  try {
    await signIn("owner");
    const main = page.getByRole("main");
    await page.goto(`${SPA}/shipping/methods/new`);
    await main.getByRole("textbox", { name: "Code", exact: true }).fill(code);
    await main.getByRole("textbox", { name: "Title (Ukrainian)" }).fill(`Рівні ${u}`);
    await main
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption({ label: "Pickup point (branch or locker)" });
    await main.getByRole("textbox", { name: "Carrier code" }).fill("fake");
    await main.getByRole("textbox", { name: "Countries" }).fill("UA PL");
    await main
      .getByRole("combobox", { name: "Price type" })
      .selectOption({ label: "By cart total (tiers)" });
    await main.getByRole("textbox", { name: "Tier 1: price, UAH" }).fill("120");
    await main.getByRole("button", { name: "Add a tier" }).click();
    await main.getByRole("textbox", { name: "Tier 2: from cart total, UAH" }).fill("0");
    await main.getByRole("textbox", { name: "Tier 2: price, UAH" }).fill("60");
    // A second tier that does not start higher is refused on its own field, and nothing is sent.
    const sent: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/admin/shipping/methods")) {
        sent.push(request.url());
      }
    });
    await main.getByRole("button", { name: "Create method" }).click();
    await expect(main.getByText("Two tiers start at the same total.")).toBeVisible();
    await expect(
      main.getByRole("textbox", { name: "Tier 2: from cart total, UAH" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(sent).toEqual([]);
    await main.getByRole("textbox", { name: "Tier 2: from cart total, UAH" }).fill("1000.00");
    const created = page.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith("/admin/shipping/methods"),
    );
    await main.getByRole("button", { name: "Create method" }).click();
    expect((await created).postDataJSON()).toEqual({
      code,
      title: { uk: `Рівні ${u}` },
      kind: "pickup_point",
      providerCode: "fake",
      pricing: {
        type: "tiers",
        tiers: [
          { fromSubtotal: 0, amount: 12000 },
          { fromSubtotal: 100000, amount: 6000 },
        ],
      },
      countryCodes: ["UA", "PL"],
      isActive: false,
    });
    await expect(main.getByText(/was created\./)).toBeVisible();
  } finally {
    await owner.deactivateAllShippingMethods();
  }
});

test("carriers: save the profile, a credential key is refused with an explanation, test the connection, an unknown carrier", async ({
  page,
  signIn,
}) => {
  await signIn("manager");
  const main = page.getByRole("main");
  await page.goto(`${SPA}/shipping/providers`);
  await expect(page.getByRole("heading", { level: 1, name: "Carriers" })).toBeVisible();
  // API keys are explained as environment variables; no field asks for one.
  await expect(main.getByText("API keys are not entered here")).toBeVisible();
  await expect(main.locator("input[type=password]")).toHaveCount(0);
  await main.getByRole("textbox", { name: "Carrier code" }).fill("fake");
  await main.getByRole("link", { name: "Open carrier fake" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Carrier fake" })).toBeVisible();

  const profile = main.getByRole("textbox", { name: /Profile \(JSON\)/ });
  await profile.fill('{"sender":{"name":"E2E Shop","phone":"+380501234567"}}');
  const saved = page.waitForRequest(
    (request) =>
      request.method() === "PUT" &&
      request.url().endsWith("/admin/shipping/providers/fake/settings"),
  );
  await main.getByRole("button", { name: "Save profile" }).click();
  expect((await saved).postDataJSON()).toEqual({
    settings: { sender: { name: "E2E Shop", phone: "+380501234567" } },
  });
  await expect(main.getByText("The profile was saved.")).toBeVisible();
  await page.reload();
  await expect(main.getByRole("textbox", { name: /Profile \(JSON\)/ })).toHaveValue(/E2E Shop/);

  // Text that is not JSON is caught before sending; a credential key is refused by the server and explained.
  await main.getByRole("textbox", { name: /Profile \(JSON\)/ }).fill("{ nope");
  await main.getByRole("button", { name: "Save profile" }).click();
  await expect(main.getByText("This is not valid JSON.")).toBeVisible();
  await main.getByRole("textbox", { name: /Profile \(JSON\)/ }).fill('{"sender":{"apiKey":"abc"}}');
  await main.getByRole("button", { name: "Save profile" }).click();
  await expect(main.getByText("The profile was not saved")).toBeVisible();
  await expect(main.getByText("settings.sender.apiKey")).toBeVisible();
  await expect(
    main.getByText(/Credentials are never saved here: set them as environment variables/),
  ).toBeVisible();
  await expect(main.getByRole("textbox", { name: /Profile \(JSON\)/ })).toHaveValue(/abc/);

  // Test connection: the fake carrier accepts it.
  await main.getByRole("button", { name: "Test connection" }).click();
  await expect(main.getByText("The carrier accepted the connection.")).toBeVisible();

  // A carrier the shop does not run.
  await page.goto(`${SPA}/shipping/providers/ghost_carrier`);
  await expect(main.getByText("The carrier ghost_carrier is not enabled")).toBeVisible();
});

test("waybill: only a paid order ships; create, track, print the label, cancel", async ({
  page,
  signIn,
  owner,
  shopper,
}, testInfo) => {
  const u = unique(testInfo);
  const code = `courier_${u}`;
  try {
    await owner.createShippingMethod({
      code,
      title: { uk: `Кур'єр ${u}`, en: `Courier ${u}` },
      kind: "address",
      providerCode: "fake",
      pricing: { type: "flat", amount: 5000 },
      countryCodes: ["UA"],
      isActive: true,
    });
    const placed = await shopper.placeGuestOrderWithShipping(
      `e2e-waybill-${u}@example.com`,
      "demo-screwdriver",
      "DEMO-SCREWDRIVER",
      code,
    );
    expect(placed.total).toEqual({ amount: 18900 + 5000, currency: "UAH" });
    const orderId = await owner.orderIdByNumber(placed.number);

    await signIn("manager");
    const main = page.getByRole("main");
    await page.goto(`${SPA}/orders/${orderId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: `Order ${placed.number}` }),
    ).toBeVisible();

    // The snapshot of the checkout.
    const delivery = main.getByRole("region", { name: "Delivery and shipments" });
    await expect(delivery).toContainText(`Courier ${u}`);
    await expect(delivery).toContainText("Delivery to an address");
    await expect(delivery).toContainText("50.00");
    await expect(delivery).toContainText("No waybill has been created for this order.");

    // Unpaid: the form is there but off, and says why.
    await expect(delivery.getByText("The order is not paid yet. Mark it paid first")).toBeVisible();
    await expect(delivery.getByRole("textbox", { name: "Weight, g" })).toBeDisabled();
    await expect(delivery.getByRole("button", { name: "Create the waybill" })).toBeDisabled();

    // Pay the order (the existing action).
    await main.getByRole("button", { name: "Mark paid" }).click();
    const pay = page.getByRole("dialog", { name: `Mark order ${placed.number} paid` });
    await pay.getByRole("textbox", { name: "Payment reference" }).fill(`BANK-${u}`);
    await pay.getByRole("checkbox", { name: /I received this amount/ }).check();
    await pay.getByRole("button", { name: "Mark paid" }).click();
    await expect(main.getByText("The order is marked paid.")).toBeVisible();

    // Paid: the declared value starts as the subtotal; the parcel is typed.
    await expect(delivery.getByRole("textbox", { name: "Weight, g" })).toBeEnabled();
    await expect(delivery.getByRole("textbox", { name: "Declared value, UAH" })).toHaveValue(
      "189.00",
    );
    await delivery.getByRole("button", { name: "Create the waybill" }).click();
    await expect(delivery.getByText("Fill in this field.").first()).toBeVisible();
    await delivery.getByRole("textbox", { name: "Weight, g" }).fill("1500");
    await delivery.getByRole("textbox", { name: "Length, mm" }).fill("300");
    await delivery.getByRole("textbox", { name: "Width, mm" }).fill("200");
    await delivery.getByRole("textbox", { name: "Height, mm" }).fill("100");
    await delivery
      .getByRole("textbox", { name: "Description of the goods" })
      .fill("Screwdriver set");
    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith(`/admin/orders/${orderId}/shipments`),
    );
    await delivery.getByRole("button", { name: "Create the waybill" }).click();
    expect((await createRequest).postDataJSON()).toEqual({
      weightGrams: 1500,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 100,
      description: "Screwdriver set",
      declaredValue: { amount: 18900, currency: "UAH" },
      payer: "sender",
    });
    await expect(delivery.getByText(/The waybill FAKE\d+ was created\./)).toBeVisible();
    const card = delivery.getByRole("article", { name: /Waybill FAKE\d+/ });
    await expect(card).toContainText("Created");
    await expect(card).toContainText(/FAKE\d{6}/);
    const journal = card.getByRole("table", {
      name: `Status journal of a waybill of order ${placed.number}`,
    });
    await expect(journal).toContainText("Created as Pending");
    await expect(journal).toContainText("Pending → Created");
    // One active waybill at a time: the form is gone, with the reason.
    await expect(delivery.getByRole("textbox", { name: "Weight, g" })).toHaveCount(0);
    await expect(delivery.getByText(/A waybill already exists for this order/)).toBeVisible();

    // Refresh tracking.
    await card.getByRole("button", { name: "Refresh tracking" }).click();
    await expect(delivery.getByText("Tracking was refreshed.")).toBeVisible();

    // The label: a download of a PDF made by the browser from a blob, no navigation.
    const downloaded = page.waitForEvent("download");
    const labelRequest = page.waitForResponse((response) => response.url().endsWith("/label"));
    await card.getByRole("button", { name: "Print label" }).click();
    const download = await downloaded;
    expect((await labelRequest).status()).toBe(200);
    expect(download.suggestedFilename()).toBe(`label-${placed.number}.pdf`);
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    await expect(
      delivery.getByText("The label PDF was handed to your browser as a download."),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));

    // Cancel the waybill, after a confirmation that keeps the safe choice focused.
    await card.getByRole("button", { name: "Cancel the waybill" }).click();
    const confirm = page.getByRole("alertdialog", { name: /Cancel the waybill FAKE\d+\?/ });
    await expect(confirm.getByRole("button", { name: "Keep the waybill" })).toBeFocused();
    await confirm.getByRole("button", { name: "Cancel the waybill" }).click();
    await expect(delivery.getByText("The waybill was cancelled at the carrier.")).toBeVisible();
    await expect(card).toContainText("Cancelled");
    await expect(card.getByRole("button", { name: "Cancel the waybill" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Print label" })).toHaveCount(0);
    // A cancelled waybill is not active: a new one can be created, and the order is still paid and unfulfilled.
    await expect(delivery.getByRole("textbox", { name: "Weight, g" })).toBeEnabled();
    await expect(main.getByText("Paid", { exact: true }).first()).toBeVisible();
  } finally {
    await owner.deactivateAllShippingMethods();
  }
});

test("waybill: a refused form focuses its summary at once, so what is typed next stays in that field (late frames)", async ({
  page,
  signIn,
  owner,
  shopper,
}, testInfo) => {
  const u = unique(testInfo);
  const code = `late_${u}`;
  try {
    await owner.createShippingMethod({
      code,
      title: { uk: `Кур'єр ${u}`, en: `Courier ${u}` },
      kind: "address",
      providerCode: "fake",
      pricing: { type: "flat", amount: 5000 },
      countryCodes: ["UA"],
      isActive: true,
    });
    const placed = await shopper.placeGuestOrderWithShipping(
      `e2e-waybill-late-${u}@example.com`,
      "demo-screwdriver",
      "DEMO-SCREWDRIVER",
      code,
    );
    const orderId = await owner.orderIdByNumber(placed.number);
    await owner.markPaid(orderId, `BANK-${u}`, placed.total);

    // Regression of the CI run of PR #191: a focus moved from an animation frame arrives after the test has moved on.
    await delayAnimationFrames(page);
    await signIn("manager");
    await page.goto(`${SPA}/orders/${orderId}`);
    const delivery = page.getByRole("main").getByRole("region", { name: "Delivery and shipments" });
    const weight = delivery.getByRole("textbox", { name: "Weight, g" });
    await expect(weight).toBeEnabled();
    await delivery.getByRole("button", { name: "Create the waybill" }).click();
    await expect(delivery.getByText("Fill in this field.").first()).toBeVisible();
    // Read once, no waiting: the summary of the refusal has the focus as soon as it is shown.
    expect(await page.evaluate(() => document.activeElement?.textContent ?? "")).toContain(
      "Nothing was sent.",
    );

    // The admin goes on to the weight at once and types: every key stays in the weight.
    await weight.focus();
    await page.keyboard.type("1500", { delay: 40 });
    await expect(weight).toHaveValue("1500");
    await expect(weight).toBeFocused();
  } finally {
    await owner.deactivateAllShippingMethods();
  }
});
