import type { HomeBanner } from "@fluxkit/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Banner, ConfigBannersSection } from "../config/home";
import {
  bannerLink,
  checkBannersSection,
  checkStoreBanner,
  forgetBannerWarnings,
  storeBannerViews,
} from "./home-banners";

beforeEach(() => {
  forgetBannerWarnings();
});

// The banners section of the home page (plans 2026-11-05-home-banners.md and 2026-11-05-admin-home-banners.md): link and
// count checks of the config source, and the checks of the banners the API returns. The full link case table of core is in
// `home-banners-parity.spec.ts`.

function banner(id: string, href = "/catalog"): Banner {
  return {
    id,
    titleKey: "b.title",
    textKey: "b.text",
    href,
    image: { src: "/home/banner-1.svg", width: 640, height: 320, altKey: null },
  };
}

describe("bannerLink", () => {
  it("prefixes a storefront path with the locale, like the hero's link", () => {
    expect(bannerLink("uk", "/catalog")).toEqual({ href: "/uk/catalog", external: false });
    expect(bannerLink("en", "/c/demo-tools?brand=x")).toEqual({
      href: "/en/c/demo-tools?brand=x",
      external: false,
    });
    expect(bannerLink("en", "/")).toEqual({ href: "/en", external: false });
  });

  it("keeps an https address as a plain external link", () => {
    expect(bannerLink("uk", "https://example.com/sale")).toEqual({
      href: "https://example.com/sale",
      external: true,
    });
    expect(bannerLink("en", "HTTPS://Example.com")).toEqual({
      href: "https://example.com/",
      external: true,
    });
  });

  it.each([
    ["http (not https)", "http://example.com/"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["mailto:", "mailto:shop@example.com"],
    ["a relative path without a slash", "catalog"],
    ["a protocol-relative address", "//example.com/"],
    ["a backslash trick", "/\\example.com"],
    ["a parent segment", "/catalog/../admin"],
    // PR 225 review minors, fixed here: a percent-encoded dot segment and a path that already carries a locale.
    ["a percent-encoded parent segment", "/%2e%2e/admin"],
    ["a mixed-case encoded parent segment", "/catalog/.%2E/admin"],
    ["a leading locale segment", "/uk/catalog"],
    ["a leading locale segment in capitals", "/EN/catalog"],
    ["https without a host", "https:///path"],
    ["credentials", "https://user:secret@example.com/"],
    ["a tab inside", "https://exa\tmple.com/"],
    ["a space inside", "https://example.com/a b"],
    ["a backslash in an address", "https://example.com\\@evil.test/"],
    ["an empty value", ""],
    ["an over-long address", `https://example.com/${"a".repeat(2048)}`],
  ])("refuses %s", (_label, href) => {
    expect(() => bannerLink("uk", href)).toThrow(/refused/);
  });

  it("allows a path whose first segment only starts like a locale", () => {
    expect(bannerLink("uk", "/ukraine")).toEqual({ href: "/uk/ukraine", external: false });
    expect(bannerLink("en", "/catalog/uk")).toEqual({ href: "/en/catalog/uk", external: false });
  });
});

describe("checkBannersSection", () => {
  const section = (items: readonly Banner[]): ConfigBannersSection =>
    ({
      kind: "banners",
      source: "config",
      id: "banners",
      titleKey: "t",
      items,
    }) as ConfigBannersSection;

  it("accepts 0 to 3 banners with distinct slug ids", () => {
    for (const count of [0, 1, 2, 3]) {
      const items = Array.from({ length: count }, (_, index) => banner(`b${String(index)}`));
      expect(() => {
        checkBannersSection(section(items));
      }).not.toThrow();
    }
  });

  it("refuses a fourth banner (a list built past the tuple type)", () => {
    const items = ["a", "b", "c", "d"].map((id) => banner(id));
    expect(() => {
      checkBannersSection(section(items));
    }).toThrow(/4 banners; at most 3/);
  });

  it("refuses a repeated or malformed id (it becomes part of an element id)", () => {
    expect(() => {
      checkBannersSection(section([banner("a"), banner("a")]));
    }).toThrow(/twice/);
    expect(() => {
      checkBannersSection(section([banner("Has Space")]));
    }).toThrow(/slug/);
  });
});

const HOSTS = ["media.example.com"];
const ID = "6f1c2a8e-5b1d-4c3e-9a7f-0d2b4e6f8a10";

function card(overrides: Partial<HomeBanner> = {}): HomeBanner {
  return {
    id: ID,
    layout: "card",
    title: "Title",
    text: "Text",
    href: "/catalog",
    tone: "accent",
    image: {
      url: "https://media.example.com/0123456789abcdef0123456789abcdef.webp",
      width: 1280,
      height: 640,
      alt: null,
    },
    ...overrides,
  };
}

function picture(overrides: Partial<HomeBanner["image"]>): HomeBanner["image"] {
  return { ...card().image, ...overrides };
}

describe("checkStoreBanner (a banner of GET /store/banners)", () => {
  it("turns a card into a view: locale-prefixed link, allowed picture, decorative alt when the API sends none", () => {
    expect(checkStoreBanner(card(), "en", HOSTS)).toEqual({
      ok: true,
      view: {
        id: ID,
        layout: "card",
        title: "Title",
        text: "Text",
        tone: "accent",
        link: { href: "/en/catalog", external: false },
        picture: {
          src: "https://media.example.com/0123456789abcdef0123456789abcdef.webp",
          width: 1280,
          height: 640,
          alt: "",
        },
      },
    });
  });

  it("keeps the picture's alt text when it has one, and an empty text as no text", () => {
    const checked = checkStoreBanner(
      card({ text: "", image: picture({ alt: "A gift box" }) }),
      "uk",
      HOSTS,
    );
    expect(checked.ok && checked.view.layout === "card" && checked.view.text).toBeNull();
    expect(checked.ok && checked.view.picture.alt).toBe("A gift box");
  });

  it("renders the image layout from its alt text alone (no title, no text, no tone)", () => {
    const checked = checkStoreBanner(
      card({
        layout: "image",
        title: null,
        text: null,
        tone: "surface",
        href: "https://example.com/sale",
        image: picture({ alt: "New collection" }),
      }),
      "uk",
      HOSTS,
    );
    expect(checked).toEqual({
      ok: true,
      view: {
        id: ID,
        layout: "image",
        link: { href: "https://example.com/sale", external: true },
        picture: {
          src: "https://media.example.com/0123456789abcdef0123456789abcdef.webp",
          width: 1280,
          height: 640,
          alt: "New collection",
        },
      },
    });
  });

  it("gives a picture of a host that is not allowed the placeholder (null), like a product image", () => {
    const checked = checkStoreBanner(
      card({ image: picture({ url: "http://127.0.0.1:3000/media/a.webp" }) }),
      "uk",
      HOSTS,
    );
    expect(checked.ok && checked.view.picture.src).toBeNull();
    expect(checkStoreBanner(card(), "uk", []).ok && "kept").toBe("kept");
  });

  it.each([
    ["a link to http", { href: "http://example.com/" }, "link_not_path_or_https"],
    ["a percent-encoded dot segment", { href: "/%2e%2e/admin" }, "link_dot_segment"],
    ["a locale in the path", { href: "/en/catalog" }, "link_locale_prefix"],
    ["javascript:", { href: "javascript:alert(1)" }, "link_not_path_or_https"],
    ["an unknown layout", { layout: "video" }, "malformed"],
    ["an unknown tone", { tone: "red" }, "malformed"],
    ["a card without a title", { title: null }, "malformed"],
    ["a card with an empty title", { title: "" }, "malformed"],
    ["an id that cannot be an element id", { id: 'x" onclick="y' }, "malformed"],
    ["a picture of size 0", { image: picture({ width: 0 }) }, "malformed"],
    ["a picture without a URL", { image: picture({ url: 1 as unknown as string }) }, "malformed"],
    ["no picture", { image: null as unknown as HomeBanner["image"] }, "malformed"],
    [
      "an image banner without alt text (its link would have no name)",
      { layout: "image", title: null, text: null, image: picture({ alt: null }) },
      "malformed",
    ],
  ] as [string, Partial<HomeBanner>, string][])("skips %s (%s)", (_label, overrides, reason) => {
    expect(checkStoreBanner(card(overrides as Partial<HomeBanner>), "uk", HOSTS)).toEqual({
      ok: false,
      reason,
    });
  });
});

describe("storeBannerViews", () => {
  it("skips a bad banner and logs its id and a code only, never its texts or link", () => {
    const warn = vi.fn();
    const bad = card({ id: "1b6e0a64-2c4f-4c8e-8f1a-3d5b7c9e1f20", href: "/a/../b" });
    const views = storeBannerViews([bad, card()], "uk", HOSTS, warn);
    expect(views.map((view) => view.id)).toEqual([ID]);
    expect(warn.mock.calls).toEqual([
      ["Home banner 1b6e0a64-2c4f-4c8e-8f1a-3d5b7c9e1f20 is not shown: link_dot_segment."],
    ]);
  });

  it("logs a placeholder picture (a production without the media host in STOREFRONT_IMAGE_HOSTS)", () => {
    const warn = vi.fn();
    expect(storeBannerViews([card()], "uk", [], warn)).toHaveLength(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/shows a placeholder.*STOREFRONT_IMAGE_HOSTS/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("media.example.com");
  });

  it("shows at most 3 banners and never a 4th in place of a skipped one", () => {
    const warn = vi.fn();
    const ids = ["a", "b", "c", "d"].map(
      (letter) => `${letter.repeat(8)}-0000-4000-8000-000000000000`,
    );
    const views = storeBannerViews(
      [
        card({ id: ids[0] as string, href: "//evil.example" }),
        ...ids.slice(1).map((id) => card({ id })),
      ],
      "uk",
      HOSTS,
      warn,
    );
    expect(views.map((view) => view.id)).toEqual(ids.slice(1, 3));
    expect(warn.mock.calls[0]?.[0]).toMatch(/returned 4 banners; only the first 3/);
  });

  it("logs each banner and reason once per process, not on every render (review M2 of PR 229)", () => {
    const warn = vi.fn();
    const bad = card({ id: "1b6e0a64-2c4f-4c8e-8f1a-3d5b7c9e1f20", href: "/a/../b" });
    for (let render = 0; render < 5; render += 1) {
      storeBannerViews([bad, card()], "uk", [], warn);
    }
    expect(warn.mock.calls).toEqual([
      ["Home banner 1b6e0a64-2c4f-4c8e-8f1a-3d5b7c9e1f20 is not shown: link_dot_segment."],
      [expect.stringMatching(new RegExp(`^Home banner ${ID} shows a placeholder`))],
    ]);
    // The same banner failing for another reason is news: logged once more, then quiet again.
    const changed = { ...bad, href: "http://example.com/" };
    storeBannerViews([changed], "uk", HOSTS, warn);
    storeBannerViews([changed], "uk", HOSTS, warn);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2]).toEqual([
      "Home banner 1b6e0a64-2c4f-4c8e-8f1a-3d5b7c9e1f20 is not shown: link_not_path_or_https.",
    ]);
  });

  it("keeps the memory bounded: past 200 keys it starts over, and an old key logs again", () => {
    const warn = vi.fn();
    const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    for (let index = 0; index < 200; index += 1) {
      storeBannerViews([card({ id: id(index), href: "javascript:x" })], "uk", HOSTS, warn);
    }
    expect(warn).toHaveBeenCalledTimes(200);
    storeBannerViews([card({ id: id(0), href: "javascript:x" })], "uk", HOSTS, warn);
    expect(warn).toHaveBeenCalledTimes(200);
    // The 201st key clears the memory; the first banner is then logged once more.
    storeBannerViews([card({ id: id(200), href: "javascript:x" })], "uk", HOSTS, warn);
    storeBannerViews([card({ id: id(0), href: "javascript:x" })], "uk", HOSTS, warn);
    expect(warn).toHaveBeenCalledTimes(202);
  });

  it("returns nothing for an empty answer, without logging", () => {
    const warn = vi.fn();
    expect(storeBannerViews([], "en", HOSTS, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
