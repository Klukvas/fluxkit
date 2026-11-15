import type { Locator, Page } from "@playwright/test";
import { json } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { expect, test, unique } from "../support/fixtures.ts";
import { asPayload, pngFile } from "../support/images.ts";

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
    .selectOption({ label: `Finish ${u} (finish_${u})` });
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
  await main.getByRole("textbox", { name: "Page address", exact: true }).fill(`brand-${u}`);
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
    await main.getByRole("textbox", { name: "Page address", exact: true }).fill(slug);
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

test("an admin enables split cards and links each value's picture through the Media tab", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const option = await owner.post<{ id: string }>("/admin/options", {
    code: `picture_${u}`,
    name: { uk: `Оздоблення ${u}`, en: `Finish ${u}` },
  });
  const values = await Promise.all(
    ["matte", "glossy"].map(async (code) => ({
      code,
      ...(await owner.post<{ id: string }>(`/admin/options/${option.id}/values`, {
        code,
        label: { uk: `${code} uk`, en: code },
      })),
    })),
  );
  const type = await owner.post<{ id: string }>("/admin/product-types", {
    code: `pictures_${u}`,
    name: { uk: `Зображення ${u}`, en: `Pictures ${u}` },
    requiresShipping: false,
  });
  await owner.put(`/admin/product-types/${type.id}/options/${option.id}`, {}, [200, 201]);
  const product = await owner.post<{ id: string }>("/admin/products", {
    productTypeId: type.id,
    slug: `e2e-pictures-${u}`,
    title: { uk: `Товар ${u}`, en: `Product ${u}` },
  });
  await owner.put(`/admin/products/${product.id}/options`, {
    options: [{ optionId: option.id, valueIds: values.map((value) => value.id) }],
  });
  const variants = await owner.get<{ items: { id: string }[] }>(
    `/admin/products/${product.id}/variants`,
  );
  expect(variants.items).toHaveLength(2);
  await owner.put(`/admin/products/${product.id}/prices`, {
    items: variants.items.map((variant) => ({
      variantId: variant.id,
      currency: "UAH",
      amount: 12500,
    })),
  });
  const categorySlug = `pictures-${u}`;
  const category = await owner.post<{ id: string }>("/admin/categories", {
    slug: categorySlug,
    name: { uk: `Зображення ${u}`, en: `Pictures ${u}` },
  });
  await owner.put(`/admin/products/${product.id}/categories`, {
    categories: [{ categoryId: category.id }],
  });
  await owner.post(`/admin/products/${product.id}/publish`, undefined);

  await signIn("manager");
  await page.goto(`${SPA}/catalog/product-types/${type.id}`);
  await page
    .getByRole("button", { name: `Change the assignment of the option “Finish ${u}”` })
    .click();
  const assignment = page.getByRole("dialog", { name: "Change the option assignment" });
  await assignment.getByRole("checkbox", { name: "Separate listing cards per value" }).check();
  await assignment.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(assignment).toBeHidden();
  await page.reload();
  await expect(
    page
      .getByRole("table", { name: "Options of the product type" })
      .getByRole("row")
      .filter({
        hasText: `picture_${u}`,
      }),
  ).toContainText("Yes");

  await page.goto(`${SPA}/products/${product.id}?tab=media`);
  const panel = page.getByRole("tabpanel", { name: "Media" });
  const pictures = [pngFile(`matte-${u}.png`, 40, 30), pngFile(`glossy-${u}.png`, 30, 40)];
  await panel.getByLabel("Upload images").setInputFiles(pictures.map(asPayload));
  await expect(panel.getByText("2 of 2 uploaded", { exact: true })).toBeVisible();
  const imageRow = (index: number) =>
    panel.getByRole("listitem").filter({
      has: page.getByRole("heading", { name: `Image ${index + 1}`, exact: true }),
    });
  const linkedPictures: { code: string; url: string }[] = [];
  for (const [index, value] of values.entries()) {
    const row = imageRow(index);
    const url = await row
      .getByRole("textbox", { name: "Address of the uploaded file", exact: true })
      .inputValue();
    expect(new URL(url).pathname).toMatch(/^\/media\/[0-9a-f]{32}\.png$/);
    await row
      .getByRole("combobox", { name: "Shown for the option value", exact: true })
      .selectOption({ label: `Finish ${u}: ${value.code}` });
    linkedPictures.push({ code: value.code, url });
  }
  expect(new Set(linkedPictures.map((picture) => picture.url)).size).toBe(2);
  await panel.getByRole("button", { name: "Save the images" }).click();
  await expect(page.getByRole("main").getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  for (const [index, value] of values.entries()) {
    await expect(
      imageRow(index).getByRole("combobox", { name: "Shown for the option value", exact: true }),
    ).toHaveValue(`${option.id}:${value.id}`);
    await expect(
      imageRow(index).getByRole("textbox", { name: "Address", exact: true }),
    ).toHaveValue(linkedPictures[index]?.url ?? "");
  }

  // This suite has the API and admin SPA only; the listing response is what storefront cards consume.
  const listing = await json<{
    items: {
      id: string;
      listingOption: { valueCode: string } | null;
      image: { url: string } | null;
    }[];
    total: number;
  }>(
    await page.request.get(`/store/products?groupBy=listing&locale=en&category=${categorySlug}`),
    200,
  );
  expect(listing.total).toBe(2);
  expect(listing.items.map((item) => item.id)).toEqual([product.id, product.id]);
  expect(
    listing.items.map((item) => ({ code: item.listingOption?.valueCode, url: item.image?.url })),
  ).toEqual([...linkedPictures].sort((a, b) => a.code.localeCompare(b.code)));
});

test("a type editor saves one split option, explains a second-axis conflict at its checkbox, and stays read-only for viewers", async ({
  page,
  signIn,
  owner,
  openAs,
}, testInfo) => {
  const u = unique(testInfo);
  const type = await owner.post<{ id: string }>("/admin/product-types", {
    code: `split_${u}`,
    name: { uk: `Тип ${u}`, en: `Type ${u}` },
  });
  for (const name of ["finish", "pack"]) {
    const option = await owner.post<{ id: string }>("/admin/options", {
      code: `${name}_${u}`,
      name: { uk: `${name} ${u}`, en: `${name} ${u}` },
    });
    await owner.put(`/admin/product-types/${type.id}/options/${option.id}`, {}, [200, 201]);
  }
  await signIn("manager");
  await page.goto(`${SPA}/catalog/product-types/${type.id}`);
  const table = page.getByRole("table", { name: "Options of the product type" });
  const checkboxName = "Separate listing cards per value";
  const edit = async (name: string) => {
    await table
      .getByRole("button", { name: `Change the assignment of the option “${name} ${u}”` })
      .click();
    return page.getByRole("dialog", { name: "Change the option assignment" });
  };
  const first = await edit("finish");
  const split = first.getByRole("checkbox", { name: checkboxName });
  await expect(split).not.toBeChecked();
  await expect(split).toHaveAccessibleDescription(
    /every product of the type.*asynchronously.*Media tab/,
  );
  await split.focus();
  await page.keyboard.press("Space");
  await first.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(first).toBeHidden();
  await expect(table.getByRole("row").filter({ hasText: `finish_${u}` })).toContainText("Yes");
  const reopened = await edit("finish");
  await expect(reopened.getByRole("checkbox", { name: checkboxName })).toBeChecked();
  await reopened.getByRole("button", { name: "Cancel", exact: true }).click();

  const second = await edit("pack");
  const conflicting = second.getByRole("checkbox", { name: checkboxName });
  await conflicting.focus();
  await page.keyboard.press("Space");
  const refusal = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes(`/product-types/${type.id}/options/`),
  );
  await second.getByRole("button", { name: "Save changes", exact: true }).click();
  expect((await refusal).status()).toBe(409);
  await expect(conflicting).toHaveAttribute("aria-invalid", "true");
  await expect(conflicting).toHaveAccessibleDescription(
    /Another option already splits this product type's listings/,
  );
  await expect(conflicting).toBeChecked();
  await second.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(table.getByRole("row").filter({ hasText: `pack_${u}` })).toContainText("No");

  // A reader sees the saved indicator but cannot open or change either assignment.
  const reader = await openAs("viewer");
  await reader.goto(`${SPA}/catalog/product-types/${type.id}`);
  const readerTable = reader.getByRole("table", { name: "Options of the product type" });
  await expect(readerTable.getByRole("row").filter({ hasText: `finish_${u}` })).toContainText(
    "Yes",
  );
  await expect(readerTable.getByRole("button")).toHaveCount(0);
  await expect(reader.getByRole("checkbox", { name: checkboxName })).toHaveCount(0);
  await expect(reader.getByRole("button", { name: "Allow option", exact: true })).toHaveCount(0);

  // Disabling the existing axis is a saved edit too; the other axis can then be enabled.
  const disable = await edit("finish");
  await disable.getByRole("checkbox", { name: checkboxName }).focus();
  await page.keyboard.press("Space");
  await disable.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(disable).toBeHidden();
  const enable = await edit("pack");
  await enable.getByRole("checkbox", { name: checkboxName }).focus();
  await page.keyboard.press("Space");
  await enable.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(enable).toBeHidden();
  await expect(table.getByRole("row").filter({ hasText: `finish_${u}` })).toContainText("No");
  await expect(table.getByRole("row").filter({ hasText: `pack_${u}` })).toContainText("Yes");
});
