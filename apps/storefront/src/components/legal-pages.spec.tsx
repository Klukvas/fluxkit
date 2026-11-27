import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator, type Translator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  LEGAL_PLACEHOLDER_MARKER,
  cookieTable,
  legalIdentity,
  legalPages,
  legalSections,
  privacyPageSlug,
  termsPageSlug,
  type LegalIdentity,
} from "../config/legal";
import { footerLinks } from "../layout/navigation";
import { messagesByLocale } from "../messages";
import { LegalPage } from "./legal-page";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const { uk, en } = messagesByLocale;

const t = sentinelTranslator();
const srcRoot = join(import.meta.dirname, "..");

async function renderWithIdentity(identity: LegalIdentity, translator: Translator = t) {
  vi.resetModules();
  vi.doMock("../config/legal", async () => ({
    ...(await vi.importActual<typeof import("../config/legal")>("../config/legal")),
    legalIdentity: identity,
  }));
  try {
    const { LegalPage: Page } = await import("./legal-page");
    return renderToStaticMarkup(
      <Page website="shop.example.test" slug="privacy" locale="en" t={translator} />,
    );
  } finally {
    vi.doUnmock("../config/legal");
    vi.resetModules();
  }
}

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
      shopTaxId: null,
      shopEmail: null,
      shopPhone: null,
      shopLegalAddress: null,
      privacyContact: null,
      lastUpdated: null,
    });
  });

  it("keeps the identity in the JSON file the release check also reads", () => {
    expect(legalIdentity).toEqual(
      JSON.parse(readFileSync(join(srcRoot, "config", "legal-identity.json"), "utf8")),
    );
  });

  it("has a title and an unmarked default intro for every page in both languages", () => {
    for (const messages of [en, uk] as Record<string, string>[]) {
      for (const page of legalPages) {
        expect(messages[page.labelKey], page.labelKey).toBeTruthy();
        expect(messages[`legal.${page.slug}.intro`], page.slug).toBeTruthy();
        expect(messages[`legal.${page.slug}.intro`], page.slug).not.toContain(
          LEGAL_PLACEHOLDER_MARKER,
        );
      }
      expect(messages["legal.placeholder.marker"]).toBeUndefined();
    }
  });
});

describe("the cookie statement", () => {
  it("lists exactly the cookies the API sets for a shopper, by the names its cookie modules define, and the storefront's theme cookie", () => {
    const apiSource = (file: string) =>
      readFileSync(join(srcRoot, "..", "..", "api", "src", file), "utf8");
    const defined = [
      /export const CART_COOKIE_NAME = "([a-z_]+)";/.exec(apiSource("cart/cart-cookie.ts"))?.[1],
      /export const CUSTOMER_SESSION_COOKIE_NAME = "([a-z_]+)";/.exec(
        apiSource("customers/auth/customer-session-cookie.ts"),
      )?.[1],
      // The storefront's own preference cookie (design batch B, `lib/theme-mode.ts`).
      /export const THEME_COOKIE = "([a-z_]+)";/.exec(
        readFileSync(join(srcRoot, "lib", "theme-mode.ts"), "utf8"),
      )?.[1],
    ];
    expect(defined).not.toContain(undefined);
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
    expect(en["legal.cookies.intro"]).toMatch(/no cookie banner|no consent banner/i);
  });
});

describe("a legal page", () => {
  it("shows the review box for listed pages, and the marker remains a backstop after review", async () => {
    for (const page of legalPages) {
      const html = renderToStaticMarkup(
        <LegalPage website="shop.example.test" slug={page.slug} locale="en" t={t} />,
      );
      expect(html).toContain("§legal.placeholder.title");
    }
    vi.resetModules();
    vi.doMock("../config/demo-content", () => ({ demoContent: { legalTexts: ["terms"] } }));
    try {
      const { LegalPage: ReviewedPage } = await import("./legal-page");
      const withMarker = Object.assign(
        (key: string) =>
          key.endsWith(".intro") ? `${LEGAL_PLACEHOLDER_MARKER} ${key}` : `§${key}`,
        { plural: t.plural },
      ) as Translator;
      for (const page of legalPages) {
        const marked = renderToStaticMarkup(
          <ReviewedPage website="shop.example.test" slug={page.slug} locale="en" t={withMarker} />,
        );
        expect(marked).toContain("§legal.placeholder.title");
        expect(marked).not.toContain("TODO");
        const written = renderToStaticMarkup(
          <ReviewedPage website="shop.example.test" slug={page.slug} locale="en" t={t} />,
        );
        expect(written.includes("§legal.placeholder.title"), page.slug).toBe(page.slug === "terms");
      }
    } finally {
      vi.doUnmock("../config/demo-content");
      vi.resetModules();
    }
  });

  it("renders every page without hardcoded text and with one h1", () => {
    for (const page of legalPages) {
      const html = renderToStaticMarkup(
        <LegalPage website="shop.example.test" slug={page.slug} locale="en" t={t} />,
      );
      // The cookie names are technical identifiers, not words; the breadcrumb separator is decorative (as in shop-pages.spec).
      const withoutNames = cookieTable
        .reduce((text, row) => text.replace(row.name, ""), html)
        .replace(/<span aria-hidden="true">\/<\/span>/g, "")
        .replace(/>\d+\. §/g, ">§");
      expect(leftoverText(withoutNames), page.slug).toBe("");
      expect(html, page.slug).toContain('aria-label="§breadcrumbs.label"');
      expect(html, page.slug).toContain('href="/en"');
      expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
      expect(html.match(/<h1/g), page.slug).toHaveLength(1);
    }
  });

  it("shows a visible placeholder for every identity value that is still unset", () => {
    const html = renderToStaticMarkup(
      <LegalPage website="shop.example.test" slug="privacy" locale="en" t={t} />,
    );
    expect(html.match(/§legal\.identity\.unset(?=<)/g)).toHaveLength(6);
    expect(html).toContain("§legal.updated.unset");
  });

  it("renders seller rows in order and omits a repeated privacy email only when shopEmail is set", async () => {
    for (const email of [null, "shop@example.test", "privacy@example.test"]) {
      const html = await renderWithIdentity({
        ...legalIdentity,
        shopEmail: email,
        privacyContact: "privacy@example.test",
      });
      const seller = html.slice(html.indexOf('<section aria-labelledby="legal-identity"'));
      const labels = [...seller.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((match) => match[1]);
      expect(labels).toEqual([
        "§legal.identity.name",
        "§legal.identity.taxId",
        "§legal.identity.address",
        "§legal.identity.phone",
        "§legal.identity.email",
        ...(email === "privacy@example.test" ? [] : ["§legal.identity.contact"]),
      ]);
    }
    const blank = await renderWithIdentity({ ...legalIdentity, shopEmail: "  " });
    expect(blank).toContain('text-muted-foreground">§legal.identity.unset</span>');
    expect(blank).toContain("§legal.identity.contact");
  });

  it("supplies the same complete interpolation set to every intro and body, with real seller values", async () => {
    const identity = {
      ...legalIdentity,
      shopLegalName: "Example seller",
      shopTaxId: "12345678",
      shopLegalAddress: "Example address",
      shopEmail: "shop@example.test",
      shopPhone: "+380001234567",
      privacyContact: "privacy@example.test",
    };
    const real = createTranslator(en, "en");
    const translated = Object.assign(vi.fn(real), { plural: real.plural });
    const html = await renderWithIdentity(identity, translated);
    const values = {
      sellerName: identity.shopLegalName,
      sellerTaxId: identity.shopTaxId,
      sellerAddress: identity.shopLegalAddress,
      sellerEmail: identity.shopEmail,
      sellerPhone: identity.shopPhone,
      privacyEmail: identity.privacyContact,
      website: "shop.example.test",
    };
    const keys = [
      "legal.privacy.intro",
      ...legalSections.privacy.map((section) => section.bodyKey),
    ];
    for (const key of keys)
      expect(translated.mock.calls.find(([called]) => called === key)?.[1], key).toEqual(values);
    expect(html).toContain("Example seller");
    expect(html).toContain("privacy@example.test");
    expect(html).not.toContain("{");
    // Shared paragraph rendering splits section bodies and the rights block on blank lines.
    const rights = html.slice(
      html.indexOf('<section aria-labelledby="legal-rights"'),
      html.indexOf('<section aria-labelledby="legal-identity"'),
    );
    expect(rights.match(/<p /g)?.length).toBe(5);
  });

  it("renders the cookie table with a caption, column headers and one row per cookie", () => {
    const html = renderToStaticMarkup(
      <LegalPage website="shop.example.test" slug="cookies" locale="en" t={t} />,
    );
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
        <LegalPage
          website="shop.example.test"
          slug="privacy"
          locale={locale}
          t={createTranslator(messages, locale)}
        />,
      );
      expect(html).toContain(`href="/${locale}/account/data"`);
      expect(html).toContain(
        createTranslator(messages, locale)("legal.privacy.guests", {
          privacyEmail: createTranslator(messages, locale)("legal.identity.unsetInline"),
        }),
      );
    }
  });

  it("renders with the real messages in uk and en with no raw key left, the placeholder box shown and the marker NOT shown", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const real = createTranslator(messages, locale);
      for (const page of legalPages) {
        const html = renderToStaticMarkup(
          <LegalPage website="shop.example.test" slug={page.slug} locale={locale} t={real} />,
        );
        expect(html).not.toMatch(/legal\.[a-z]+\.[A-Za-z_.]+/);
        expect(html).not.toContain("{");
        for (const [index, section] of legalSections[page.slug].entries()) {
          expect(html).toContain(`id="legal-section-${section.id}"`);
          expect(html).toContain(`${index + 1}. ${real(section.titleKey ?? "")}</h2>`);
        }
        // The review list shows the box; a legacy marker is never shown.
        expect(html).not.toContain(LEGAL_PLACEHOLDER_MARKER.replace("'", "&#x27;"));
        expect(html).toContain(messages["legal.placeholder.title"]);
      }
    }
  });
});
