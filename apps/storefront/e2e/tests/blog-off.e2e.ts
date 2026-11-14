import { E2E_FEATURES } from "../support/env.ts";
import { expect, test } from "../support/fixtures.ts";

/**
 * The blog with its feature off, the template's default (plan docs/plans/2026-11-13-blog.md, PR 4b): the slice is on disk, but
 * while `GET /store/config` does not list `blog` its pages are real 404s and no page links them. Runs in the default mode;
 * `tests/blog.e2e.ts` runs with `E2E_FEATURES=blog` instead.
 */
test.skip(
  E2E_FEATURES.includes("blog"),
  "needs the API with the blog off: run without E2E_FEATURES",
);

test.use({ viewport: { width: 1280, height: 800 } });

test("the API has no blog: the config does not list it and its store routes answer 404", async ({
  page,
}) => {
  const config = (await (await page.request.get("/store/config")).json()) as { features: string[] };
  expect(config.features).not.toContain("blog");
  for (const path of ["/store/blog/posts?locale=uk", "/store/blog/sitemap"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
});

test("the blog pages are real 404s and no header, footer or sitemap links them", async ({
  page,
}) => {
  for (const path of ["/uk/blog", "/en/blog?page=2", "/uk/blog/any-post"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
  for (const locale of ["uk", "en"]) {
    await page.goto(`/${locale}`);
    // The header is there (its cart link), so an absent blog link is not an absent page.
    await expect(page.getByRole("banner").getByRole("link", { name: /cart|кошик/i })).toBeVisible();
    await expect(page.locator(`a[href^="/${locale}/blog"]`)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^(Blog|Блог)$/ })).toHaveCount(0);
  }
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("<urlset");
  expect(sitemap).not.toContain("/blog");
});
