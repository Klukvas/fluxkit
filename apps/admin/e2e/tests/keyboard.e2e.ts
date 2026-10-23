import type { Page } from "@playwright/test";
import type { AdminApi } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { CREDENTIALS, expect, test, unique } from "../support/fixtures.ts";

/** A short description of the focused element: role or tag, and its accessible text. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) return "body";
    const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
    const name =
      element.getAttribute("aria-label") ??
      (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? (element.labels?.[0]?.textContent ?? "")
        : (element.textContent ?? ""));
    return `${role}:${name.trim()}`;
  });
}

/** Presses Tab until the focus is on `target` (at most `limit` presses) and returns what got the focus on the way. */
async function tabTo(page: Page, target: string, limit = 40): Promise<string[]> {
  const path: string[] = [];
  for (let press = 0; press < limit; press += 1) {
    await page.keyboard.press("Tab");
    const now = await focused(page);
    path.push(now);
    if (now === target) return path;
  }
  throw new Error(
    `${target} was not reached with ${String(limit)} Tab presses: ${path.join(" | ")}`,
  );
}

/** A draft of the seeded "hand_tool" type, made through the API (setup only). */
async function createDraft(owner: AdminApi, u: string): Promise<{ id: string }> {
  const types = await owner.get<{ items: { id: string; code: string }[] }>(
    "/admin/product-types?limit=100",
  );
  const handTool = types.items.find((type) => type.code === "hand_tool");
  if (handTool === undefined) throw new Error("the seed has no hand_tool product type");
  return owner.post<{ id: string }>(
    "/admin/products",
    {
      productTypeId: handTool.id,
      title: { uk: `Ключ ${u}`, en: `Key ${u}` },
      slug: `e2e-key-${u}`,
    },
    201,
  );
}

test("keyboard only: skip link, focus order, tabs with arrow keys, an edit saved, a dialog closed with Escape", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const product = await createDraft(owner, u);

  await signIn("manager");
  await page.goto(`${SPA}/products/${product.id}`);
  const main = page.getByRole("main");
  await expect(page.getByRole("heading", { level: 1, name: `Key ${u}` })).toBeVisible();

  // The first Tab reaches the skip link; Enter moves the focus into the main content.
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("a:Skip to content");
  await page.keyboard.press("Enter");
  // From the main content: the back link, the status actions, then the tab list as ONE stop (the selected tab).
  const path = await tabTo(page, "tab:General");
  const order = path.filter((step) =>
    ["a:Back to the products", "button:Publish", "button:Delete", "tab:General"].includes(step),
  );
  expect(order).toEqual([
    "a:Back to the products",
    "button:Publish",
    "button:Delete",
    "tab:General",
  ]);
  expect(
    path.filter((step) => step.startsWith("tab:")),
    "the tab list is one tab stop",
  ).toEqual(["tab:General"]);

  // Arrow keys move the focus and select (automatic activation); End and Home jump; the URL keeps the tab.
  await page.keyboard.press("ArrowRight");
  expect(await focused(page)).toBe("tab:Attributes");
  await expect(main.getByRole("tab", { name: "Attributes" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/[?&]tab=attributes/);
  await page.keyboard.press("End");
  expect(await focused(page)).toBe("tab:Stock");
  await expect(main.getByRole("tabpanel", { name: "Stock" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  expect(await focused(page), "wraps around").toBe("tab:General");
  await page.keyboard.press("ArrowLeft");
  expect(await focused(page)).toBe("tab:Stock");
  await page.keyboard.press("Home");
  expect(await focused(page)).toBe("tab:General");
  await expect(main.getByRole("tabpanel", { name: "General" })).toBeVisible();

  // Into the General panel, change the English title by typing, save with Enter.
  await tabTo(page, "input:Title (English)");
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(`Key ${u} by keyboard`);
  await tabTo(page, "button:Save");
  await page.keyboard.press("Enter");
  await expect(main.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: `Key ${u} by keyboard` })).toBeVisible();
  expect(
    (await owner.get<{ title: { en: string } }>(`/admin/products/${product.id}`)).title.en,
  ).toBe(`Key ${u} by keyboard`);

  // A confirmation dialog: opened with Enter, focus on the safe choice, closed with Escape, focus back on its opener.
  await tabTo(page, "button:Delete");
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("alertdialog", { name: `Delete “Key ${u} by keyboard”?` });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  // The page behind the modal dialog is inert: Tab moves between the dialog's buttons and (in Chromium) the browser's
  // own controls, never to an element of the page behind it.
  await page.keyboard.press("Tab");
  expect(await focused(page)).toMatch(/^button:Delete/);
  for (let press = 0; press < 3; press += 1) {
    await page.keyboard.press("Tab");
    const outside = await page.evaluate(() => {
      const element = document.activeElement;
      const dialog = document.querySelector("dialog[open]");
      return element !== null && element !== document.body && dialog?.contains(element) !== true;
    });
    expect(outside, "focus left the modal dialog for the page behind it").toBe(false);
  }
  await confirm.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(main.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  expect((await owner.get<{ id: string }>(`/admin/products/${product.id}`)).id, "not deleted").toBe(
    product.id,
  );
});

test("two arrow keys faster than the router: the selected tab follows the focus", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const product = await createDraft(owner, u);
  await signIn("manager");
  await page.goto(`${SPA}/products/${product.id}?tab=stock`);
  const main = page.getByRole("main");
  await expect(main.getByRole("tab", { name: "Stock" })).toHaveAttribute("aria-selected", "true");
  await main.getByRole("tab", { name: "Stock" }).focus();
  // ArrowRight (to General, wrapping) and ArrowLeft (back to Stock) in one task: the second key press arrives before the
  // first tab switch (a navigation of the query string) has reached the tab list, as with a fast typist or key repeat.
  await page.evaluate(() => {
    const press = (key: string) =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    press("ArrowRight");
    press("ArrowLeft");
  });
  expect(await focused(page)).toBe("tab:Stock");
  await expect(page).toHaveURL(/[?&]tab=stock/);
  await expect(main.getByRole("tab", { name: "Stock" })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByRole("tabpanel", { name: "Stock" })).toBeVisible();
});

test("keyboard only: the focus lands on the page heading after sign-in and after a navigation, and stays on the language button", async ({
  page,
}) => {
  // Sign-in from a deep link with the keyboard: the requested page's heading gets the focus (the shell's first render
  // after the sign-in page is a navigation; the products area is a lazy chunk with lazy message files).
  await page.goto(`${SPA}/products`);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to the admin" })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).focus();
  await page.keyboard.type(CREDENTIALS.manager.email);
  await page.keyboard.press("Tab");
  await page.keyboard.type(CREDENTIALS.manager.password);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect.poll(() => focused(page)).toBe("h1:Products");

  // A side navigation link activated with Enter: the new area's heading, not `main` and not the link.
  const navigation = page.getByRole("navigation", { name: "Admin sections" });
  await navigation.getByRole("link", { name: "Customers" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect.poll(() => focused(page)).toBe("h1:Customers");
  // The heading is focusable by script only: Tab goes on from it into the page.
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toHaveAttribute(
    "tabindex",
    "-1",
  );

  // The language switch keeps the focus on the pressed button while the texts load and after.
  const ukrainian = page.getByRole("button", { name: "Українська" });
  await ukrainian.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Покупці" })).toBeVisible();
  await expect(ukrainian).toHaveAttribute("aria-pressed", "true");
  expect(await focused(page)).toBe("button:Українська");
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("button:English");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  expect(await focused(page)).toBe("button:English");
});
