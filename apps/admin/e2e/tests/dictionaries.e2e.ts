import type { Locator, Page } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";

/** Fills the uk and en fields of a locale-map group ("Name" -> "Name (Ukrainian)", "Name (English)"). */
async function fillLocales(scope: Page | Locator, field: string, uk: string, en: string) {
  await scope.getByRole("textbox", { name: `${field} (Ukrainian)`, exact: true }).fill(uk);
  await scope.getByRole("textbox", { name: `${field} (English)`, exact: true }).fill(en);
}

/** After a create the screen shows a focused confirmation with a link to the new item (no redirect, step 5). */
async function openCreated(page: Page, notice: string, link: string): Promise<void> {
  const status = page.getByText(notice, { exact: true });
  await expect(status).toBeVisible();
  await page.getByRole("link", { name: link }).click();
}

test("dictionaries: option with values, attribute with options, product type, brand, category tree with a move", async ({
  page,
  signIn,
}, testInfo) => {
  const u = unique(testInfo);
  await signIn("manager");
  const main = page.getByRole("main");

  // Option with two values.
  await page.goto(`${SPA}/catalog/options/new`);
  await main.getByRole("textbox", { name: "Code", exact: true }).fill(`finish_${u}`);
  await fillLocales(main, "Name", `Оздоблення ${u}`, `Finish ${u}`);
  await main.getByRole("button", { name: "Create option" }).click();
  await openCreated(page, `Option finish_${u} was created.`, "Open the option");
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`Finish ${u}`) }),
  ).toBeVisible();
  for (const [code, uk, en] of [
    ["matte", "Матовий", "Matte"],
    ["glossy", "Глянцевий", "Glossy"],
  ] as const) {
    await main.getByRole("button", { name: "Add value" }).click();
    const dialog = page.getByRole("dialog", { name: "Add value" });
    await dialog.getByRole("textbox", { name: "Code", exact: true }).fill(code);
    await fillLocales(dialog, "Label", uk, en);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      main
        .getByRole("table", { name: "Values of the option" })
        .getByRole("row", { name: new RegExp(`${code}`) }),
    ).toBeVisible();
  }

  // Attribute (one choice) with two options.
  await page.goto(`${SPA}/catalog/attributes/new`);
  await main.getByRole("textbox", { name: "Code", exact: true }).fill(`grade_${u}`);
  await fillLocales(main, "Name", `Ґатунок ${u}`, `Grade ${u}`);
  await main.getByRole("combobox", { name: "Type of value" }).selectOption({ label: "One choice" });
  await main.getByRole("button", { name: "Create attribute" }).click();
  await openCreated(page, `Attribute grade_${u} was created.`, "Open the attribute");
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`Grade ${u}`) }),
  ).toBeVisible();
  for (const [code, uk, en] of [
    ["basic", "Базовий", "Basic"],
    ["premium", "Преміум", "Premium"],
  ] as const) {
    await main.getByRole("button", { name: "Add option" }).click();
    const dialog = page.getByRole("dialog", { name: "Add option" });
    await dialog.getByRole("textbox", { name: "Code", exact: true }).fill(code);
    await fillLocales(dialog, "Label", uk, en);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      main
        .getByRole("table", { name: "Options of the attribute" })
        .getByRole("row", { name: new RegExp(code) }),
    ).toBeVisible();
  }

  // Product type with the attribute (product level, required) and the option.
  await page.goto(`${SPA}/catalog/product-types/new`);
  await main.getByRole("textbox", { name: "Code", exact: true }).fill(`panel_${u}`);
  await fillLocales(main, "Name", `Панель ${u}`, `Panel ${u}`);
  await main.getByRole("button", { name: "Create product type" }).click();
  await openCreated(page, `Product type panel_${u} was created.`, "Open the product type");
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`Panel ${u}`) }),
  ).toBeVisible();

  await main.getByRole("button", { name: "Assign attribute" }).click();
  const assign = page.getByRole("dialog", { name: "Assign an attribute" });
  await assign
    .getByRole("combobox", { name: "Attribute", exact: true })
    .selectOption({ label: `grade_${u} - Grade ${u}` });
  await assign.getByRole("checkbox", { name: "Required" }).check();
  await assign.getByRole("button", { name: "Save" }).click();
  await expect(assign).toBeHidden();
  await expect(
    main
      .getByRole("table", { name: "Attributes of the product type" })
      .getByRole("row", { name: new RegExp(`grade_${u}`) }),
  ).toBeVisible();

  await main.getByRole("button", { name: "Allow option" }).click();
  const allow = page.getByRole("dialog", { name: "Allow an option" });
  await allow
    .getByRole("combobox", { name: "Option", exact: true })
    .selectOption({ label: `finish_${u} - Finish ${u}` });
  await allow.getByRole("button", { name: "Save" }).click();
  await expect(allow).toBeHidden();
  await expect(
    main
      .getByRole("table", { name: "Options of the product type" })
      .getByRole("row", { name: new RegExp(`finish_${u}`) }),
  ).toBeVisible();

  // Brand.
  await page.goto(`${SPA}/catalog/brands/new`);
  await fillLocales(main, "Name", `Бренд ${u}`, `Brand ${u}`);
  await main.getByRole("textbox", { name: "Slug (part of the address)" }).fill(`brand-${u}`);
  await main.getByRole("button", { name: "Create brand" }).click();
  await expect(page.getByText(`Brand Brand ${u} was created.`, { exact: true })).toBeVisible();
  await page.goto(`${SPA}/catalog/brands`);
  await expect(main.getByRole("link", { name: `brand-${u}` })).toBeVisible();

  // Category tree: two roots, a child under the first, then the child moved under the second.
  for (const [name, slug] of [
    [`Rooms ${u}`, `rooms-${u}`],
    [`Halls ${u}`, `halls-${u}`],
  ] as const) {
    await page.goto(`${SPA}/catalog/categories/new`);
    await fillLocales(main, "Name", `${name} uk`, name);
    await main.getByRole("textbox", { name: "Slug (part of the address)" }).fill(slug);
    await main.getByRole("button", { name: "Create category" }).click();
    await expect(page.getByText(`Category ${name} was created.`, { exact: true })).toBeVisible();
  }
  await page.goto(`${SPA}/catalog/categories`);
  const tree = main.getByRole("navigation", { name: "Category tree" });
  await tree.getByRole("link", { name: `Add a subcategory to Rooms ${u}` }).click();
  await expect(main.getByRole("textbox", { name: "Parent category" })).toHaveValue(
    new RegExp(`Rooms ${u}`),
  );
  await fillLocales(main, "Name", `Kitchen ${u} uk`, `Kitchen ${u}`);
  await main.getByRole("button", { name: "Create category" }).click();
  await openCreated(page, `Category Kitchen ${u} was created.`, "Open the category");
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`Kitchen ${u}`) }),
  ).toBeVisible();

  await main
    .getByRole("combobox", { name: "New parent" })
    .selectOption({ label: `Halls ${u} (halls-${u})` });
  await main.getByRole("button", { name: "Move…" }).click();
  const move = page.getByRole("alertdialog", { name: "Move this category?" });
  await move.getByRole("button", { name: "Move category" }).click();
  await expect(move).toBeHidden();
  await expect(page.getByText("Category moved.", { exact: true })).toBeVisible();

  await page.goto(`${SPA}/catalog/categories`);
  await tree.getByRole("button", { name: `Subcategories of Halls ${u}` }).click();
  const halls = tree
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: `Halls ${u}`, exact: true }) });
  await expect(halls.getByRole("link", { name: `Kitchen ${u}`, exact: true })).toBeVisible();
  await tree.getByRole("button", { name: `Subcategories of Rooms ${u}` }).click();
  const rooms = tree
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: `Rooms ${u}`, exact: true }) });
  await expect(rooms.getByText("No subcategories.")).toBeVisible();
});
