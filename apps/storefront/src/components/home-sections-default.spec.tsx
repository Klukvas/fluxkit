import { readFileSync } from "node:fs";
import { createTranslator, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { prerenderToNodeStream } from "react-dom/static";
import { describe, expect, it } from "vitest";
import { homeSections } from "../config/home";
import { storeBannerViews } from "../lib/home-banners";
import type { HomeSectionResult } from "../lib/home-data";
import { category, summary } from "../lib/test-fixtures";
import { isTemplateHomeComposition, TEMPLATE_DEFAULT_ONLY } from "../lib/home-template-default";
import { messagesByLocale } from "../messages";
import enOverrides from "../messages-overrides/en.json";
import ukOverrides from "../messages-overrides/uk.json";
import { customSections } from "../config/custom-sections";
import { HomeSections, HomeSectionsView } from "./home-sections";

// The DEFAULT home config (`config/home.ts`) as the home route renders it, against a frozen copy of its markup taken before
// the per-section `width` and the `custom` kind existed (plan 2026-11-08-design-changeability.md, L4): with default settings
// the page must stay byte for byte the same. UPSTREAM PINS: skipped (named so in the test names) once a fork changes its home
// composition or overrides texts, so reshaping the home page by config and new files never needs a test edit.

const templateTexts = Object.keys(ukOverrides).length + Object.keys(enOverrides).length === 0;
const templatePage = isTemplateHomeComposition(homeSections) && templateTexts;

const results: Readonly<Record<string, HomeSectionResult>> = {
  "home-banners": {
    status: "ok",
    data: {
      kind: "banners",
      banners: storeBannerViews(
        [
          {
            id: "11111111-1111-4111-8111-111111111111",
            layout: "card",
            title: "Banner",
            text: null,
            href: "/catalog",
            tone: "accent",
            image: { url: "https://cdn.example.com/x.webp", width: 2, height: 1, alt: null },
          },
        ],
        "uk",
        ["cdn.example.com"],
      ),
    },
  },
  "home-categories": {
    status: "ok",
    data: {
      kind: "categories",
      categories: [category("clothing", [category("tops"), category("shirts")]), category("books")],
    },
  },
  "home-new-products": {
    status: "ok",
    data: { kind: "productRow", products: [summary("a"), summary("b")], exponent: 2 },
  },
};

function renderDefault(locale: Locale): string {
  const t = createTranslator(messagesByLocale[locale], locale);
  // The frozen copy was taken with the route's `Container` around the sections; the sections now bring it themselves.
  return renderToStaticMarkup(
    <HomeSectionsView
      sections={homeSections}
      context={{ locale, t, imageHosts: ["cdn.example.com"] }}
      results={results}
    />,
  );
}

/** What the home route renders (`HomeSections`, streaming), fully resolved, without React's boundary comments. */
async function renderPage(locale: Locale): Promise<string> {
  const t = createTranslator(messagesByLocale[locale], locale);
  const { prelude } = await prerenderToNodeStream(
    <HomeSections
      sections={homeSections}
      context={{ locale, t, imageHosts: ["cdn.example.com"] }}
      load={(section) => Promise.resolve(results[section.id] ?? { status: "error" })}
    />,
    // Every finished boundary in place (no outlined segment), so the markup compares with the static view.
    { progressiveChunkSize: Number.POSITIVE_INFINITY },
  );
  let html = "";
  for await (const chunk of prelude) html += String(chunk);
  return html;
}

function frozen(locale: Locale): string {
  return readFileSync(
    new URL(`./home-sections-frozen/default.${locale}.txt`, import.meta.url),
    "utf8",
  );
}

describe.skipIf(!templatePage)(
  `the default home page (${TEMPLATE_DEFAULT_ONLY}, and no text overrides)`,
  () => {
    for (const locale of ["uk", "en"] as const) {
      it(`renders byte for byte as the frozen copy (${locale})`, () => {
        const html = renderDefault(locale);
        expect(html.length).toBe(frozen(locale).length);
        expect(html).toBe(frozen(locale));
      });

      it(`streams the same markup on the route (${locale}): no new boundary, no loading view`, async () => {
        const html = await renderPage(locale);
        // A finished Suspense boundary is written as `<!--$-->` ... `<!--/$-->`: still only the category tiles and the
        // product row stream (ADR 0048), nothing else waits behind a boundary or a loading view.
        expect(html.match(/<!--\$-->/g)).toHaveLength(2);
        expect(html).not.toContain('aria-busy="true"');
        expect(html.replace(/<!--\/?\$-->/g, "")).toBe(frozen(locale));
      });
    }
  },
);

describe.skipIf(Object.keys(customSections).length > 0)(
  "the fork-owned custom section registry (template default only: skipped once a fork registers a section)",
  () => {
    it("ships empty", () => {
      expect(customSections).toEqual({});
    });
  },
);
