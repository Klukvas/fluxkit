import type { Locator, Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { SHOP_NAME } from "../support/shop-name.ts";
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

interface TabStop {
  name: string;
  x: number;
  y: number;
}

/**
 * The header's Tab stops from the top of the page, in order, with their place on screen (a closed header). Waits for the
 * cart and account islands first, so a control still loading cannot change the sequence.
 */
async function headerTabStops(page: Page): Promise<TabStop[]> {
  await waitForHydration(page);
  const banner = page.getByRole("banner");
  await expect(banner.getByText("Loading the account", { exact: true })).toHaveCount(0);
  await expect(banner.getByText("Loading the cart", { exact: true })).toHaveCount(0);
  const stops: TabStop[] = [];
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element.closest("header") === null) return null;
      const label =
        element.getAttribute("aria-label") ??
        (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : null) ??
        element.textContent;
      const rect = element.getBoundingClientRect();
      return { name: (label ?? "").replace(/\s+/g, " ").trim(), x: rect.x, y: rect.y };
    });
    if (stop === null) {
      if (stops.length > 0) return stops;
      continue;
    }
    stops.push(stop);
  }
  throw new Error(`the focus never left the header: ${stops.map((stop) => stop.name).join(" > ")}`);
}

/** Left to right in Tab order, all in the one header row (the tops within a few pixels of each other). */
function expectOneRowInTabOrder(stops: readonly TabStop[]): void {
  const tops = stops.map((stop) => stop.y);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(24);
  for (const [index, stop] of stops.entries()) {
    if (index === 0) continue;
    const before = stops[index - 1];
    expect(stop.x, `${stop.name} after ${before?.name ?? ""}`).toBeGreaterThan(before?.x ?? 0);
  }
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
    // Anchored to the header row, not to the button, so a wider logo before it cannot push it off the screen.
    const row = await box(page.locator("header .fk-header-row"));
    expect(panel.x).toBe(row.x);
    expect(panel.x + panel.width).toBeLessThanOrEqual(row.x + row.width);

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

  test("the header reads logo, Categories, search, controls: the Tab order is the order on screen (owner's decision 2026-11-15)", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: "Menu", exact: true })).toBeHidden();
    const stops = await headerTabStops(page);
    const names = stops.map((stop) => stop.name);
    expect(names).toEqual([
      SHOP_NAME.en,
      "Categories",
      "Search products",
      "Search",
      "Site language: English",
      "Theme",
      "Cart0 items in the cart",
      "Account menu",
    ]);
    // One row, left to right, in Tab order.
    expectOneRowInTabOrder(stops);
    // One "Main navigation" at this width, and only while the picker is open.
    const nav = banner.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toHaveCount(0);
    await banner.getByRole("button", { name: "Categories", exact: true }).click();
    await expect(nav).toHaveCount(1);
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
    await expect(legal.getByRole("link", { name: "Cookie policy", exact: true })).toHaveAttribute(
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

  test("the header reads Menu, logo, then the icons: the Tab order is the order on screen, no Categories button", async ({
    page,
  }) => {
    await page.goto("/en");
    await waitForHydration(page);
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("button", { name: "Categories", exact: true })).toBeHidden();
    const stops = await headerTabStops(page);
    const names = stops.map((stop) => stop.name);
    expect(names).toEqual([
      "Menu",
      SHOP_NAME.en,
      "Search",
      "Site language: English",
      "Cart0 items in the cart",
      "Account menu",
    ]);
    expectOneRowInTabOrder(stops);
    const nav = banner.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toHaveCount(0);
    // Back to the menu button, open it by keyboard, and Tab goes into its list.
    const menu = banner.getByRole("button", { name: "Menu", exact: true });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(nav).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(nav.getByRole("link", { name: "Clothing", exact: true })).toBeFocused();
  });

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
