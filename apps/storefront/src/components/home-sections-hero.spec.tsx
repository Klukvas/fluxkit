import { createTranslator, Hero } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HeroSection, HomeSection } from "../config/home";
import { messagesByLocale } from "../messages";
import en from "../messages/en/home.json";
import uk from "../messages/uk/home.json";
import { HomeSectionsView } from "./home-sections";

const hero: HeroSection = {
  kind: "hero",
  id: "hero",
  headlineKey: "home.hero.title",
  image: { src: "/home/hero.svg", width: 640, height: 480, altKey: null },
  decoration: {
    blob: true,
    sticker: { textKey: "home.hero.sticker" },
    highlightKey: "home.hero.highlight",
    popIn: true,
  },
};
const context = {
  locale: "en" as const,
  t: createTranslator(messagesByLocale.en, "en"),
  imageHosts: [],
};
const render = (sections: readonly HomeSection[]) =>
  renderToStaticMarkup(<HomeSectionsView sections={sections} context={context} results={{}} />);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("opt-in home hero decoration", () => {
  it("keeps the unchanged Hero markup when decoration is absent", () => {
    const plain: HeroSection = { kind: "hero", id: "plain", headlineKey: "home.hero.title" };
    const markup = render([plain]);
    const expected = renderToStaticMarkup(
      <Hero headingId="plain-title" headingLevel="h1" title="Welcome" />,
    );
    expect(markup).toContain(expected);
    expect(markup).not.toMatch(/data-home-(decorated|blob|sticker|highlight|pop-in)/);
  });

  it("hides ornaments from assistive technology and highlights the exact first match", () => {
    const markup = render([hero]);
    expect(markup).toContain('aria-hidden="true" class="fk-home-blob" data-home-blob=""');
    expect(markup).toContain('<svg aria-hidden="true" focusable="false"');
    expect(markup).toContain(en["home.hero.sticker"]);
    expect(markup).toContain('<span class="fk-home-marker" data-home-highlight="">Welcome</span>');
    expect(markup).toContain('data-home-pop-in=""');
    expect(markup).toContain('fetchPriority="high"');
    const repeated = {
      ...context,
      t: createTranslator({ title: "Welcome Welcome", phrase: "Welcome" }, "en"),
    };
    const html = renderToStaticMarkup(
      <HomeSectionsView
        sections={[{ ...hero, headlineKey: "title", decoration: { highlightKey: "phrase" } }]}
        context={repeated}
        results={{}}
      />,
    );
    expect(html).toContain('data-home-highlight="">Welcome</span> Welcome');
  });

  it("uses a collision-free SVG path id for every hero and preserves heading levels", () => {
    const markup = render([hero, { ...hero, id: "hero!" }]);
    const ids = [...markup.matchAll(/<path id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`href="#${id}"`);
    expect(markup).toContain('<h1 id="hero-title"');
    expect(markup).toContain('<h2 id="hero!-title"');
  });

  it("ignores the blob without a picture", () => {
    const { image: _image, ...withoutImage } = hero;
    void _image;
    expect(render([withoutImage])).not.toContain("data-home-blob");
  });

  it("keeps a plain headline on a missing highlight, warns only outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const section: HeroSection = { ...hero, decoration: { highlightKey: "home.hero.cta" } };
    expect(render([section])).toMatch(/<h1[^>]+>Welcome<\/h1>/);
    expect(warn).toHaveBeenCalledOnce();
    vi.stubEnv("NODE_ENV", "production");
    expect(render([section])).not.toContain("data-home-highlight");
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([uk, en])("ships a highlight present in the locale's unchanged headline", (messages) => {
    expect(messages["home.hero.highlight"].length).toBeGreaterThan(0);
    expect(messages["home.hero.title"]).toContain(messages["home.hero.highlight"]);
  });
});

describe("section reveal wrappers", () => {
  it("wraps an opted-in section, keeps an unconfigured section unwrapped, and leaves empty wrappers empty", () => {
    const section = { kind: "richText", id: "about", bodyKey: "home.about.body" } as const;
    expect(render([section])).not.toContain("data-home-reveal");
    expect(render([{ ...section, reveal: "fade-up" }])).toContain(
      'class="fk-home-reveal empty:hidden" data-home-reveal="fade-up"><div data-home-section="richText"',
    );
    expect(
      render([
        {
          kind: "banners",
          id: "empty",
          source: "config",
          titleKey: "home.banners.title",
          items: [],
          reveal: "pop-in",
        },
      ]),
    ).toContain('data-home-reveal="pop-in"></div>');
  });
});
