import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CategoriesSection,
  CustomSection,
  HeroSection,
  HomeSection,
  RichTextSection,
  TrustSection,
} from "../config/home";
import type { CustomSectionProps } from "../lib/custom-sections";
import type { HomeSectionResult } from "../lib/home-data";
import { category } from "../lib/test-fixtures";
import { HomeSections, HomeSectionsView, type HomeContext } from "./home-sections";
import { leftoverText, sentinelTranslator } from "./test-helpers";

// Per-section `width` and the `custom` kind (plan 2026-11-08-design-changeability.md, L4; `docs/contracts/home-sections.md`).

const received: CustomSectionProps[] = [];

// A fork's `config/custom-sections.ts`: one server component registered by name, and a client component by mistake.
vi.mock("../config/custom-sections", () => {
  const BrandStrip = (props: CustomSectionProps) => {
    received.push(props);
    return (
      <section aria-labelledby={props.headingId} data-brand-strip="">
        <h2 id={props.headingId}>{props.t("custom.brandStrip.title")}</h2>
        <p>{props.isFirst ? "§first" : "§later"}</p>
      </section>
    );
  };
  const Nothing = () => null;
  // What a `'use client'` module looks like to the server: a client reference, not a component it can call.
  const clientReference = Object.assign(() => null, {
    $$typeof: Symbol.for("react.client.reference"),
  });
  return { customSections: { brandStrip: BrandStrip, nothing: Nothing, island: clientReference } };
});

const t = sentinelTranslator();
const context: HomeContext = { locale: "uk", t, imageHosts: [] };

const hero: HeroSection = { kind: "hero", id: "hero", headlineKey: "h.title" };
const tiles: CategoriesSection = { kind: "categories", id: "tiles", titleKey: "c.title", limit: 2 };
const trust: TrustSection = { kind: "trust", id: "trust", titleKey: "t.title" };
const about: RichTextSection = { kind: "richText", id: "about", bodyKey: "a.body" };
const strip: CustomSection = { kind: "custom", id: "strip", name: "brandStrip" };

const results: Record<string, HomeSectionResult> = {
  tiles: {
    status: "ok",
    data: { kind: "categories", categories: [category("books", [], { name: "§books" })] },
  },
};

function render(sections: readonly HomeSection[], loaded = results): string {
  return renderToStaticMarkup(
    <HomeSectionsView sections={sections} context={context} results={loaded} />,
  );
}

const container = '<div class="mx-auto w-full max-w-6xl px-4">';
const stack = '<div class="flex flex-col gap-12 py-8">';
const contained =
  '<div class="mx-auto w-full max-w-6xl px-4 empty:hidden" data-home-width="contained">';
const pullUp = "[[data-home-width=full]:not(:empty)+&amp;]:-mt-12";
const full = `<div class="empty:hidden ${pullUp}" data-home-width="full">`;
const fullFirst = `<div class="empty:hidden ${pullUp} -mt-8" data-home-width="full">`;
const fullLast = `<div class="empty:hidden ${pullUp} -mb-8" data-home-width="full">`;
const wide: CustomSection = { ...strip, width: "full" };

afterEach(() => {
  received.length = 0;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("home section width", () => {
  it("puts every section in ONE container when no section is full (today's markup; `contained` is the default)", () => {
    const html = render([hero, tiles, trust, about, strip]);
    expect(html.startsWith(`${container}${stack}`)).toBe(true);
    expect(html).not.toContain("data-home-width");
    const explicit = render(
      [hero, tiles, trust, about, strip].map((section) => ({
        ...section,
        width: "contained" as const,
      })),
    );
    expect(explicit).toBe(html);
  });

  it("renders a full section WITHOUT a container (edge to edge, its own surface) and every other section in its own", () => {
    const html = render([hero, wide, tiles, trust, about]);
    expect(html.startsWith(stack)).toBe(true);
    expect(html).not.toContain(container);
    expect(html).toContain(`${full}<section aria-labelledby="strip-title" data-brand-strip="">`);
    expect(html.match(/data-home-width="contained"/g)).toHaveLength(4);
    expect(html).toContain(`${contained}<section aria-labelledby="hero-title"`);
    expect(html).toContain(`${contained}<section aria-labelledby="tiles-title"`);
    // No surface of the template's own: the section chooses it.
    expect(html).not.toContain("bg-muted px-4");
    // Order, the one h1 and the section ids are unchanged.
    expect([...html.matchAll(/data-home-section-id="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "tiles",
      "trust",
      "about",
    ]);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("puts a full section first flush under the header, last flush on the footer, and lets adjacent ones touch", () => {
    const html = render([wide, { ...wide, id: "strip-2" }, hero, { ...wide, id: "strip-3" }]);
    // The stack keeps its padding; the first and last full frames pull over it.
    expect(html.startsWith(stack)).toBe(true);
    expect(html).toContain(`${fullFirst}<section aria-labelledby="strip-title"`);
    // Every full frame carries the pull-up rule; it applies only after a full frame that rendered something.
    expect(html).toContain(`${full}<section aria-labelledby="strip-2-title"`);
    expect(html).toContain(`${contained}<section aria-labelledby="hero-title"`);
    expect(html).toContain(`${fullLast}<section aria-labelledby="strip-3-title"`);
  });

  it("ties the full frames' pulls to the stack's gap and padding (gap-12 / -mt-12, py-8 / -mt-8 and -mb-8)", () => {
    const stackClasses = /^<div class="([^"]+)">/.exec(stack)?.[1]?.split(" ") ?? [];
    const spacing = (prefix: string) =>
      stackClasses.find((name) => name.startsWith(prefix))?.slice(prefix.length);
    expect(spacing("gap-")).toBe("12");
    expect(spacing("py-")).toBe("8");
    expect(pullUp.endsWith(`:-mt-${spacing("gap-") ?? ""}`)).toBe(true);
    expect(fullFirst).toContain(` -mt-${spacing("py-") ?? ""}"`);
    expect(fullLast).toContain(` -mb-${spacing("py-") ?? ""}"`);
    // The rendered stack is that class list, with and without full sections.
    expect(render([hero, wide]).startsWith(stack)).toBe(true);
    expect(render([hero]).startsWith(`${container}${stack}`)).toBe(true);
  });

  it("frames a skeleton, an error and an empty contained section; an empty frame hides itself (no extra gap)", () => {
    const loading = render([wide, tiles], {});
    expect(loading).toContain(
      `${contained}<section aria-labelledby="tiles-title" aria-busy="true"`,
    );
    const empty = render([wide, tiles], {
      tiles: { status: "ok", data: { kind: "categories", categories: [] } },
    });
    expect(empty).toContain(`${contained}</div>`);
    const failed = render([wide, tiles], { tiles: { status: "error" } });
    expect(failed).toContain("§home.section.error");
  });

  it("fails loudly on a width it does not know, and on full for a built-in kind", () => {
    const unknown = { ...trust, width: "wide" } as unknown as HomeSection;
    expect(() => render([hero, unknown])).toThrow('Home section "trust" has the width "wide"');
    const fullTrust = { ...trust, width: "full" } as unknown as HomeSection;
    expect(() => render([hero, fullTrust])).toThrow(
      'Home section "trust" (trust) cannot be full width',
    );
  });
});

describe("custom home sections", () => {
  it("renders the component the fork registered, with a plain view model only", () => {
    const html = render([hero, strip, trust]);
    expect(html).toContain(
      '<section aria-labelledby="strip-title" data-brand-strip=""><h2 id="strip-title">§custom.brandStrip.title</h2><p>§later</p></section>',
    );
    expect(html.indexOf("§h.title")).toBeLessThan(html.indexOf("§custom.brandStrip.title"));
    expect(received).toHaveLength(1);
    const [props] = received;
    expect(Object.keys(props ?? {}).sort()).toEqual([
      "headingId",
      "id",
      "isFirst",
      "locale",
      "t",
      "width",
    ]);
    expect(props).toMatchObject({
      id: "strip",
      headingId: "strip-title",
      locale: "uk",
      isFirst: false,
      width: "contained",
    });
    expect(leftoverText(html)).toBe("");
  });

  it("tells the component it comes first, and keeps one hidden h1 before it", () => {
    const html = render([strip]);
    expect(html).toContain("§first");
    expect(html).toContain('<h1 class="sr-only">§site.name</h1>');
  });

  it("tells the component its width, so a full section can choose its surface and inner width", () => {
    render([hero, wide]);
    expect(received[0]?.width).toBe("full");
  });

  it("hides the frame of a custom section that renders nothing", () => {
    const html = render([hero, { kind: "custom", id: "none", name: "nothing", width: "full" }]);
    expect(html).toContain(`${fullLast}</div>`);
  });

  it("pulls nothing over the header when a first full section renders nothing (the pull-up is a rendered-state rule)", () => {
    const html = render([
      { kind: "custom", id: "none", name: "nothing", width: "full" },
      { ...wide, id: "strip-2" },
      hero,
    ]);
    expect(html).toContain(`${fullFirst}</div>`);
    // The next full frame has no unconditional pull: only the sibling rule, which needs a non-empty full frame before it.
    expect(html).toContain(`${full}<section aria-labelledby="strip-2-title"`);
    expect(html).not.toMatch(/class="(?:[^"]*\s)?-mt-12[\s"]/);
  });

  it("fails loudly in development and tests on a name the registry does not know", () => {
    expect(() => render([hero, { ...strip, name: "brandStripe" }])).toThrow(
      'Home section "strip" names the custom section "brandStripe", which config/custom-sections.ts does not register (registered: brandStrip, nothing, island).',
    );
  });

  it("in production leaves the section out and logs it with console.error once per name, never silently; the rest renders", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = render([hero, { ...strip, name: "brandStripe" }, trust]);
    render([hero, { ...strip, name: "brandStripe" }, trust]);
    expect(html).not.toContain("data-brand-strip");
    expect(html).toContain("§h.title");
    expect(html).toContain('data-home-section-id="trust"');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(
      'Home section "strip" names the custom section "brandStripe"',
    );
  });

  it("refuses a client component registered directly (it cannot receive the translator); a server wrapper must render it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => render([{ ...strip, name: "island" }])).toThrow(
      'The custom section "island" is a client component',
    );
  });

  it("does not resolve names of Object.prototype members", () => {
    expect(() => render([{ ...strip, name: "toString" }])).toThrow(
      'names the custom section "toString", which config/custom-sections.ts does not register',
    );
  });
});

describe("the streaming route with width and custom sections", () => {
  it("frames and renders like the static view; a custom section adds no boundary and no loading view", async () => {
    const sections: HomeSection[] = [wide, hero, tiles, { ...strip, id: "strip-2", width: "full" }];
    const { prelude } = await prerenderToNodeStream(
      <HomeSections
        sections={sections}
        context={context}
        load={(section) => Promise.resolve(results[section.id] ?? { status: "error" })}
      />,
      { progressiveChunkSize: Number.POSITIVE_INFINITY },
    );
    let html = "";
    for await (const chunk of prelude) html += String(chunk);
    // Only the category tiles stream behind a boundary.
    expect(html.match(/<!--\$-->/g)).toHaveLength(1);
    expect(html).not.toContain('aria-busy="true"');
    expect(html.replace(/<!--\/?\$-->/g, "")).toBe(render(sections));
  });
});

describe("reveals across home layouts", () => {
  it("wraps custom and built-in sections inside their own frames, including empty custom content", () => {
    const html = render([
      { ...wide, reveal: "pop-in" },
      { ...tiles, reveal: "fade-up" },
      { ...strip, id: "nothing", name: "nothing", reveal: "fade-up" },
    ]);
    expect(html).toContain(
      `${fullFirst}<div class="fk-home-reveal empty:hidden" data-home-reveal="pop-in"><section`,
    );
    expect(html).toContain(
      `${contained}<div class="fk-home-reveal empty:hidden" data-home-reveal="fade-up"><section`,
    );
    expect(html).toContain(
      `${contained}<div class="fk-home-reveal empty:hidden" data-home-reveal="fade-up"></div></div>`,
    );
  });
  it("keeps a streamed data boundary inside its reveal wrapper", async () => {
    const section = { ...tiles, reveal: "fade-up" as const };
    const { prelude } = await prerenderToNodeStream(
      <HomeSections
        sections={[hero, section]}
        context={context}
        load={() => Promise.resolve(results.tiles as HomeSectionResult)}
      />,
      { progressiveChunkSize: Number.POSITIVE_INFINITY },
    );
    let html = "";
    for await (const chunk of prelude) html += String(chunk);
    expect(html).toContain('data-home-reveal="fade-up"><!--$--><section');
    expect(html).toContain("</section><!--/$--></div>");
    const skeleton = render([section], {});
    expect(skeleton).toContain('data-home-reveal="fade-up"><section');
    expect(skeleton).toContain('aria-busy="true"');
  });
});
