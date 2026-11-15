import type { Page } from "@playwright/test";
import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { chooseSort, openAccountMenu, waitForHydration } from "../support/flows.ts";

const PASSWORD = "a long modal e2e password 123";

async function openSignIn(page: Page, locale = "en") {
  await waitForHydration(page);
  await openAccountMenu(page, locale === "en" ? "Account menu" : "Меню акаунта");
  await page
    .getByRole("banner")
    .getByRole("link", { name: locale === "en" ? "Sign in" : "Увійти", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: locale === "en" ? "Sign in" : "Вхід",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

for (const width of [1280, 390]) {
  test(`header entry preserves the page, traps focus and supports Escape, Back and Forward at ${String(width)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/en/p/demo-e-book");
    const background = page.locator("main h1");
    await expect(background).toHaveText("Demo E-book");
    const before = await background.elementHandle();
    const dialog = await openSignIn(page);
    await expect(page).toHaveURL(/\/en\/account\/login$/);
    await expect(background).toHaveText("Demo E-book");
    expect(await before?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(dialog.getByRole("heading", { level: 1 })).toBeFocused();
    const labelledBy = await dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(await dialog.getByRole("heading", { level: 1 }).getAttribute("id")).toBe(labelledBy);
    for (const key of ["Tab", "Shift+Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      // Like the shared Dialog's keyboard regression: native Tab may visit browser controls
      // (activeElement becomes body), but must never focus the inert background page.
      const outside = await dialog.evaluate((element) => {
        const active = document.activeElement;
        return active !== null && active !== document.body && !element.contains(active);
      });
      expect(outside, "focus left the modal dialog for the page behind it").toBe(false);
    }
    expect(
      await page.locator("html").evaluate((element) => getComputedStyle(element).overflow),
    ).toBe("hidden");
    await page.mouse.click(1, 1);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/en\/p\/demo-e-book$/);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Account menu" }),
    ).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Account menu" }),
    ).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Account menu" }),
    ).toBeFocused();
    expect(
      await page.locator("html").evaluate((element) => getComputedStyle(element).overflow),
    ).not.toBe("hidden");
    await page.goForward();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Account menu" }),
    ).toBeFocused();
    await page.goForward();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/p\/demo-e-book$/);
    await expect(dialog).toHaveCount(0);
  });
}

test("query-only Back before sign-in leaves dismissal correct after Forward reopening", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  await waitForHydration(page);
  await chooseSort(page, "Price: low to high");
  await expect(page).toHaveURL(/\/en\/catalog\?sort=price_asc$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/catalog$/);
  const dialog = await openSignIn(page);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/en\/catalog$/);
  await expect(dialog).toHaveCount(0);
  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/en\/catalog$/);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Account menu" }),
  ).toBeFocused();
});

for (const path of ["/en", "/en/catalog", "/en/delivery-and-payment"]) {
  test(`opens over ${path} and Register clears the slot`, async ({ page }) => {
    await page.goto(path);
    const dialog = await openSignIn(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect(page.locator("main")).toBeVisible();
    await dialog.getByRole("link", { name: "Create an account", exact: true }).click();
    await expect(page).toHaveURL(/\/en\/account\/register$/);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Create an account", exact: true }),
    ).toBeFocused();
  });
}

for (const width of [320, 360, 390]) {
  test(`Ukrainian dialog fits a short dark viewport at ${String(width)}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 480 });
    await context.addCookies([
      { name: "fluxkit_theme", value: "dark", domain: "127.0.0.1", path: "/" },
    ]);
    await page.goto("/uk/catalog");
    const dialog = await openSignIn(page, "uk");
    const box = await dialog.boundingBox();
    if (box === null) throw new Error("The visible dialog has no bounding box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeLessThanOrEqual(480);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const submit = dialog.getByRole("button", { name: "Увійти", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    const close = dialog.getByRole("button", { name: "Закрити", exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport();
    await close.click();
    await expect(dialog).toHaveCount(0);
  });
}

test("direct visits and reload keep the canonical full page, including next", async ({ page }) => {
  for (const path of ["/uk/account/login", "/en/account/login?next=%2Fen%2Fcheckout"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(await response?.text()).not.toMatch(/<dialog[\s>]/);
    await waitForHydration(page);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.locator("main #login-email")).toBeVisible();
  }
  // Activating the header link on the canonical login page never duplicates the form.
  await openAccountMenu(page);
  await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
  await waitForHydration(page);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.locator("#login-email")).toHaveCount(1);
  await page.goto("/en/catalog");
  await openSignIn(page);
  await page.reload();
  await waitForHydration(page);
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.locator("main #login-email")).toBeVisible();
});

test("failed sign-in keeps its error summary and focus inside the modal", async ({
  page,
}, testInfo) => {
  await page.goto("/en/catalog");
  const dialog = await openSignIn(page);
  const email = uniqueEmail(testInfo, "modal-refused");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill("not the correct password");
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  const message = dialog.getByText("The email or password is not correct.");
  await expect(message).toHaveCount(1);
  // `has` is relative to each candidate: a dialog-scoped locator would seek a nested dialog.
  const summary = dialog.locator('div[tabindex="-1"]').filter({
    has: page.getByRole("alert").filter({ hasText: "The email or password is not correct." }),
  });
  await expect(summary).toHaveCount(1);
  await expect(summary).toBeFocused();
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(email);
  await expect(dialog.locator('[aria-invalid="true"]')).toHaveCount(0);
});

for (const dismissal of ["Close", "Back"] as const) {
  test(`field-error link preserves history and account-summary focus after ${dismissal}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: dismissal === "Back" ? "reduce" : "no-preference" });
    await page.goto("/en/catalog?sort=price_asc");
    const origin = page.url();
    const dialog = await openSignIn(page);
    const loginUrl = page.url();
    const historyLength = await page.evaluate(() => window.history.length);
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    const emailLink = dialog.locator('a[href="#login-email"]');
    await expect(emailLink).toBeVisible();
    if (dismissal === "Back") {
      // Exercise an absolute same-document URL as well as the form's normal fragment-only href.
      await emailLink.evaluate((anchor) => {
        anchor.setAttribute("href", new URL("#login-email", window.location.href).href);
      });
    }
    await emailLink.click();
    await expect(dialog.getByLabel("Email", { exact: true })).toBeFocused();
    await expect(page).toHaveURL(loginUrl);
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
    if (dismissal === "Close") {
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
    } else {
      await page.goBack();
    }
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(origin);
    await expect(
      page.getByRole("banner").getByRole("button", { name: "Account menu" }),
    ).toBeFocused();
  });
}

test("Close can be retried when a legacy fragment entry retains the dialog after Back", async ({
  page,
}) => {
  await page.goto("/en/catalog");
  const origin = page.url();
  const dialog = await openSignIn(page);
  const loginUrl = page.url();
  // Simulate a pre-existing fragment entry; new in-dialog anchor activations no longer create one.
  await page.evaluate(() => {
    window.location.hash = "login-email";
  });
  await expect(page).toHaveURL(`${loginUrl}#login-email`);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(loginUrl);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(origin);
});

test("successful header sign-in uses the form destination and updates the shared header", async ({
  page,
  otherShopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "modal-success");
  await otherShopper.register(email, PASSWORD);
  await page.goto("/en/catalog");
  const dialog = await openSignIn(page);
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Account: Api" }),
  ).toBeVisible();
  await expect(page.locator("main h1")).toBeFocused();
});

test("history reopening after registration labels the already-signed-in view", async ({
  page,
}, testInfo) => {
  await page.goto("/en/catalog");
  const dialog = await openSignIn(page);
  await dialog.getByRole("link", { name: "Create an account", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(uniqueEmail(testInfo, "modal-register"));
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("First name", { exact: true }).fill("Mina");
  await page.getByLabel("Last name", { exact: true }).fill("Example");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await page.goBack();
  const signedIn = page.getByRole("dialog", { name: "You are signed in", exact: true });
  await expect(signedIn).toBeVisible();
  await expect(signedIn.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(signedIn.locator("#login-email")).toHaveCount(0);
  await signedIn.getByRole("link", { name: "Go to my account", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  await expect(signedIn).toHaveCount(0);
});

test("checkout sign-in preserves its explicit return destination", async ({
  page,
  otherShopper,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "modal-checkout");
  await otherShopper.register(email, PASSWORD);
  await page.goto("/en/p/demo-e-book");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /^Cart/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/en/checkout");
  await waitForHydration(page);
  const link = page.locator('main a[href="/en/account/login?next=%2Fen%2Fcheckout"]');
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Sign in", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Create an account" })).toHaveAttribute(
    "href",
    "/en/account/register?next=%2Fen%2Fcheckout",
  );
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/checkout$/);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Account: Api" }),
  ).toBeVisible();
});

test("Forgot password clears the slot and its login link opens it again", async ({ page }) => {
  await page.goto("/en/catalog");
  const dialog = await openSignIn(page);
  await dialog.getByRole("link", { name: "Forgot your password?", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/account\/forgot-password$/);
  await expect(dialog).toHaveCount(0);
  await page.locator('main a[href="/en/account/login"]').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/en\/account\/forgot-password$/);
  await expect(page.locator('main a[href="/en/account/login"]')).toBeFocused();
});

test("without JavaScript a direct login visit has the full form and no dialog", async ({
  browser,
  baseURL,
  extraHTTPHeaders,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, extraHTTPHeaders });
  try {
    const page = await context.newPage();
    const response = await page.goto("/uk/account/login");
    expect(response?.status()).toBe(200);
    await expect(page.locator("dialog")).toHaveCount(0);
    await expect(page.locator("main #login-email")).toBeVisible();
    await expect(page.locator('main form[method="post"]')).toHaveCount(1);
  } finally {
    await context.close();
  }
});
