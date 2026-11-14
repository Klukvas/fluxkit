import type { Page } from "@playwright/test";
import { AdminApi } from "../support/api.ts";
import { SPA } from "../support/env.ts";
import { CREDENTIALS, expect, test, unique } from "../support/fixtures.ts";

const SIDEBAR_KEY = "fluxkit.admin.sidebarCollapsed";
const sections = (page: Page) =>
  page.getByRole("navigation", { name: "Admin sections", exact: true });
const account = (page: Page) => page.getByRole("button", { name: "Account menu", exact: true });
const collapse = (page: Page) => page.getByRole("button", { name: "Collapse panel", exact: true });
const expand = (page: Page) => page.getByRole("button", { name: "Expand panel", exact: true });

test("desktop: pointer and keyboard toggle, retained link names, current page and persistence", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await expect(collapse(page)).toHaveAttribute("aria-controls", "admin-navigation-desktop");
  await expect(collapse(page)).toHaveAttribute("aria-expanded", "true");
  await expect(sections(page).getByRole("link", { name: "Start", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await collapse(page).click();
  await expect(expand(page)).toBeFocused();
  await expect(expand(page)).toHaveAttribute("aria-expanded", "false");
  const products = sections(page).getByRole("link", { name: "Products", exact: true });
  await expect(products.locator(".sr-only")).toHaveText("Products");
  await products.click();
  await expect(
    page.getByRole("heading", { name: "Products", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(products).toHaveAttribute("aria-current", "page");
  await expect(
    sections(page).getByRole("link", { name: "Start", exact: true }),
  ).not.toHaveAttribute("aria-current");
  await page.reload();
  await expect(expand(page)).toBeVisible();
  await expand(page).focus();
  await page.keyboard.press("Space");
  await expect(collapse(page)).toBeFocused();
  await expect(products.locator(".sr-only")).toHaveCount(0);
  await page.reload();
  await expect(collapse(page)).toBeVisible();
});

for (const denial of ["accessor", "read", "write"] as const) {
  test(`storage ${denial} denial keeps the navigation expanded`, async ({ page, signIn }) => {
    await page.addInitScript(
      ({ denial, key }) => {
        if (denial === "accessor") {
          Object.defineProperty(window, "localStorage", {
            get() {
              throw new DOMException("Blocked", "SecurityError");
            },
          });
        } else {
          const method = denial === "read" ? "getItem" : "setItem";
          const getItem = Storage.prototype.getItem;
          const setItem = Storage.prototype.setItem;
          Object.defineProperty(Storage.prototype, method, {
            value: function (this: Storage, name: string, value?: string) {
              if (name === key) throw new DOMException("Blocked", "SecurityError");
              return method === "getItem"
                ? getItem.call(this, name)
                : setItem.call(this, name, value ?? "");
            },
          });
        }
      },
      { denial, key: SIDEBAR_KEY },
    );
    await signIn("owner");
    await expect(collapse(page)).toHaveAttribute("aria-expanded", "true");
    if (denial !== "read") {
      await collapse(page).click();
      await expect(collapse(page)).toHaveAttribute("aria-expanded", "true");
    }
    await expect(sections(page).getByRole("link", { name: "Products", exact: true })).toBeVisible();
  });
}

test("mobile ignores saved collapse, closes on same-page navigation and Escape, and restores desktop choice", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await collapse(page).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: /^(Menu|Close the menu)$/ });
  await expect(sections(page)).toHaveCount(0);
  await expect(account(page)).toBeHidden();
  await menu.click();
  await expect(sections(page)).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Help", exact: true })).toHaveCount(1);
  await expect(
    sections(page).getByRole("link", { name: "Start", exact: true }).locator(".sr-only"),
  ).toHaveCount(0);
  await expect(expand(page)).toHaveCount(0);
  await sections(page).getByRole("link", { name: "Start", exact: true }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await sections(page).getByRole("link", { name: "Products", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(expand(page)).toBeVisible();
  await expect(sections(page)).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Help", exact: true })).toHaveCount(1);
});

test("short desktop: pinned Help, independent scroll, top-layer hover and focus tooltips with Escape", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.setViewportSize({ width: 1024, height: 480 });
  await collapse(page).click();
  const help = page
    .getByRole("navigation", { name: "Help", exact: true })
    .getByRole("link", { name: "Help", exact: true });
  await expect(help).toBeInViewport();
  await expect(expand(page)).toBeInViewport();
  const users = sections(page).getByRole("link", { name: "Admin users", exact: true });
  await users.scrollIntoViewIfNeeded();
  await users.hover();
  const tooltip = users.locator("..").locator("[popover]");
  await expect(tooltip).toBeVisible();
  expect(await tooltip.evaluate((element) => element.matches(":popover-open"))).toBe(true);
  const sidebarBox = await page.locator("#admin-navigation-desktop").boundingBox();
  const tooltipBox = await tooltip.boundingBox();
  if (!sidebarBox || !tooltipBox) throw new Error("Missing sidebar/tooltip geometry");
  expect(tooltipBox.x + tooltipBox.width).toBeGreaterThan(sidebarBox.x + sidebarBox.width);
  await page.mouse.move(tooltipBox.x + tooltipBox.width / 2, tooltipBox.y + tooltipBox.height / 2);
  await expect(tooltip).toBeVisible();
  await page.mouse.move(900, 450);
  await expect(tooltip).toBeHidden();
  await users.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();
  await expect(users).toBeFocused();
  await help.focus();
  const helpTooltip = help.locator("..").locator("[popover]");
  await expect(helpTooltip).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(helpTooltip).toBeHidden();
});

test("RTL tooltips follow the inline end and remain in the viewport", async ({ page, signIn }) => {
  await signIn("owner");
  await page.locator("html").evaluate((element) => element.setAttribute("dir", "rtl"));
  await collapse(page).click();
  const home = sections(page).getByRole("link", { name: "Start", exact: true });
  await home.focus();
  const tooltip = home.locator("..").locator("[popover]");
  await expect(tooltip).toBeVisible();
  const linkBox = await home.boundingBox();
  const popupBox = await tooltip.boundingBox();
  if (!linkBox || !popupBox) throw new Error("Missing RTL geometry");
  expect(popupBox.x).toBeGreaterThanOrEqual(0);
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(linkBox.x + 1);
});

test("account disclosure: native Tab order, Escape focus, outside pointer/focus and account navigation", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await account(page).focus();
  await page.keyboard.press("Enter");
  await expect(account(page)).toBeFocused();
  await expect(page.getByText(`Signed in as ${CREDENTIALS.owner.email}`)).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "My account", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(account(page)).toBeFocused();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
  await account(page).click();
  await page.getByRole("heading", { name: "Start", level: 1, exact: true }).click();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
  await account(page).click();
  await page.getByRole("button", { name: "English", exact: true }).focus();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
  await account(page).click();
  await page.getByRole("link", { name: "My account", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${SPA}/account$`));
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
});

test("My account navigation from a dirty form: Stay restores visible header focus and keeps input", async ({
  page,
  signIn,
  owner,
}, testInfo) => {
  const u = unique(testInfo);
  const brand = await owner.post<{ id: string }>("/admin/brands", {
    name: { uk: `Обліковий запис ${u}`, en: `Account ${u}` },
    slug: `account-${u}`,
  });
  await signIn("manager");
  await page.goto(`${SPA}/catalog/brands/${brand.id}`);
  const english = page
    .getByRole("main")
    .getByRole("textbox", { name: "Name (English)", exact: true });
  await expect(english).toHaveValue(`Account ${u}`);
  await english.fill(`Account ${u} typed`);
  await account(page).click();
  const myAccount = page.getByRole("banner").getByRole("link", { name: "My account", exact: true });
  await myAccount.click();
  const leave = page.getByRole("alertdialog", { name: "Leave this page?" });
  await expect(leave.getByRole("button", { name: "Stay", exact: true })).toBeFocused();
  await leave.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(leave).toBeHidden();
  await expect(myAccount).toBeVisible();
  await expect(myAccount).toBeFocused();
  await expect(account(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(new RegExp(`${SPA}/catalog/brands/${brand.id}$`));
  await expect(english).toHaveValue(`Account ${u} typed`);
});

test("mobile account: nested Escape and hiding the Menu dismiss stale disclosures", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: /^(Menu|Close the menu)$/ });
  await menu.click();
  await account(page).click();
  await page.getByRole("link", { name: "My account", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(account(page)).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click();
  await account(page).click();
  await menu.click();
  await expect(account(page)).toBeHidden();
  await menu.click();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
  await account(page).click();
  await menu.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
});

test("long account email wraps without horizontal overflow", async ({ page, owner }, testInfo) => {
  const email = `${"a".repeat(48)}${unique(testInfo)}@example.com`;
  const password = "shell-long-email-password-0123";
  await owner.createUser(email, "viewer", password);
  await AdminApi.signIn(page.request, email, password);
  await page.goto(`${SPA}/`);
  await account(page).click();
  const emailText = page.getByText(`Signed in as ${email}`, { exact: true });
  await expect(emailText).toBeVisible();
  expect(await emailText.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
    true,
  );
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
});

test("failed sign-out shows an alert outside the disclosure; pending sign-out sends one request", async ({
  page,
  signIn,
}) => {
  await signIn("owner");
  let requests = 0;
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/admin/auth/logout", async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({
      status: 500,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Error",
        status: 500,
        code: "internal_error",
        detail: "Injected shell test failure",
      }),
    });
  });
  try {
    await account(page).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    const busy = page.getByRole("button", { name: "Signing out…", exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect.poll(() => requests).toBe(1);
  } finally {
    release();
  }
  const alert = page.getByRole("alert").filter({ hasText: "The server failed." });
  await expect(alert).toBeVisible();
  await account(page).click();
  await expect(account(page)).toHaveAttribute("aria-expanded", "false");
  await expect(alert).toBeVisible();
  expect(requests).toBe(1);
});
