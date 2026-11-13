import type { Locator, Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { tabTo, waitForHydration } from "../support/flows.ts";

/**
 * Storefront UI round 4, part A (plan `docs/plans/2026-11-13-storefront-ui-round-4.md`): the header's "Categories" picker and
 * `theme` control (both native `<details>` disclosures: Tab, Enter, Escape with the focus back on the summary, an outside
 * click), the switch inside the phone menu, the theme icon that follows the resolved theme by CSS, and the footer columns.
 * The test fixture's categories: Clothing (Tops, Shirts), Tools, Digital goods.
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

async function box(locator: Locator): Promise<{ x: number; y: number; width: number }> {
  const value = await locator.boundingBox();
  if (value === null) throw new Error("no box");
  return value;
}

async function setTheme(page: Page, value: string): Promise<void> {
  await page.context().addCookies([{ name: "fluxkit_theme", value, url: E2E_ORIGIN }]);
}

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  test("the Categories picker opens by keyboard, lists the categories with their children, Escape closes it and returns the focus", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const banner = page.getByRole("banner");
    const picker = banner.getByRole("button", { name: "Categories", exact: true });
    const nav = banner.getByRole("navigation", { name: "Main navigation" });
    const clothing = nav.getByRole("link", { name: "Clothing", exact: true });
    // No inline row: the category links show only in the open panel.
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(clothing).toBeHidden();

    await tabTo(page, picker, 20);
    await page.keyboard.press("Enter");
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await expect(clothing).toHaveAttribute("href", "/en/c/demo-clothing");
    await expect(nav.getByRole("link", { name: "Tops", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tools", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Catalog", exact: true })).toBeVisible();
    // Plain links in lists, no menu roles; the panel stays inside the screen.
    await expect(banner.getByRole("menu")).toHaveCount(0);
    const panel = await box(page.locator("header details[open] > div"));
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(DESKTOP.width);

    // Tab goes into the panel, in reading order.
    await page.keyboard.press("Tab");
    await expect(clothing).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await expect(picker).toBeFocused();
    await expect(clothing).toBeHidden();

    // An outside click closes it as well; a link navigates and closes it.
    await picker.click();
    await expect(picker).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("main").click({ position: { x: 4, y: 4 } });
    await expect(picker).toHaveAttribute("aria-expanded", "false");
    await picker.click();
    await nav.getByRole("link", { name: "Tops", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/c\/demo-clothing-tops$/);
    await expect(picker).toHaveAttribute("aria-expanded", "false");
  });

  test("the theme control: Tab and Enter open it, a choice applies in place, Escape closes it and returns the focus", async ({
    page,
  }) => {
    await page.goto("/uk/catalog");
    await waitForHydration(page);
    const control = page.getByRole("banner").getByRole("button", { name: "Тема", exact: true });
    const group = page.getByRole("group", { name: "Тема" });
    await tabTo(page, control, 30);
    await page.keyboard.press("Enter");
    await expect(control).toHaveAttribute("aria-expanded", "true");
    await expect(group.getByRole("button")).toHaveCount(3);
    await tabTo(page, group.getByRole("button", { name: "Темна" }), 5);
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(group.getByRole("button", { name: "Темна" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The icon follows at once: the moon shows, the sun is hidden.
    await expect(control.locator(".fk-dark-only")).toBeVisible();
    await expect(control.locator(".fk-light-only")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await expect(control).toBeFocused();
    // The footer has no switch of its own in the template.
    await expect(page.getByRole("contentinfo").getByRole("button")).toHaveCount(0);
  });

  test("the theme icon shows the resolved theme without a script, the system mode following the device", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: E2E_ORIGIN,
      viewport: DESKTOP,
      javaScriptEnabled: false,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const control = page.getByRole("banner").getByRole("button", { name: "Theme", exact: true });
    await page.goto("/en");
    // System mode (no cookie) on a dark device: the moon.
    await expect(control.locator(".fk-dark-only")).toBeVisible();
    await expect(control.locator(".fk-light-only")).toBeHidden();
    await setTheme(page, "light");
    await page.reload();
    await expect(control.locator(".fk-light-only")).toBeVisible();
    await expect(control.locator(".fk-dark-only")).toBeHidden();
    await context.close();
  });

  test("the footer shows its link groups and the contacts as columns, each group a navigation named by its heading", async ({
    page,
  }) => {
    await page.goto("/en");
    const footer = page.getByRole("contentinfo");
    const shop = footer.getByRole("navigation", { name: "Customer service", exact: true });
    const legal = footer.getByRole("navigation", { name: "Legal", exact: true });
    await expect(shop.getByRole("heading", { level: 2, name: "Customer service" })).toBeVisible();
    await expect(legal.getByRole("link", { name: "Cookies", exact: true })).toHaveAttribute(
      "href",
      "/en/legal/cookies",
    );
    const contacts = footer.getByRole("heading", { level: 2, name: "Contacts", exact: true });
    await expect(contacts).toBeVisible();
    // Side by side from `lg`: one row of columns.
    const [shopBox, legalBox, contactsBox] = await Promise.all([
      box(shop),
      box(legal),
      box(contacts),
    ]);
    expect(shopBox.y).toBe(legalBox.y);
    expect(shopBox.x).toBeLessThan(legalBox.x);
    expect(legalBox.x).toBeLessThan(contactsBox.x);
    await expect(footer.getByText("Powered by FluxLab")).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: PHONE });

  test("the menu keeps the flat list, carries the theme switch, and the footer has two columns", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const banner = page.getByRole("banner");
    // The theme control leaves the phone's row (room for the logo); the menu's panel carries the switch.
    await expect(banner.getByRole("button", { name: "Theme", exact: true })).toBeHidden();
    const menu = banner.getByRole("button", { name: "Menu", exact: true });
    await tabTo(page, menu, 10);
    await page.keyboard.press("Enter");
    const nav = banner.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Clothing", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Tops", exact: true })).toBeHidden();
    const panel = await box(page.locator("header details[open] > div"));
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(PHONE.width);
    const group = banner.getByRole("group", { name: "Theme" });
    await group.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    const footer = page.getByRole("contentinfo");
    const shop = await box(footer.getByRole("navigation", { name: "Customer service" }));
    const legal = await box(footer.getByRole("navigation", { name: "Legal", exact: true }));
    const contacts = await box(footer.getByRole("heading", { level: 2, name: "Contacts" }));
    expect(shop.y).toBe(legal.y);
    expect(contacts.y).toBeGreaterThan(shop.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
});
