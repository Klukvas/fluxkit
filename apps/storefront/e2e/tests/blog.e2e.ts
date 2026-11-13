import type { Page } from "@playwright/test";
import { E2E_FEATURES, E2E_ORIGIN } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * The blog's storefront slice (plan docs/plans/2026-11-13-blog.md, PR 4b) against an API with the `blog` feature on: run with
 * `E2E_FEATURES=blog` (`e2e/README.md`). Posts are created through the admin API (the owner holds the catalog permissions);
 * the database starts without any. The storefront caches each blog read for 60 s (`CATALOG_REVALIDATE_SECONDS`) and nothing
 * revalidates by tag, so a page that was read before a change is reloaded until the change shows (`toPass`, like
 * `home-banners`), and a page is read for the first time only after the change it checks.
 *
 * Covers on this stack are plain `http` media URLs, which the storefront never hands to the image optimizer (only `https`
 * hosts of `STOREFRONT_IMAGE_HOSTS`): the page shows the token placeholder, named by the alt text (`media-route.e2e.ts`).
 */
test.skip(
  !E2E_FEATURES.includes("blog"),
  "needs the API with the blog on: run with E2E_FEATURES=blog",
);

test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: "serial" });

/** A 1x1 PNG (70 bytes), as in `media-route.e2e.ts`; the API re-encodes it. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const BODY = {
  uk: "## Прання\n\nПеріть у холодній воді. Дивіться [каталог](/catalog).\n\n- **Сушіть горизонтально**",
  en: "## Washing\n\nWash it cold. See the [catalog](/catalog).\n\n- **Dry flat**",
};

async function jsonLd(page: Page, type: string): Promise<Record<string, unknown>> {
  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) => scripts.map((script) => script.textContent ?? ""));
  const found = blocks
    .map((text) => JSON.parse(text) as Record<string, unknown>)
    .find((data) => data["@type"] === type);
  if (found === undefined) throw new Error(`No ${type} JSON-LD on ${page.url()}`);
  return found;
}

test("the blog is on: the config lists it, the header and the footer link it, an empty blog says so", async ({
  page,
}) => {
  const config = (await (await page.request.get("/store/config")).json()) as { features: string[] };
  expect(config.features).toContain("blog");

  const response = await page.goto("/en/blog");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "No posts yet" })).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Browse the catalog" }),
  ).toHaveAttribute("href", "/en/catalog");
  // The template's header shows its links in the picker's panel ("Categories"), after the categories.
  const header = page.getByRole("banner");
  await header.getByText("Categories", { exact: true }).click();
  await expect(header.getByRole("link", { name: "Blog", exact: true })).toHaveAttribute(
    "href",
    "/en/blog",
  );
  await expect(
    page.getByRole("contentinfo").getByRole("link", { name: "Blog", exact: true }),
  ).toHaveAttribute("href", "/en/blog");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${E2E_ORIGIN}/en/blog`,
  );
});

test("a draft is a real 404; a published post renders with its metadata, JSON-LD, list card and sitemap entry; unpublished it is a 404 again", async ({
  page,
  admin,
}, testInfo) => {
  test.setTimeout(240_000);
  const suffix = `${String(testInfo.retry)}-${testInfo.testId
    .slice(0, 6)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "0")}`;
  const slug = `e2e-linen-care-${suffix}`;
  const upload = await admin.uploadImage(PNG_1X1);
  const published = await admin.createBlogPost({
    slug,
    title: { uk: "Догляд за льоном", en: "Linen care" },
    excerpt: { uk: "Як доглядати за льоном.", en: "How to look after linen." },
    body: BODY,
    coverUploadId: upload.id,
    coverAlt: { uk: "Складений льон", en: "Folded linen" },
  });
  const draft = await admin.createBlogPost({
    slug: `e2e-draft-${suffix}`,
    title: { uk: "Чернетка", en: "Draft" },
    body: BODY,
  });
  try {
    for (const path of [`/uk/blog/${draft.slug}`, `/uk/blog/${slug}`, "/uk/blog/Not_A_Slug"]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
    }

    await admin.publishBlogPost(published.id);
    // Asked before the publish, the post's own address may answer from the 60 s cache: reload until it renders.
    await expect(async () => {
      const response = await page.goto(`/uk/blog/${slug}`);
      expect(response?.status()).toBe(200);
    }).toPass({ timeout: 120_000, intervals: [3_000] });

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Догляд за льоном" })).toBeVisible();
    await expect(main.getByRole("heading", { level: 2, name: "Прання" })).toBeVisible();
    await expect(main.getByRole("link", { name: "каталог", exact: true })).toHaveAttribute(
      "href",
      "/uk/catalog",
    );
    await expect(main.getByText("Сушіть горизонтально")).toBeVisible();
    await expect(main.getByRole("img", { name: "Складений льон" })).toBeVisible();
    await expect(main.locator("img")).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Усі публікації" })).toHaveAttribute(
      "href",
      "/uk/blog",
    );
    const crumbs = page.getByRole("navigation", { name: "Навігаційний ланцюжок" });
    await expect(crumbs.getByRole("link", { name: "Блог" })).toHaveAttribute("href", "/uk/blog");
    await expect(crumbs.getByText("Догляд за льоном")).toHaveAttribute("aria-current", "page");

    const url = `${E2E_ORIGIN}/uk/blog/${slug}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", url);
    await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
      "href",
      `${E2E_ORIGIN}/en/blog/${slug}`,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      "href",
      url,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", upload.url);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Як доглядати за льоном.",
    );

    const posting = await jsonLd(page, "BlogPosting");
    expect(posting).toMatchObject({
      headline: "Догляд за льоном",
      inLanguage: "uk",
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      publisher: { "@type": "Organization", url: `${E2E_ORIGIN}/` },
      image: [upload.url],
    });
    expect(posting).not.toHaveProperty("author");
    expect(await jsonLd(page, "BreadcrumbList")).toMatchObject({
      itemListElement: [
        { position: 1 },
        { position: 2, item: `${E2E_ORIGIN}/uk/blog` },
        { position: 3, item: url },
      ],
    });

    const english = await page.goto(`/en/blog/${slug}`);
    expect(english?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Linen care" })).toBeVisible();

    // The Ukrainian list was not read before the publish, so it shows the post at once.
    await page.goto("/uk/blog");
    const card = page.getByRole("list", { name: "Публікації" }).getByRole("article");
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("heading", { level: 2 }).getByRole("link")).toHaveAttribute(
      "href",
      `/uk/blog/${slug}`,
    );
    await expect(card.getByText("Як доглядати за льоном.")).toBeVisible();
    await expect(page.getByText("Чернетка")).toHaveCount(0);
    await card.getByRole("link", { name: "Догляд за льоном" }).click();
    await expect(page).toHaveURL(`/uk/blog/${slug}`);

    const redirected = await page.goto("/uk/blog?page=0");
    expect(redirected?.url()).toBe(`${E2E_ORIGIN}/uk/blog`);

    const sitemap = await (await page.request.get("/sitemap.xml")).text();
    for (const locale of ["uk", "en"]) {
      expect(sitemap).toContain(`<loc>${E2E_ORIGIN}/${locale}/blog</loc>`);
      expect(sitemap).toContain(`<loc>${E2E_ORIGIN}/${locale}/blog/${slug}</loc>`);
    }
    expect(sitemap).not.toContain(draft.slug);

    await admin.unpublishBlogPost(published.id);
    await expect(async () => {
      const response = await page.goto(`/uk/blog/${slug}`);
      expect(response?.status()).toBe(404);
    }).toPass({ timeout: 120_000, intervals: [3_000] });
  } finally {
    await admin.deleteBlogPost(published.id);
    await admin.deleteBlogPost(draft.id);
  }
});
