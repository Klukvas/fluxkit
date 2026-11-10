import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { brandStrip } from "../../config/brand-strip";
import type { CustomSectionProps } from "../../lib/custom-sections";
import { leftoverText, sentinelTranslator } from "../test-helpers";
import { BrandStrip } from "./brand-strip";
import { FullBleedHero } from "./full-bleed-hero";

// FORK spec (reshape R4): the fork's two custom home sections, rendered directly with the plain view model (the registry and
// `config/home.ts` are replaced by fixtures in upstream's fork runs; `components/home-config.spec.ts` checks the real ones).
const props: CustomSectionProps = {
  id: "home-x",
  headingId: "home-x-title",
  locale: "uk",
  t: sentinelTranslator(),
  isFirst: true,
  width: "full",
};
const publicRoot = join(import.meta.dirname, "..", "..", "..", "public");

describe("FullBleedHero (fork, reshape R4)", () => {
  const html = renderToStaticMarkup(<FullBleedHero {...props} />);

  it("is a labelled section with an h2, the template's hero texts and a localized call to action", () => {
    expect(html).toContain('<section aria-labelledby="home-x-title" data-fork-hero=""');
    expect(html).toMatch(/<h2 id="home-x-title"[^>]*>§home\.hero\.title<\/h2>/);
    expect(html).toContain("§home.hero.description");
    expect(html).toMatch(/<a [^>]*href="\/uk\/catalog"[^>]*>§home\.hero\.cta<\/a>/);
    expect(leftoverText(html)).toBe("");
  });

  it("fills the band with a decorative picture loaded at once, the text on its own surface over it", () => {
    expect(html).toMatch(
      /<img alt=""[^>]*loading="eager"[^>]*class="absolute inset-0[^"]*object-cover"/,
    );
    expect(html).toContain("bg-background/90");
    const lazy = renderToStaticMarkup(<FullBleedHero {...props} isFirst={false} />);
    expect(lazy).toContain('loading="lazy"');
  });
});

describe("BrandStrip (fork, reshape R4)", () => {
  it("lists every configured brand: a decorative picture with the brand's name as text", () => {
    const html = renderToStaticMarkup(<BrandStrip {...props} />);
    expect(html).toMatch(/<h2 id="home-x-title"[^>]*>§custom\.brandStrip\.title<\/h2>/);
    expect(html.match(/<li>/g)).toHaveLength(brandStrip.length);
    expect(html.match(/<img alt=""/g)).toHaveLength(brandStrip.length);
    for (const brand of brandStrip) expect(html).toContain(`>${brand.name}</span>`);
  });

  it("links a brand with a slug to the catalog filtered by it, draws its own band only edge to edge, and hides when empty", () => {
    const [first] = brandStrip;
    if (first === undefined) throw new Error("config/brand-strip.ts is empty");
    const linked = renderToStaticMarkup(
      <BrandStrip {...props} width="contained" brands={[{ ...first, slug: "demo brand" }]} />,
    );
    expect(linked).toContain('href="/uk/catalog?brand=demo%20brand"');
    expect(linked).not.toContain("max-w-6xl");
    expect(renderToStaticMarkup(<BrandStrip {...props} />)).toContain("max-w-6xl");
    expect(renderToStaticMarkup(<BrandStrip {...props} brands={[]} />)).toBe("");
  });

  it("names pictures that exist under public/ with their real size, and each brand once", () => {
    expect(new Set(brandStrip.map((brand) => brand.name)).size).toBe(brandStrip.length);
    for (const { image } of [
      ...brandStrip,
      { image: { src: "/fork/hero-wide.svg", width: 1600, height: 640 } },
    ]) {
      const file = join(publicRoot, image.src);
      expect(existsSync(file), image.src).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(
        `viewBox="0 0 ${String(image.width)} ${String(image.height)}"`,
      );
    }
  });
});
