import type { Locator, Page } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

function tab(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("tabpanel", { name });
}

async function openTab(page: Page, name: string): Promise<Locator> {
  await page.getByRole("main").getByRole("tab", { name }).click();
  await expect(page.getByRole("main").getByRole("tab", { name })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  return tab(page, name);
}

test("product flow: create, generated attributes, options, variants, prices, stock, publish refused then published", async ({
  page,
  signIn,
  guard,
}, testInfo) => {
  const u = unique(testInfo);
  const slug = `e2e-shirt-${u}`;
  await signIn("manager");
  const main = page.getByRole("main");

  // Create a draft from the seeded product type "Clothing".
  await page.goto(`${SPA}/products/new`);
  await main
    .getByRole("combobox", { name: "Product type" })
    .selectOption({ label: "Clothing (clothing)" });
  await main.getByRole("textbox", { name: "Title (Ukrainian)", exact: true }).fill(`Сорочка ${u}`);
  await main.getByRole("textbox", { name: "Title (English)", exact: true }).fill(`Shirt ${u}`);
  await main.getByRole("textbox", { name: "Slug", exact: true }).fill(slug);
  await main.getByRole("button", { name: "Create the product" }).click();
  await expect(main.getByText(`Product “Shirt ${u}” created as a draft.`)).toBeVisible();
  await main.getByRole("link", { name: "Open the product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Shirt ${u}` })).toBeVisible();
  await expect(main.getByText("Draft", { exact: true }).first()).toBeVisible();

  // Attributes are generated from the product type's definitions (nothing niche-specific in the SPA).
  const attributes = await openTab(page, "Attributes");
  await expect(attributes.getByRole("combobox", { name: "Material" })).toBeVisible();
  await expect(attributes.getByRole("group", { name: "Care notes" })).toBeVisible();
  await expect(attributes.getByRole("textbox", { name: "Supplier reference" })).toBeVisible();
  await attributes.getByRole("combobox", { name: "Material" }).selectOption({ label: "Linen" });
  await attributes.getByRole("textbox", { name: "Care notes (Ukrainian)" }).fill("Прати вручну.");
  await attributes.getByRole("textbox", { name: "Care notes (English)" }).fill("Hand wash.");
  await attributes.getByRole("button", { name: "Save" }).click();
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();

  // Options: two colours and one size of the type's options give two variants.
  const options = await openTab(page, "Options");
  const color = options.getByRole("group", { name: "Color (color)" });
  await color.getByRole("checkbox", { name: "Use this option" }).check();
  await color.getByRole("checkbox", { name: "Black" }).check();
  await color.getByRole("checkbox", { name: "White" }).check();
  // A new draft has its one default variant: the plan says all variants are created again, and asks.
  await expect(options.getByText("All variants are created again")).toBeVisible();
  await options.getByRole("button", { name: "Save the options" }).click();
  const rebuild = page.getByRole("alertdialog", { name: "Create all variants again?" });
  await rebuild.getByRole("button", { name: "Save the options" }).click();
  await expect(rebuild).toBeHidden();
  await expect(options.getByRole("region", { name: "Options of this product" })).toContainText(
    "Black, White",
  );
  const black = `${slug.toUpperCase()}-BLACK`;
  const white = `${slug.toUpperCase()}-WHITE`;

  // Variants: saving the options generated both; delete one, then "generate missing" brings it back.
  const variants = await openTab(page, "Variants");
  await expect(variants.getByRole("table", { name: "Variants of the product (2)" })).toBeVisible();
  await variants.getByRole("button", { name: `Delete variant ${white}` }).click();
  const deleteVariant = page.getByRole("alertdialog", { name: `Delete variant ${white}?` });
  await deleteVariant.getByRole("button", { name: "Delete" }).click();
  await expect(main.getByText(`Variant ${white} deleted.`)).toBeVisible();
  await expect(variants.getByRole("table", { name: "Variants of the product (1)" })).toBeVisible();
  await variants.getByRole("button", { name: "Generate missing variants" }).click();
  await expect(
    main.getByText("Variants generated: 1 new, 1 combinations had one already."),
  ).toBeVisible();
  await expect(variants.getByRole("table", { name: "Variants of the product (2)" })).toBeVisible();
  await expect(variants.getByRole("rowheader", { name: white })).toBeVisible();

  // Prices: a decimal amount for the first variant only; the second stays without a price for now.
  let prices = await openTab(page, "Prices");
  await prices
    .getByRole("textbox", { name: `Price of ${black} in UAH`, exact: true })
    .fill("1234.50");
  await expect(prices.getByText(/Will be stored as .*1,234\.50/)).toBeVisible();
  await prices.getByRole("button", { name: "Save the prices" }).click();
  await expect(prices.getByText(/Stored: .*1,234\.50/)).toBeVisible();

  // Stock: a receipt of 7 units for the first variant (opened first).
  const stock = await openTab(page, "Stock");
  await expect(stock.getByRole("button", { name: `Open the stock of ${black}` })).toBeDisabled();
  const change = stock.getByRole("region", { name: `Change the stock of ${black}` });
  await expect(change.getByRole("combobox", { name: "Kind" })).toHaveValue("receipt");
  await change.getByRole("textbox", { name: "Quantity" }).fill("7");
  await change.getByRole("textbox", { name: "Reference" }).fill(`DN-${u}`);
  await change.getByRole("button", { name: "Record the change" }).click();
  await expect(stock.getByText("The change is recorded")).toBeVisible();
  const levels = stock.getByRole("table", { name: `Levels of ${black} per location` });
  await expect(levels.getByRole("row").nth(1)).toContainText("7");
  await expect(stock.getByRole("table", { name: `Stock journal of ${black}` })).toContainText(
    "Receipt",
  );
  await expect(
    stock
      .getByRole("table", { name: "Stock of the variants (2)" })
      .getByRole("row", { name: new RegExp(black) }),
  ).toContainText("In stock");

  // Publish with the second variant still unpriced: refused, and the problem lands on that variant's Prices cell.
  const lifecycle = main.getByRole("group", { name: "Product status actions" });
  await lifecycle.getByRole("button", { name: "Publish" }).click();
  await expect(
    main.getByText("The product cannot be published yet. Fix these and publish again:"),
  ).toBeVisible();
  const problems = main.getByRole("alert").filter({ hasText: "cannot be published yet" });
  await expect(problems.getByRole("listitem")).toHaveCount(1);
  await expect(problems.getByRole("listitem")).toContainText(`Variant 2 (${white}):`);
  await problems.getByRole("button", { name: "Go to Prices" }).click();
  prices = tab(page, "Prices");
  await expect(main.getByRole("tab", { name: "Prices" })).toHaveAttribute("aria-selected", "true");
  const whitePrice = prices.getByRole("textbox", { name: `Price of ${white} in UAH`, exact: true });
  await expect(whitePrice).toBeFocused();
  await expect(whitePrice).toHaveAttribute("aria-invalid", "true");
  await expect(
    prices.getByText("An active variant needs a price in the shop currency."),
  ).toBeVisible();
  await expect(main.getByText("Draft", { exact: true }).first()).toBeVisible();

  await whitePrice.fill("99");
  await prices.getByRole("button", { name: "Save the prices" }).click();
  await expect(prices.getByText(/Stored: .*99\.00/)).toBeVisible();
  await lifecycle.getByRole("button", { name: "Publish" }).click();
  await expect(main.getByText("The product is published.")).toBeVisible();
  await expect(main.getByText("Published", { exact: true }).first()).toBeVisible();

  // The shop sees it, with the exact minor-unit amounts.
  const store = await page.request.get(`/store/products/${slug}`);
  expect(store.status()).toBe(200);
  const product = (await store.json()) as {
    title: string;
    variants: { sku: string; price: { amount: number; currency: string } | null }[];
  };
  const bySku = Object.fromEntries(product.variants.map((variant) => [variant.sku, variant.price]));
  expect(bySku).toEqual({
    [black]: expect.objectContaining({ amount: 123450, currency: "UAH" }),
    [white]: expect.objectContaining({ amount: 9900, currency: "UAH" }),
  });

  // Every write of this flow went out with the CSRF header (the guard checks each one; this shows there were many).
  const writes = guard.writes();
  expect(writes.length).toBeGreaterThanOrEqual(8);
  expect(writes.filter((write) => write.csrf !== "1")).toEqual([]);
});
