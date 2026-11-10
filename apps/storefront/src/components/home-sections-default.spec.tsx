import { readFileSync } from "node:fs";
import { Container, createTranslator, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { homeSections } from "../config/home";
import { storeBannerViews } from "../lib/home-banners";
import type { HomeSectionResult } from "../lib/home-data";
import { category, summary } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { HomeSectionsView } from "./home-sections";

// The DEFAULT home config (`config/home.ts`) as the home route renders it, against a frozen copy of its markup taken before
// the per-section `width` and the `custom` kind existed (plan 2026-11-08-design-changeability.md, L4): with default settings
// the page must stay byte for byte the same. Left out of `vitest.home-fork.config.ts` (a fork's home config differs on purpose).

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
  // The route's `Container` around the sections (`app/[locale]/(site)/(home)/page.tsx`).
  return renderToStaticMarkup(
    <Container>
      <HomeSectionsView
        sections={homeSections}
        context={{ locale, t, imageHosts: ["cdn.example.com"] }}
        results={results}
      />
    </Container>,
  );
}

function frozen(locale: Locale): string {
  return readFileSync(
    new URL(`./home-sections-frozen/default.${locale}.txt`, import.meta.url),
    "utf8",
  );
}

describe("the default home config", () => {
  for (const locale of ["uk", "en"] as const) {
    it(`renders byte for byte as the frozen copy (${locale})`, () => {
      const html = renderDefault(locale);
      expect(html.length).toBe(frozen(locale).length);
      expect(html).toBe(frozen(locale));
    });
  }
});
