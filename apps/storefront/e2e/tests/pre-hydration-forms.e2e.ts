import { expect, test, uniqueEmail } from "../support/fixtures.ts";
import { waitForHydration } from "../support/flows.ts";

const SECRET = "S3cret-Passw0rd!";

/** The form labels per locale (`src/messages/<locale>/account.json`, `account.field.*`). */
const LABELS = {
  en: {
    email: "Email",
    password: "Password",
    firstName: "First name",
    lastName: "Last name",
    phone: /^Phone/,
  },
  uk: {
    email: "Електронна пошта",
    password: "Пароль",
    firstName: "Ім’я",
    lastName: "Прізвище",
    phone: /^Телефон/,
  },
} as const;

/** Every URL a page or request touched must be free of the secret and of the email (query string, path, fragment). */
function leaks(urls: readonly string[], email: string): string[] {
  return urls.filter(
    (url) =>
      /password=|S3cret|firstName=|phone=/i.test(url) ||
      url.includes(encodeURIComponent(email)) ||
      url.includes(email),
  );
}

test.describe("before hydration, nothing personal reaches a URL (review H1)", () => {
  test.describe("JavaScript off: the browser submits natively", () => {
    test.use({ javaScriptEnabled: false });

    for (const locale of ["en", "uk"] as const) {
      const label = LABELS[locale];

      test(`${locale}: the sign-in form posts, the address stays clean and the page comes back`, async ({
        page,
      }, testInfo) => {
        const email = uniqueEmail(testInfo, `nojs-login-${locale}`);
        const urls: string[] = [];
        const statuses: number[] = [];
        page.on("request", (request) => urls.push(request.url()));
        page.on("framenavigated", (frame) => urls.push(frame.url()));
        page.on("response", (response) => {
          if (response.request().resourceType() === "document") statuses.push(response.status());
        });
        await page.goto(`/${locale}/account/login`);
        await page.getByLabel(label.email, { exact: true }).fill(email);
        await page.getByLabel(label.password, { exact: true }).fill(SECRET);
        await page.getByLabel(label.password, { exact: true }).press("Enter");
        await page.waitForLoadState("load");
        await expect.poll(() => statuses.length).toBeGreaterThanOrEqual(2);

        expect(leaks(urls, email)).toEqual([]);
        expect(page.url()).toMatch(new RegExp(`/${locale}/account/login$`));
        expect(
          statuses.every((status) => status < 500),
          `statuses ${statuses.join(",")}`,
        ).toBe(true);
        // The response never echoes what was sent.
        const html = await page.content();
        expect(html).not.toContain(SECRET);
        expect(html).not.toContain(email);
      });

      // In uk the header and the form are longer (two bytes per Cyrillic letter): the form must still be in the first HTML,
      // not outlined behind the loading view (README, "Keep the header small").
      test(`${locale}: the register form posts too (email, password, name and phone stay out of the URL)`, async ({
        page,
      }, testInfo) => {
        const email = uniqueEmail(testInfo, `nojs-register-${locale}`);
        const urls: string[] = [];
        page.on("request", (request) => urls.push(request.url()));
        page.on("framenavigated", (frame) => urls.push(frame.url()));
        await page.goto(`/${locale}/account/register`);
        await page.getByLabel(label.email, { exact: true }).fill(email);
        await page.getByLabel(label.password, { exact: true }).fill(SECRET);
        await page.getByLabel(label.firstName, { exact: true }).fill("Olena");
        await page.getByLabel(label.lastName, { exact: true }).fill("Petrenko");
        await page.getByLabel(label.phone).fill("+380501112233");
        await page.getByLabel(label.phone).press("Enter");
        await page.waitForLoadState("load");

        expect(leaks(urls, email)).toEqual([]);
        expect(page.url()).toMatch(new RegExp(`/${locale}/account/register$`));
        const html = await page.content();
        expect(html).not.toContain(SECRET);
        expect(html).not.toContain(email);
      });
    }
  });

  test("scripts delayed: a submit before hydration puts nothing in a URL or a Referer", async ({
    page,
  }, testInfo) => {
    const email = uniqueEmail(testInfo, "late-js");
    const urls: string[] = [];
    const referers: string[] = [];
    page.on("request", (request) => {
      urls.push(request.url());
      const referer = request.headers()["referer"];
      if (referer !== undefined) referers.push(referer);
    });
    page.on("framenavigated", (frame) => urls.push(frame.url()));
    // Hold every script of the page back, so the form is on screen but not yet alive.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/_next/static/**/*.js", async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto("/en/account/login", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(SECRET);
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page.waitForLoadState("domcontentloaded");
    release();
    await page.waitForLoadState("load");
    await waitForHydration(page);
    // Requests the hydrated page makes (cart, session) must not carry a dirty Referer either.
    await expect.poll(() => referers.length).toBeGreaterThan(0);

    expect(leaks(urls, email)).toEqual([]);
    expect(leaks(referers, email)).toEqual([]);
    expect(page.url()).toMatch(/\/en\/account\/login$/);
  });
});

// UX round 2, batch 3A item 6: an early tap on "Add to cart" posted the form natively and reloaded the page with nothing added.
test.describe("the product page's buy button before hydration", () => {
  for (const locale of ["en", "uk"] as const) {
    const add = locale === "en" ? "Add to cart" : "Додати до кошика";
    const hint =
      locale === "en"
        ? "To add this product to the cart, turn on JavaScript in your browser."
        : "Щоб додати товар до кошика, увімкніть JavaScript у браузері.";

    test(`${locale}: scripts delayed: the button is disabled until the page is alive, then adds`, async ({
      page,
    }) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/_next/static/**/*.js", async (route) => {
        await gate;
        await route.continue();
      });
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      await page.goto(`/${locale}/p/demo-screwdriver`, { waitUntil: "domcontentloaded" });
      const button = page.getByRole("button", { name: add, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute("data-ready", "false");
      // A tap now does nothing: no native post, no reload.
      await button.click({ force: true });
      expect(navigations).toHaveLength(1);

      release();
      await page.waitForLoadState("load");
      // Enabled only by the island's own effect: the signal that it hydrated (the cart badge helper reads English only).
      await expect(button).toBeEnabled();
      await expect(button).not.toHaveAttribute("data-ready");
      await button.click();
      await expect(
        page
          .getByRole("status")
          .getByText(locale === "en" ? "Added to the cart." : "Додано до кошика."),
      ).toBeVisible();
    });

    test(`${locale}: JavaScript off: the page still renders, the button is disabled and a line says why`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      const page = await context.newPage();
      await page.goto(`/${locale}/p/demo-screwdriver`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: add, exact: true })).toBeDisabled();
      await expect(page.getByText(hint, { exact: true })).toBeVisible();
      await context.close();
    });
  }
});
