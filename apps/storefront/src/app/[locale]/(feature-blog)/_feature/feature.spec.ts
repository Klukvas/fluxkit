import { afterEach, describe, expect, it, vi } from "vitest";
import { featureRegistryProblems, registeredFeatures } from "../../../../features/registry";
import type { FeatureData } from "../../../../features/types";
import { SITEMAP_REVALIDATE_SECONDS, type CatalogOutcome } from "../../../../lib/store-data";
import type { BlogSitemap } from "./blog-api";
import { blogSitemapPages, feature } from "./feature";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Feature data answering the sitemap read with `outcome`, recording the read options. */
function dataAnswering(outcome: CatalogOutcome<BlogSitemap>, asked: unknown[] = []): FeatureData {
  return {
    // The manifest reads the sitemap route only, so every read is answered with the sitemap's outcome.
    read: async <T>(operation: string, _call: unknown, read?: unknown) => {
      asked.push({ operation, read });
      return outcome as CatalogOutcome<T>;
    },
  };
}

const sitemap: BlogSitemap = {
  items: [
    { slug: "newest", updatedAt: "2026-11-03T08:00:00.000Z", locales: ["uk", "en"] },
    { slug: "edited-later", updatedAt: "2026-11-05T08:00:00.000Z", locales: ["en"] },
    { slug: "foreign", updatedAt: "2026-11-01T08:00:00.000Z", locales: ["de"] },
  ],
  truncated: false,
};

describe("the blog slice's manifest", () => {
  it("is registered and passes the registry's checks (name, messages, links under its own pages)", () => {
    const entry = registeredFeatures.find((registered) => registered.folder === "blog");
    expect(entry?.segments).toEqual(["blog"]);
    expect(entry?.feature).toBe(feature);
    expect(featureRegistryProblems(registeredFeatures)).toEqual([]);
    expect(feature.navigation).toEqual([
      { placement: "header", labelKey: "features.blog.nav", path: "/blog" },
      { placement: "footer", labelKey: "features.blog.nav", path: "/blog" },
    ]);
  });

  it("lists the list and every post in the storefront locales it is written in, with its last change", () => {
    expect(blogSitemapPages(sitemap)).toEqual([
      { path: "/blog", lastModified: "2026-11-05T08:00:00.000Z" },
      { path: "/blog/newest", lastModified: "2026-11-03T08:00:00.000Z", locales: ["uk", "en"] },
      { path: "/blog/edited-later", lastModified: "2026-11-05T08:00:00.000Z", locales: ["en"] },
    ]);
    expect(blogSitemapPages({ items: [], truncated: false })).toEqual([{ path: "/blog" }]);
  });

  it("reads the sitemap route with the sitemap's one-hour cache and warns when it is truncated", async () => {
    const asked: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pages = await feature.sitemap({
      locale: "uk",
      data: dataAnswering({ ok: true, stale: false, data: { ...sitemap, truncated: true } }, asked),
    });
    expect(pages).toHaveLength(3);
    expect(asked).toEqual([
      {
        operation: "GET /store/blog/sitemap",
        read: { revalidateSeconds: SITEMAP_REVALIDATE_SECONDS },
      },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "GET /store/blog/sitemap is truncated: the sitemap lists the newest 3 posts only.",
    );
  });

  it("fails the sitemap on a refused read (a sitemap that silently lacks posts hides them)", async () => {
    await expect(
      feature.sitemap({
        locale: "uk",
        data: dataAnswering({
          ok: false,
          status: 400,
          problem: {
            type: "about:blank",
            title: "Bad request",
            status: 400,
            code: "validation_failed",
            detail: "Bad.",
          },
        }),
      }),
    ).rejects.toThrow("GET /store/blog/sitemap for the sitemap answered 400 validation_failed.");
  });
});
