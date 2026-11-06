import type { Page } from "@playwright/test";
import { E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";
import { tabTo } from "../support/flows.ts";

/**
 * Home banners managed in the admin (plan `docs/plans/2026-11-05-admin-home-banners.md`, PR 3): the template's `banners`
 * section reads `GET /store/banners` (`source: "admin"`) and `pnpm seed` (run by `prepare-database.ts`) created three demo
 * banners: two `card` banners and one `image` banner with an own `en` picture. Each banner is one link; every picture sits
 * in a fixed 2:1 frame; one column on phones, one row from 768 px. The dark contrast walk of the home page, with the
 * banners, is in `design-b.e2e.ts`.
 *
 * Pictures on this stack: the API's media URLs are `http://127.0.0.1:<proxy>/media/...`, and the built storefront shows only
 * `https` URLs of `STOREFRONT_IMAGE_HOSTS` (the same rule as product images, `media-route.e2e.ts`), so every banner shows
 * the token placeholder here: named by the alt text when there is one, hidden when the picture is decorative. Which
 * picture a locale gets is decided by the API; the test reads it from the same route the page reads, and the unit tests
 * (`home-sections.spec.tsx`) prove that the page renders the URL it is given.
 */

const DESKTOP = { width: 1280, height: 800 };
test.use({ viewport: DESKTOP });

const banners = (page: Page) => page.getByRole("main").locator('[data-home-section="banners"]');

const SEEDED = {
  en: [
    {
      name: "New this season",
      description: "Fresh arrivals from the catalog in one place.",
      href: "/en/catalog",
      picture: "Shopping bags and a price tag",
    },
    {
      name: "Gift ideas",
      description: "Browse the catalog by category to find a gift.",
      href: "/en/c/demo-clothing",
      picture: null,
    },
  ],
  enImage: { name: "New collection. See what is new in the catalog", href: "/en/catalog" },
  uk: ["Новинки сезону", "Ідеї для подарунків", "Нова колекція. Дивіться новинки в каталозі"],
} as const;

test("the seeded banners sit between the hero and the categories: two cards and one picture banner, each one link", async ({
  page,
}) => {
  await page.goto("/en");
  const section = banners(page);
  await expect(section).toBeVisible();
  await expect(page.getByRole("region", { name: "Offers" })).toBeVisible();
  const order = await page
    .locator("main [data-hero], main [data-home-section]")
    .evaluateAll((elements) =>
      elements.map((element) =>
        element.hasAttribute("data-hero") ? "hero" : element.getAttribute("data-home-section"),
      ),
    );
  expect(order.slice(0, 3)).toEqual(["hero", "banners", "categories"]);

  await expect(section.getByRole("link")).toHaveCount(3);
  expect(
    await section
      .locator("li")
      .evaluateAll((items) => items.map((item) => item.getAttribute("data-banner-layout"))),
  ).toEqual(["card", "card", "image"]);

  for (const banner of SEEDED.en) {
    const link = section.getByRole("link", { name: banner.name, exact: true });
    await expect(link).toHaveAttribute("href", banner.href);
    await expect(link).toHaveAccessibleDescription(banner.description);
    await expect(link.getByRole("heading", { level: 3, name: banner.name })).toBeVisible();
    if (banner.picture === null) {
      // A card without alt text: a decorative picture, hidden from assistive technology.
      await expect(link.getByRole("img")).toHaveCount(0);
    } else {
      await expect(link.getByRole("img", { name: banner.picture })).toBeVisible();
    }
  }
  // The picture banner: the picture alone, named by its alt text; no heading, no text.
  const image = section.getByRole("link", { name: SEEDED.enImage.name, exact: true });
  await expect(image).toHaveAttribute("href", SEEDED.enImage.href);
  await expect(image.getByRole("heading")).toHaveCount(0);
  await expect(image).toHaveText("");

  // The whole card is the target: its picture opens the link too.
  await section.getByRole("link", { name: "Gift ideas" }).locator('[class*="aspect-2/1"]').click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/en/c/demo-clothing`);
});

test("each locale gets its texts, and the picture banner its own en picture (the API's answer the page reads)", async ({
  page,
}) => {
  await page.goto("/uk");
  const section = banners(page);
  for (const name of SEEDED.uk) {
    await expect(section.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(section.getByRole("link", { name: "Новинки сезону" })).toHaveAttribute(
    "href",
    "/uk/catalog",
  );
  type Answer = { items: { layout: string; image: { url: string; alt: string | null } }[] };
  const read = async (locale: string) =>
    (await (await page.request.get(`/store/banners?locale=${locale}`)).json()) as Answer;
  const [uk, en] = [await read("uk"), await read("en")];
  expect(uk.items.map((item) => item.layout)).toEqual(["card", "card", "image"]);
  expect(en.items[2]?.image.url).not.toBe(uk.items[2]?.image.url);
  expect(en.items[0]?.image.url).toBe(uk.items[0]?.image.url);
  expect([uk.items[2]?.image.alt, en.items[2]?.image.alt]).toEqual([
    SEEDED.uk[2],
    SEEDED.enImage.name,
  ]);
});

// Not tested without a script: the home page is outlined by React's streaming (its content needs the script; storefront
// README, "Keep the header small"), before and after this change.
test("a banner opens by keyboard, with a visible focus ring", async ({ page }) => {
  await page.goto("/uk");
  const image = banners(page).getByRole("link", { name: SEEDED.uk[2] });
  await tabTo(page, image, 60);
  await expect(image).toBeFocused();
  const outline = await image.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${E2E_ORIGIN}/uk/catalog`);
});

for (const width of [390, 768, 1024, 1280]) {
  test(`the banners fit ${String(width)} px without sideways scrolling: ${width < 768 ? "one column" : "one row"}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/uk");
    const cards = banners(page).locator("li");
    await expect(cards).toHaveCount(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const boxes = await cards.evaluateAll((items) =>
      items.map((item) => item.getBoundingClientRect().toJSON() as DOMRect),
    );
    const [first, second, third] = boxes as [DOMRect, DOMRect, DOMRect];
    if (width < 768) {
      expect(second.x).toBeCloseTo(first.x, 0);
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
      expect(third.y).toBeGreaterThanOrEqual(second.y + second.height);
    } else {
      expect(second.y).toBeCloseTo(first.y, 0);
      expect(third.y).toBeCloseTo(first.y, 0);
      expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    }
    // Every picture keeps its 2:1 frame (the reserved size), whatever the upload's own size, so nothing moves.
    const frames = banners(page).locator('[class*="aspect-2/1"]');
    await expect(frames).toHaveCount(3);
    for (const frame of await frames.all()) {
      const box = await frame.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(2, 1);
      expect(box?.width ?? 0).toBeLessThanOrEqual(width);
    }
  });
}

/** A 1x1 PNG (70 bytes), as in `media-route.e2e.ts`; the API re-encodes it. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The admin API -> storefront path. The storefront reads `GET /store/banners` through the Next data cache for 60 s
 * (`CATALOG_REVALIDATE_SECONDS`, the staleness the plan accepts), and the earlier tests of this file have filled that cache.
 * Nothing in the template revalidates by tag, and the test does not reach into the server's cache: it reloads the page until
 * the new banner shows, which takes at most the rest of the 60 s plus one reload (the first request after the window serves
 * the old copy and refreshes it in the background). That proves the delay is bounded, without a test-only switch in the
 * product code. The banners not live now are checked on the same page: it was rendered from the same fresh answer.
 */
test("a banner created through the admin API shows within the cache window; an inactive, a future and an expired one never do", async ({
  page,
  admin,
}, testInfo) => {
  test.setTimeout(180_000);
  const suffix = `${String(testInfo.retry)}-${testInfo.testId.slice(0, 6)}`;
  const day = 24 * 60 * 60 * 1000;
  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  const upload = await admin.uploadImage(PNG_1X1);
  const card = (title: string, extra: Record<string, unknown>) => ({
    layout: "card",
    title: { uk: title, en: title },
    imageUploadId: upload.id,
    link: "/catalog",
    ...extra,
  });
  const titles = {
    live: `E2E live banner ${suffix}`,
    inactive: `E2E inactive banner ${suffix}`,
    future: `E2E future banner ${suffix}`,
    expired: `E2E expired banner ${suffix}`,
  };
  const seededIds = (await admin.listBanners()).map((banner) => banner.id);
  const created: string[] = [];
  try {
    for (const body of [
      card(titles.live, { isActive: true, tone: "accent" }),
      card(titles.inactive, { isActive: false }),
      card(titles.future, { isActive: true, startsAt: at(day) }),
      card(titles.expired, { isActive: true, startsAt: at(-2 * day), endsAt: at(-day) }),
    ]) {
      created.push((await admin.createBanner(body)).id);
    }
    // First in the list, so the live one is among the 3 the shop shows (the seeded ones follow).
    await admin.reorderBanners([...created, ...seededIds]);

    const section = banners(page);
    await expect(async () => {
      await page.goto("/en");
      await expect(section.getByRole("link", { name: titles.live, exact: true })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 120_000, intervals: [3_000] });

    // At most 3: the new live banner, then the first two seeded ones; the seeded picture banner is now the 4th live one.
    const names = await section
      .getByRole("link")
      .evaluateAll((links) =>
        links.map((link) => link.querySelector("h3")?.textContent ?? link.textContent),
      );
    expect(names).toEqual([titles.live, "New this season", "Gift ideas"]);
    for (const hidden of [titles.inactive, titles.future, titles.expired]) {
      await expect(page.getByText(hidden)).toHaveCount(0);
    }
    await expect(section.getByRole("link", { name: SEEDED.enImage.name })).toHaveCount(0);
  } finally {
    for (const id of created) await admin.deleteBanner(id);
  }
});
