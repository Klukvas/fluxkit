import type { Page } from "@playwright/test";
import { SPA } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

async function expectNotAllowed(page: Page, path: string): Promise<void> {
  await page.goto(`${SPA}${path}`);
  await expect(page.getByRole("heading", { level: 1, name: "Not allowed" })).toBeVisible();
  await expect(
    page.getByText("Your role does not allow this page. Ask a shop owner if you need it."),
  ).toBeVisible();
}

test("the viewer browses the catalog read-only and is not allowed in orders", async ({
  page,
  signIn,
  guard,
}) => {
  await signIn("viewer");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link", { name: "Products" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Categories" })).toBeVisible();
  for (const hidden of ["Orders", "Customers", "Admin users"]) {
    await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
  }

  await nav.getByRole("link", { name: "Products" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo T-shirt" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New product" })).toHaveCount(0);

  // The product editor: every tab readable, nothing to save or change.
  await page.getByRole("link", { name: "Demo T-shirt" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Demo T-shirt" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByLabel("Title (English)")).toHaveValue("Demo T-shirt");
  await expect(main.getByLabel("Title (English)")).not.toBeEditable();
  await expect(main.getByLabel("Brand")).toBeDisabled();
  for (const action of ["Publish", "Unpublish", "Archive", "Restore as draft", "Delete"]) {
    await expect(main.getByRole("button", { name: action, exact: true })).toHaveCount(0);
  }
  const tabs = [
    "General",
    "Attributes",
    "Categories",
    "Media",
    "Options",
    "Variants",
    "Prices",
    "Stock",
  ];
  for (const name of tabs) {
    await main.getByRole("tab", { name }).click();
    await expect(main.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
    await expect(main.getByRole("tabpanel", { name })).toBeVisible();
    // No save, add, remove, generate or record button on any tab.
    await expect(
      main.getByRole("tabpanel", { name }).getByRole("button", {
        name: /^(Save|Add|Remove|Generate|Record|Delete|Make|Switch|Create)/,
      }),
    ).toHaveCount(0);
  }
  await expect(main.getByRole("table", { name: /Stock of the variants/ })).toBeVisible();

  // The dictionaries: lists and editors without create, edit or delete controls.
  await page.goto(`${SPA}/catalog/attributes`);
  await expect(page.getByRole("heading", { level: 1, name: "Attributes" })).toBeVisible();
  await expect(main.getByRole("link", { name: "material" })).toBeVisible();
  await expect(main.getByRole("link", { name: "New attribute" })).toHaveCount(0);
  await main.getByRole("link", { name: "material" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /Material/ })).toBeVisible();
  await expect(main.getByRole("button")).toHaveCount(0);
  await page.goto(`${SPA}/catalog/categories`);
  await expect(main.getByRole("link", { name: "Clothing" })).toBeVisible();
  await expect(main.getByRole("link", { name: "New category" })).toHaveCount(0);
  await expect(main.getByRole("link", { name: /Add a subcategory/ })).toHaveCount(0);

  // Direct addresses of screens the role cannot use.
  await expectNotAllowed(page, "/orders");
  await expectNotAllowed(page, "/catalog/attributes/new");
  await expectNotAllowed(page, "/users");

  expect(guard.writes(), "the viewer's pages send no write").toEqual([]);
  const forbiddenReads = guard.requests.filter((request) =>
    /^\/admin\/(orders|customers|users)/.test(new URL(request.url).pathname),
  );
  expect(forbiddenReads, "no request for data the role cannot read").toEqual([]);
});

test("the manager has no users area", async ({ page, signIn, guard }) => {
  await signIn("manager");
  const nav = page.getByRole("navigation", { name: "Admin sections" });
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Customers" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Products" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Admin users" })).toHaveCount(0);
  await expectNotAllowed(page, "/users");
  await expectNotAllowed(page, "/users/new");
  const userReads = guard.requests.filter((request) =>
    new URL(request.url).pathname.startsWith("/admin/users"),
  );
  expect(userReads, "no users request").toEqual([]);
});
