import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";

/**
 * Repair batch 2 (plan docs/plans/2026-11-06-storefront-shop-pages.md): the shop pages of `config/shop-pages.ts` (delivery and
 * payment, returns, FAQ, about, size guide, contacts) behind one route, the contacts of `config/contacts.ts` in the footer and on
 * the contacts page, the trust bar's contact line as a link, and the product page's delivery note. uk and en, keyboard, 390 and
 * 1280 px. The contrast of the pages in dark is part of `design-b.e2e.ts`.
 */

const PAGES = {
  en: [
    { slug: "delivery-and-payment", title: "Delivery and payment", footer: true },
    { slug: "returns", title: "Returns and exchanges", footer: true },
    { slug: "faq", title: "Frequently asked questions", footer: true },
    { slug: "about", title: "About us", footer: true },
    { slug: "size-guide", title: "Size guide", footer: false },
    { slug: "contacts", title: "Contacts", footer: true },
  ],
  uk: [
    { slug: "delivery-and-payment", title: "Доставка й оплата", footer: true },
    { slug: "returns", title: "Повернення та обмін", footer: true },
    { slug: "faq", title: "Питання й відповіді", footer: true },
    { slug: "about", title: "Про нас", footer: true },
    { slug: "size-guide", title: "Таблиця розмірів", footer: false },
    { slug: "contacts", title: "Контакти", footer: true },
  ],
} as const;

const FOOTER_NAV = { en: "Footer navigation", uk: "Навігація внизу сторінки" } as const;

const sideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const locale of ["en", "uk"] as const) {
  test(`${locale}: every shop page is reachable from the footer or a page link, has one h1, its title and canonical`, async ({
    page,
  }) => {
    await page.goto(`/${locale}`);
    const footer = page.getByRole("contentinfo");
    const nav = footer.getByRole("navigation", { name: FOOTER_NAV[locale] });
    for (const entry of PAGES[locale]) {
      const link = nav.getByRole("link", { name: entry.title, exact: true });
      if (entry.footer) await expect(link).toHaveAttribute("href", `/${locale}/${entry.slug}`);
      else await expect(link).toHaveCount(0);
    }
    for (const entry of PAGES[locale].filter((item) => item.footer)) {
      await page.goto(`/${locale}`);
      await nav.getByRole("link", { name: entry.title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/${entry.slug}$`));
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1, name: entry.title })).toBeVisible();
      await expect(page).toHaveTitle(new RegExp(`^${entry.title}`));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        new RegExp(`/${locale}/${entry.slug}$`),
      );
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
      // Breadcrumbs: home, then the page.
      const crumbs = page.getByRole("navigation", {
        name: locale === "en" ? "Breadcrumb" : "Навігаційний ланцюжок",
      });
      await expect(crumbs.getByRole("link")).toHaveAttribute("href", `/${locale}`);
    }
    // The size guide is not in the footer: the FAQ links it ("See also").
    await page.goto(`/${locale}/faq`);
    const guide = PAGES[locale].find((item) => item.slug === "size-guide");
    await page.getByRole("main").getByRole("link", { name: guide?.title, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: guide?.title })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });

  test(`${locale}: the contacts show in the footer and on the contacts page; the parts the shop did not set are hidden`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/contacts`);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "+380 00 000 00 00" })).toHaveAttribute(
      "href",
      "tel:+380000000000",
    );
    await expect(footer.getByRole("link", { name: "shop@example.com" })).toHaveAttribute(
      "href",
      "mailto:shop@example.com",
    );
    const main = page.getByRole("main");
    await expect(main.getByRole("link", { name: "+380 00 000 00 00" })).toBeVisible();
    await expect(main.getByRole("link", { name: "shop@example.com" })).toBeVisible();
    await expect(main.getByText(locale === "en" ? "Opening hours" : "Графік роботи")).toBeVisible();
    await expect(
      main.getByText(
        locale === "en" ? "1 Prykladna St, Kyiv 01001" : "вул. Прикладна, 1, Київ, 01001",
      ),
    ).toBeVisible();
    // Master sets no messenger and no map link: no label without a value.
    await expect(
      main.getByText(locale === "en" ? "Messengers and social media" : "Месенджери та соцмережі"),
    ).toHaveCount(0);
    await expect(
      main.getByRole("link", { name: locale === "en" ? "Show on the map" : "Показати на мапі" }),
    ).toHaveCount(0);
  });

  test(`${locale}: the FAQ opens and closes with the keyboard`, async ({ page }) => {
    await page.goto(`/${locale}/faq`);
    const question = locale === "en" ? "How do I place an order?" : "Як оформити замовлення?";
    const summary = page.locator("summary", { hasText: question });
    const answer = page.getByRole("region", { name: question });
    await expect(answer).toBeHidden();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(answer).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: question })).toBeVisible();
    await page.keyboard.press("Space");
    await expect(answer).toBeHidden();
    // Tab moves on to the next question (no trap, nothing in between).
    await page.keyboard.press("Tab");
    await expect(page.getByRole("main").locator("summary").nth(1)).toBeFocused();
  });
}

test("an unknown or removed shop page is a real 404, a known one is 200", async ({ page }) => {
  for (const path of ["/en/shipping", "/uk/no-such-page", "/en/FAQ"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Page not found|Сторінку не знайдено/,
    );
  }
  const ok = await page.goto("/en/returns");
  expect(ok?.status()).toBe(200);
});

test("the trust bar's contact line and the product page's delivery note link to the shop pages", async ({
  page,
}) => {
  await page.goto("/en/p/demo-t-shirt");
  const trust = page.getByRole("list", { name: "About your purchase" });
  await expect(trust.getByRole("link", { name: "Easy to contact us" })).toHaveAttribute(
    "href",
    "/en/contacts",
  );
  const note = page.locator("[data-product-note]");
  await expect(note).toContainText("Delivery and returns");
  await expect(note).toContainText("Delivery across Ukraine in 1–3 days after dispatch.");
  await expect(note.getByRole("link", { name: "Delivery and payment" })).toHaveAttribute(
    "href",
    "/en/delivery-and-payment",
  );
  await note.getByRole("link", { name: "Returns and exchanges" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Returns and exchanges" }),
  ).toBeVisible();
  // Home trust section, uk: the same link.
  await page.goto("/uk");
  await expect(
    page.getByRole("main").getByRole("link", { name: "Легко зв’язатися з нами" }),
  ).toHaveAttribute("href", "/uk/contacts");
});

for (const width of [390, 1280] as const) {
  test(`${String(width)} px: no shop page, and no home footer, scrolls sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const locale of ["en", "uk"] as const) {
      for (const entry of PAGES[locale]) {
        await page.goto(`/${locale}/${entry.slug}`);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(await sideways(page), `${locale} ${entry.slug}`).toBeLessThanOrEqual(0);
      }
      await page.goto(`/${locale}`);
      await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
      expect(await sideways(page), `${locale} home`).toBeLessThanOrEqual(0);
    }
  });
}

test("the demo shows no developer note: no TODO marker, source path or bracketed placeholder on the visited pages", async ({
  page,
}) => {
  for (const path of [
    "/uk",
    "/en",
    "/uk/legal/privacy",
    "/en/legal/terms",
    "/uk/legal/cookies",
    "/uk/faq",
    "/en/p/demo-t-shirt",
  ]) {
    await page.goto(path);
    const text = await page.locator("body").innerText();
    expect(text, path).not.toMatch(/TODO|fluxkit\)|src\/config|\[[^\]]*\]/);
  }
});
