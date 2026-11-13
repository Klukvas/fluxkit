import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "../../../../lib/seo";
import { messagesByLocale } from "../../../../messages";
import { post } from "./blog-fixtures";
import {
  HEADLINE_MAX_LENGTH,
  blogBreadcrumbJsonLd,
  blogListMetadata,
  blogPostMetadata,
  blogPostingJsonLd,
  postModifiedTime,
} from "./blog-seo";

const { uk, en } = messagesByLocale;
/** The shop name of the merged messages (a fork renames it): never a literal here. */
const shopName = uk["site.name"] as string;
const t = createTranslator(uk, "uk");
const origin = "https://shop.example";
/** No brand picture: stated here instead of read from `config/brand.ts`, which a fork fills. */
const ogImage = null;
const textLogo = { kind: "text" } as const;

describe("blogListMetadata", () => {
  it("indexes page 1 with its own canonical, hreflang for every locale and the texts of the messages", () => {
    const meta = blogListMetadata({ origin, locale: "uk", t, page: 1, ogImage });
    expect(meta.title).toBe(
      t("seo.pageTitle", { title: t("features.blog.title"), site: shopName }),
    );
    expect(meta.description).toBe(uk["features.blog.metaDescription"]);
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates).toEqual({
      canonical: "https://shop.example/uk/blog",
      languages: {
        uk: "https://shop.example/uk/blog",
        en: "https://shop.example/en/blog",
        "x-default": "https://shop.example/uk/blog",
      },
    });
    expect(meta.openGraph).toMatchObject({ type: "website", url: "https://shop.example/uk/blog" });
    expect(meta.openGraph).not.toHaveProperty("images");
  });

  it("names a later page, keeps it in the canonical and is noindex, follow there", () => {
    const meta = blogListMetadata({
      origin,
      locale: "en",
      t: createTranslator(en, "en"),
      page: 3,
      ogImage: { src: "/brand/og.png", width: 1200, height: 630 },
    });
    expect(meta.title).toContain(`${en["features.blog.title"] ?? ""} (Page 3)`);
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("https://shop.example/en/blog?page=3");
    expect(meta.openGraph).toMatchObject({
      images: [{ url: "https://shop.example/brand/og.png", width: 1200, height: 630 }],
    });
  });
});

describe("blogListMetadata while the list cannot be read", () => {
  it("keeps the page's canonical but is noindex, follow, so the error state is never indexed", () => {
    const meta = blogListMetadata({ origin, locale: "uk", t, page: 1, ogImage, unavailable: true });
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("https://shop.example/uk/blog");
    expect(
      blogListMetadata({ origin, locale: "uk", t, page: 1, ogImage, unavailable: false }).robots,
    ).toBeUndefined();
  });
});

describe("blogPostMetadata", () => {
  it("uses the title, the excerpt, the post's canonical, its locales and Open Graph article with the cover", () => {
    const meta = blogPostMetadata({ origin, locale: "uk", t, post, ogImage });
    expect(meta.title).toBe(t("seo.pageTitle", { title: post.title, site: shopName }));
    expect(meta.description).toBe(post.excerpt);
    expect(meta.alternates).toEqual({
      canonical: "https://shop.example/uk/blog/spring-care",
      languages: {
        uk: "https://shop.example/uk/blog/spring-care",
        en: "https://shop.example/en/blog/spring-care",
        "x-default": "https://shop.example/uk/blog/spring-care",
      },
    });
    expect(meta.openGraph).toEqual({
      title: meta.title,
      description: post.excerpt,
      url: "https://shop.example/uk/blog/spring-care",
      siteName: shopName,
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      images: [
        {
          url: "https://cdn.example.com/cover.webp",
          width: 1600,
          height: 900,
          alt: "Folded linen",
        },
      ],
    });
  });

  it("prefers the SEO texts, falls back to the body, and names only the locales the post is written in", () => {
    const seo = blogPostMetadata({
      origin,
      locale: "en",
      t: createTranslator(en, "en"),
      post: { ...post, seoTitle: "Linen in spring", seoDescription: "Short.", locales: ["en"] },
      ogImage,
    });
    expect(seo.title).toContain("Linen in spring");
    expect(seo.description).toBe("Short.");
    expect(seo.alternates?.languages).toEqual({
      en: "https://shop.example/en/blog/spring-care",
      "x-default": "https://shop.example/en/blog/spring-care",
    });
    const fromBody = blogPostMetadata({
      origin,
      locale: "uk",
      t,
      post: { ...post, excerpt: null },
      ogImage,
    });
    expect(fromBody.description).toBe("Washing Wash it cold. See the catalog. Dry flat 30 °C");
    // An empty or blank text falls through like a missing one.
    const blank = blogPostMetadata({
      origin,
      locale: "uk",
      t,
      post: { ...post, seoTitle: " ", seoDescription: "", excerpt: "  " },
      ogImage,
    });
    expect(blank.title).toBe(t("seo.pageTitle", { title: post.title, site: shopName }));
    expect(blank.description).toBe("Washing Wash it cold. See the catalog. Dry flat 30 °C");
    expect(
      blogPostMetadata({ origin, locale: "uk", t, post: { ...post, seoDescription: "" }, ogImage })
        .description,
    ).toBe(post.excerpt);
  });

  it("uses the alt text of the post's title for a decorative cover, and the brand picture without a cover", () => {
    const decorative = blogPostMetadata({
      origin,
      locale: "uk",
      t,
      post: {
        ...post,
        cover: { url: "https://cdn.example.com/cover.webp", width: 1600, height: 900, alt: null },
      },
      ogImage,
    });
    expect(decorative.openGraph).toMatchObject({ images: [{ alt: post.title }] });
    const brandOnly = blogPostMetadata({
      origin,
      locale: "uk",
      t,
      post: { ...post, cover: null },
      ogImage: { src: "/brand/og.png", width: 1200, height: 630 },
    });
    expect(brandOnly.openGraph).toMatchObject({
      images: [{ url: "https://shop.example/brand/og.png", alt: shopName }],
    });
  });
});

describe("postModifiedTime", () => {
  it("is the last change, never before the publish date (first publish, a post scheduled ahead)", () => {
    expect(postModifiedTime(post)).toBe(post.updatedAt);
    const scheduled = {
      publishedAt: "2026-12-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    };
    expect(postModifiedTime(scheduled)).toBe(scheduled.publishedAt);
    const stamped = {
      ...post,
      publishedAt: "2026-11-13T21:42:28.373Z",
      updatedAt: "2026-11-13T21:42:28.370Z",
    };
    expect(
      blogPostingJsonLd({ origin, locale: "uk", t, post: stamped, logo: textLogo, ogImage }),
    ).toMatchObject({
      datePublished: stamped.publishedAt,
      dateModified: stamped.publishedAt,
    });
    expect(
      blogPostMetadata({ origin, locale: "uk", t, post: stamped, ogImage }).openGraph,
    ).toMatchObject({
      modifiedTime: stamped.publishedAt,
    });
  });
});

describe("blogPostingJsonLd", () => {
  it("describes the post with the shop as author and publisher", () => {
    expect(blogPostingJsonLd({ origin, locale: "uk", t, post, logo: textLogo, ogImage })).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: post.excerpt,
      image: ["https://cdn.example.com/cover.webp"],
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
      inLanguage: "uk",
      wordCount: 11,
      url: "https://shop.example/uk/blog/spring-care",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://shop.example/uk/blog/spring-care" },
      author: { "@type": "Organization", name: shopName, url: "https://shop.example/" },
      publisher: { "@type": "Organization", name: shopName, url: "https://shop.example/" },
    });
  });

  it("uses the brand's social picture as image without a cover, and none without either", () => {
    const brandPicture = { src: "/brand/og.png", width: 1200, height: 630 } as const;
    expect(
      blogPostingJsonLd({
        origin,
        locale: "uk",
        t,
        post: { ...post, cover: null },
        logo: textLogo,
        ogImage: brandPicture,
      }),
    ).toMatchObject({ image: ["https://shop.example/brand/og.png"] });
    expect(
      blogPostingJsonLd({ origin, locale: "uk", t, post, logo: textLogo, ogImage: brandPicture }),
    ).toMatchObject({ image: ["https://cdn.example.com/cover.webp"] });
  });

  it("caps the headline, adds the logo of an image brand and stays inert inside a script element", () => {
    const long = `${"Linen ".repeat(30)}</script><script>alert(1)</script>`;
    const data = blogPostingJsonLd({
      origin,
      locale: "uk",
      t,
      post: { ...post, title: long, cover: null },
      logo: {
        kind: "image",
        light: { src: "/brand/logo.svg", width: 120, height: 32 },
        darkSafe: true,
      },
      ogImage,
    }) as { headline: string; author: object; publisher: { logo: unknown } };
    expect(data.headline.length).toBeLessThanOrEqual(HEADLINE_MAX_LENGTH);
    expect(data).not.toHaveProperty("image");
    expect(data.publisher.logo).toEqual({
      "@type": "ImageObject",
      url: "https://shop.example/brand/logo.svg",
      width: 120,
      height: 32,
    });
    expect(data.author).not.toHaveProperty("logo");
    const tagged = blogPostingJsonLd({
      origin,
      locale: "uk",
      t,
      post: { ...post, title: "</script><script>alert(1)</script>" },
      logo: textLogo,
      ogImage,
    });
    expect(serializeJsonLd(tagged)).not.toContain("</script>");
  });

  it("lists Home and Blog for the list, and the post after them on a post", () => {
    const home = {
      "@type": "ListItem",
      position: 1,
      name: uk["breadcrumbs.home"],
      item: "https://shop.example/uk",
    };
    const blog = {
      "@type": "ListItem",
      position: 2,
      name: uk["features.blog.title"],
      item: "https://shop.example/uk/blog",
    };
    expect(blogBreadcrumbJsonLd({ origin, locale: "uk", t })).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [home, blog],
    });
    expect(blogBreadcrumbJsonLd({ origin, locale: "uk", t, post })).toMatchObject({
      itemListElement: [
        home,
        blog,
        { position: 3, name: post.title, item: "https://shop.example/uk/blog/spring-care" },
      ],
    });
  });
});
