import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LEGAL_PLACEHOLDER_MARKER,
  cookieTable,
  legalIdentity,
  legalPages,
  privacyPageSlug,
  termsPageSlug,
} from "../config/legal";
import { footerLinks } from "../layout/navigation";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { LegalPage } from "./legal-page";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();
const srcRoot = join(import.meta.dirname, "..");

describe("legal pages configuration", () => {
  it("has a route folder for every configured page and a configured page for every route folder", () => {
    for (const page of legalPages) {
      expect(
        existsSync(join(srcRoot, "app", "[locale]", "(site)", "legal", page.slug, "page.tsx")),
        page.slug,
      ).toBe(true);
    }
    const slugs = legalPages.map((page) => page.slug);
    expect(slugs).toEqual(["privacy", "terms", "cookies"]);
    expect(slugs).toContain(privacyPageSlug);
    expect(slugs).toContain(termsPageSlug);
  });

  it("links every legal page from the footer, with the page's own title key", () => {
    for (const page of legalPages) {
      expect(footerLinks).toContainEqual({ labelKey: page.labelKey, href: `/legal/${page.slug}` });
    }
  });

  it("ships no client identity: master's controller details are all unset", () => {
    expect(legalIdentity).toEqual({
      shopLegalName: null,
      shopLegalAddress: null,
      privacyContact: null,
      lastUpdated: null,
    });
  });

  it("has a title, an intro and the marker for the placeholder in both languages", () => {
    for (const messages of [en, uk] as Record<string, string>[]) {
      for (const page of legalPages) {
        expect(messages[page.labelKey], page.labelKey).toBeTruthy();
        expect(messages[`legal.${page.slug}.intro`], page.slug).toBeTruthy();
      }
      expect(messages["legal.placeholder.marker"]).toContain(LEGAL_PLACEHOLDER_MARKER);
    }
  });
});

describe("the cookie statement", () => {
  it("lists exactly the cookies the API sets for a shopper, by the names its cookie modules define", () => {
    const apiSource = (file: string) =>
      readFileSync(join(srcRoot, "..", "..", "api", "src", file), "utf8");
    const defined = [
      /export const CART_COOKIE_NAME = "([a-z_]+)";/.exec(apiSource("cart/cart-cookie.ts"))?.[1],
      /export const CUSTOMER_SESSION_COOKIE_NAME = "([a-z_]+)";/.exec(
        apiSource("customers/auth/customer-session-cookie.ts"),
      )?.[1],
    ];
    expect(cookieTable.map((row) => row.name)).toEqual(defined);
  });

  it("has the purpose, the moment and the lifetime of every row in both languages", () => {
    for (const messages of [en, uk] as Record<string, string>[]) {
      for (const row of cookieTable) {
        for (const column of ["purpose", "when", "kept"]) {
          expect(
            messages[`legal.cookies.row.${row.id}.${column}`],
            `${row.id} ${column}`,
          ).toBeTruthy();
        }
      }
    }
  });

  it("says there is no consent banner, because no cookie is used for analytics, advertising or a third party", () => {
    // The statement is a fact about the template, guarded elsewhere (no third-party origin in the CSP, no document.cookie);
    // the text must keep saying it.
    expect(en["legal.cookies.intro"]).toMatch(/analytics or advertising/);
    expect(en["legal.cookies.intro"]).toMatch(/no cookie banner/);
  });
});

describe("a legal page", () => {
  it("renders every page without hardcoded text, with one h1 and the template marker message", () => {
    for (const page of legalPages) {
      const html = renderToStaticMarkup(<LegalPage slug={page.slug} locale="en" t={t} />);
      // The cookie names are technical identifiers, not words.
      const withoutNames = cookieTable.reduce((text, row) => text.replace(row.name, ""), html);
      expect(leftoverText(withoutNames), page.slug).toBe("");
      expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
      expect(html.match(/<h1/g), page.slug).toHaveLength(1);
      expect(html).toContain("§legal.placeholder.marker");
      expect(html).toContain("§legal.placeholder.title");
    }
  });

  it("shows a visible placeholder for every identity value that is still unset", () => {
    const html = renderToStaticMarkup(<LegalPage slug="privacy" locale="en" t={t} />);
    expect(html.match(/§legal\.identity\.unset/g)).toHaveLength(3);
    expect(html).toContain("§legal.updated.unset");
  });

  it("renders the cookie table with a caption, column headers and one row per cookie", () => {
    const html = renderToStaticMarkup(<LegalPage slug="cookies" locale="en" t={t} />);
    expect(html).toContain("<caption");
    expect(html.match(/<th scope="col"/g)).toHaveLength(4);
    for (const row of cookieTable) {
      expect(html).toContain(row.name);
      expect(html).toContain(`§legal.cookies.row.${row.id}.purpose`);
    }
    expect(html).not.toContain("<input");
    expect(html).not.toContain("checkbox");
  });

  it("points a signed-in customer to their data page and a guest to the contact, on the privacy page", () => {
    // The link sits inside the translator's sentence, so this needs the real messages (the sentinel has no slot).
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const html = renderToStaticMarkup(
        <LegalPage slug="privacy" locale={locale} t={createTranslator(messages, locale)} />,
      );
      expect(html).toContain(`href="/${locale}/account/data"`);
      expect(html).toContain((messages as Record<string, string>)["legal.privacy.guests"]);
    }
  });

  it("renders with the real messages in uk and en with no raw key left and the marker visible", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const real = createTranslator(messages, locale);
      for (const page of legalPages) {
        const html = renderToStaticMarkup(<LegalPage slug={page.slug} locale={locale} t={real} />);
        expect(html).not.toMatch(/legal\.[a-z]+\.[A-Za-z_.]+/);
        expect(html).toContain(LEGAL_PLACEHOLDER_MARKER.replace("'", "&#x27;"));
      }
    }
  });
});
