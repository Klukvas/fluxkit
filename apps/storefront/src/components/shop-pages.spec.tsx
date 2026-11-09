import { createTranslator, type Translator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LEGAL_PLACEHOLDER_MARKER, legalPages, withoutLegalMarker } from "../config/legal";
import { shopPages, type ShopPageConfig } from "../config/shop-pages";
import { contactsView, type ContactsView } from "../lib/contacts";
import { buildSitemap } from "../lib/sitemap";
import { messagesByLocale } from "../messages";
import { LegalPage } from "./legal-page";
import { ProductPageNote } from "./product-page-note";
import { ShopPage } from "./shop-page";
import { SiteFooter } from "./site-footer";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";
import { StoreTrustBar } from "./trust-bar";

const { uk, en } = messagesByLocale;

// The route module reads the public origin and calls Next's `notFound`; both are stubs here.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/en",
}));
vi.mock("../lib/public-url.server", () => ({
  publicOrigin: () => Promise.resolve("https://shop.example"),
}));

const t = sentinelTranslator();
const none: ContactsView = contactsView({
  phones: [],
  email: null,
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
});
const full: ContactsView = contactsView({
  phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
  email: "hello@example.com",
  addressKey: "contacts.demo.address",
  hoursKey: "contacts.demo.hours",
  links: [{ id: "telegram", labelKey: "contacts.links", href: "https://t.me/example" }],
  mapHref: "https://maps.example.com/x",
});

function pageOf(slug: string): ShopPageConfig {
  const found = shopPages.find((entry) => entry.slug === slug);
  if (found === undefined) throw new Error(slug);
  return found;
}

function render(slug: string, contacts: ContactsView = none, translator: Translator = t): string {
  return renderToStaticMarkup(
    <ShopPage page={pageOf(slug)} locale="uk" t={translator} contacts={contacts} />,
  );
}

describe("a shop page", () => {
  it("has one h1, breadcrumbs to home, the lead, and every section title as an h2; no hardcoded text", () => {
    for (const entry of shopPages) {
      const html = render(entry.slug);
      expect(html.match(/<h1/g), entry.slug).toHaveLength(1);
      expect(html).toContain(`>§${entry.titleKey}</h1>`);
      expect(html).toContain(`§${entry.descriptionKey}`);
      expect(html).toContain('href="/uk"');
      expect(html).toContain('aria-label="§breadcrumbs.label"');
      expect(html).toContain('aria-current="page"');
      // Size values (XS, 80–84) are language-neutral data of the config, not words.
      // The breadcrumb separator `/` is a decorative character of `Breadcrumbs`.
      const withoutValues = html
        .replace(/>(XS|S|M|L|XL)</g, "><")
        .replace(/<span aria-hidden="true">\/<\/span>/g, "");
      expect(leftoverText(withoutValues), entry.slug).toBe("");
      expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
    }
  });

  it("draws the delivery rows and the size chart as tables with a caption, column and row headers", () => {
    const delivery = render("delivery-and-payment");
    expect(delivery).toContain(
      '<caption class="sr-only">§shopPages.delivery.methods.caption</caption>',
    );
    expect(delivery.match(/<th scope="col"/g)).toHaveLength(3);
    // One row per method the demo checkout really offers: the courier (UX round 2, batch 3A item 2).
    expect(delivery.match(/<th scope="row"/g)).toHaveLength(1);
    expect(delivery).toContain("§shopPages.delivery.methods.courier.cost");
    expect(delivery).not.toMatch(/§shopPages\.delivery\.methods\.(branch|pickup)\./);
    // A wide table scrolls in its own box, never the page.
    expect(delivery).toContain("overflow-x-auto");
    const sizes = render("size-guide");
    expect(sizes.match(/<th scope="row"/g)).toHaveLength(5);
    expect(sizes).toContain(">96–100<");
  });

  it("promises no delivery or payment method the demo checkout does not offer (no branch, locker, pickup or cash)", () => {
    const delivery = shopPages.find((entry) => entry.slug === "delivery-and-payment");
    const keys = Object.keys(uk).filter(
      (key) => key.startsWith("shopPages.delivery.") || key.startsWith("shopPages.faq."),
    );
    expect(delivery).toBeDefined();
    for (const messages of [uk, en] as Record<string, string>[]) {
      for (const key of keys) {
        expect(messages[key], key).not.toMatch(
          /відділен|поштомат|самовивіз|післяплат|накладен|готівк|branch|locker|pickup|pick up|cash/i,
        );
      }
    }
  });

  it("shows the FAQ as closed native disclosures, the question a heading inside the summary", () => {
    const html = render("faq");
    const faq = shopPages.find((entry) => entry.slug === "faq");
    const items = faq?.sections.find((section) => section.kind === "faq");
    expect(items?.kind).toBe("faq");
    const count = items?.kind === "faq" ? items.items.length : 0;
    expect(html.match(/<details/g)).toHaveLength(count);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toMatch(
      /<summary[^>]*><h2 id="faq-faq-questions-order"[^>]*>§shopPages\.faq\.order\.question<\/h2>/,
    );
    expect(html).toContain('role="region" aria-labelledby="faq-faq-questions-order"');
    expect(html).toContain("§shopPages.faq.order.answer");
  });

  it("links the enabled pages of a see-also list, with the locale", () => {
    const html = render("faq");
    for (const slug of ["delivery-and-payment", "returns", "size-guide", "contacts"]) {
      expect(html).toContain(`href="/uk/${slug}"`);
    }
  });

  it("shows the contacts that are set, as tel:, mailto: and https links, and no contacts block when none is set", () => {
    const html = render("contacts", full);
    expect(html).toContain('<a href="tel:+380441234567"');
    expect(html).toContain(">+380 44 123 45 67</a>");
    expect(html).toContain('<a href="mailto:hello@example.com"');
    expect(html).toContain('href="https://t.me/example"');
    expect(html).toContain('href="https://maps.example.com/x"');
    for (const label of ["phone", "email", "address", "hours", "links"]) {
      expect(html).toContain(`§contacts.${label}`);
    }
    expect(html).toContain("<address");
    const empty = render("contacts", none);
    expect(empty).not.toContain("<address");
    expect(empty).not.toContain("§contacts.");
    expect(empty).not.toContain("§shopPages.contacts.details.title");
    // Only the email: one row, no empty labels.
    const onlyEmail = render("contacts", { ...none, email: full.email, empty: false });
    expect(onlyEmail).toContain("§contacts.email");
    expect(onlyEmail).not.toContain("§contacts.phone");
    expect(onlyEmail).not.toContain("§contacts.hours");
  });

  it("renders real words in both languages (the message files are complete for every page)", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const translator = createTranslator(messages, locale);
      for (const entry of shopPages) {
        expect(render(entry.slug, contactsView(), translator)).not.toContain("§");
      }
    }
  });
});

describe("the footer", () => {
  it("links the shop pages and shows the phone and email; nothing of the contacts when they are empty", () => {
    const html = renderToStaticMarkup(
      <SiteFooter locale="en" t={t} year={2026} themeMode="light" contacts={full} />,
    );
    for (const entry of shopPages.filter((item) => item.inFooter)) {
      // No class on a footer link: `.fk-site-footer ul a` styles it (first-HTML budget).
      expect(html).toContain(`<li><a href="/en/${entry.slug}">§${entry.titleKey}</a></li>`);
    }
    expect(html).not.toContain('href="/en/size-guide"');
    expect(html).toContain("<address><a");
    // Real whitespace between the phone and the email (review m8 of PR 232), none before the first or after the last.
    expect(html).toMatch(
      /<address><a href="tel:[^"]+">[^<]+<\/a><br\/><a href="mailto:[^"]+">[^<]+<\/a><\/address>/,
    );
    expect(html).toContain('href="tel:+380441234567"');
    expect(html).toContain('href="mailto:hello@example.com"');
    // The address, the hours and the messengers live on the contacts page, not in the footer budget.
    expect(html).not.toContain("t.me");
    const empty = renderToStaticMarkup(
      <SiteFooter locale="en" t={t} year={2026} themeMode="light" contacts={none} shopLinks={[]} />,
    );
    expect(empty).not.toContain("<address");
    expect(empty.match(/<ul/g)).toHaveLength(1);
    expect(empty).toContain('class="fk-theme-option"');
  });
});

describe("the trust bar and the product page note", () => {
  it("makes the contact line a link to the contacts page, and keeps a line without a page as text", () => {
    const html = renderToStaticMarkup(<StoreTrustBar t={t} locale="uk" />);
    expect(html).toContain('href="/uk/contacts"');
    expect(html).toMatch(/<a [^>]*href="\/uk\/contacts"[^>]*>§trust\.contact<\/a>/);
    expect(html).toContain("<span>§trust.payment</span>");
    expect(html).toContain('data-trust-bar=""');
  });

  it("leaves the line as text when its page is not enabled", () => {
    const html = renderToStaticMarkup(
      <StoreTrustBar
        t={t}
        locale="uk"
        items={[{ icon: "contact", messageKey: "trust.contact", page: "contacts" }]}
      />,
    );
    expect(html).toContain('href="/uk/contacts"');
    // A slug that no enabled page has: plain text.
    const missing = renderToStaticMarkup(
      <StoreTrustBar
        t={t}
        locale="uk"
        items={[
          {
            icon: "contact",
            messageKey: "trust.contact",
            page: "not-a-page" as "contacts",
          },
        ]}
      />,
    );
    expect(missing).not.toContain("<a");
    expect(missing).toContain("<span>§trust.contact</span>");
  });

  it("shows the delivery summary under the buy box with links to the delivery and returns pages", () => {
    const html = renderToStaticMarkup(<ProductPageNote locale="en" t={t} />);
    expect(html).toContain("§shopPages.productNote.title");
    expect(html).toContain("§shopPages.delivery.summary");
    expect(html).toContain('href="/en/delivery-and-payment"');
    expect(html).toContain('href="/en/returns"');
    expect(leftoverText(html)).toBe("");
  });
});

describe("the legal pages never show the developer marker (repair batch 2)", () => {
  it("strips the marker and the full stop after it, and leaves other texts alone", () => {
    expect(withoutLegalMarker(`${LEGAL_PLACEHOLDER_MARKER}. Text here.`)).toBe("Text here.");
    expect(withoutLegalMarker(`${LEGAL_PLACEHOLDER_MARKER} Text`)).toBe("Text");
    expect(withoutLegalMarker("Own text.")).toBe("Own text.");
  });

  it("keeps the placeholder box while the text carries the marker, but not the marker itself, in both languages", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const translator = createTranslator(messages, locale);
      for (const page of legalPages) {
        const html = renderToStaticMarkup(
          <LegalPage slug={page.slug} locale={locale} t={translator} />,
        );
        expect(html, `${locale} ${page.slug}`).not.toContain("TODO");
        expect(html).not.toContain("fluxkit)");
        expect(html).not.toContain("[");
        expect(html).toContain(messages["legal.placeholder.title"]);
      }
    }
  });
});

describe("the shop page route", () => {
  it("answers not found for an unknown slug and an unknown locale, and renders a known page", async () => {
    const route = await import("../app/[locale]/(pages)/[page]/page");
    const params = (locale: string, page: string) => ({
      params: Promise.resolve({ locale, page }),
    });
    await expect(route.generateMetadata(params("en", "no-such-page"))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    await expect(route.default(params("en", "no-such-page"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(route.default(params("xx", "faq"))).rejects.toThrow("NEXT_NOT_FOUND");
    const metadata = await route.generateMetadata(params("en", "faq"));
    const english = createTranslator(en, "en");
    expect(metadata.title).toBe(
      english("seo.pageTitle", {
        title: english("shopPages.faq.title"),
        site: english("site.name"),
      }),
    );
    expect(metadata.description).toBe(en["shopPages.faq.description"]);
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe("https://shop.example/en/faq");
    expect(metadata.alternates?.languages).toMatchObject({
      uk: "https://shop.example/uk/faq",
      en: "https://shop.example/en/faq",
    });
    const element = await route.default(params("uk", "returns"));
    const html = renderToStaticMarkup(element);
    expect(html).toContain(uk["shopPages.returns.title"]);
    expect(html).toContain('"@type":"BreadcrumbList"');
  });
});

describe("the sitemap", () => {
  it("lists the shop pages in every locale", () => {
    const entries = buildSitemap({
      origin: "https://shop.example",
      locales: ["uk", "en"],
      defaultLocale: "uk",
      categories: [],
      products: [],
      shopPages: ["/faq", "/contacts"],
    });
    const urls = entries.map((entry) => entry.url);
    expect(urls).toContain("https://shop.example/uk/faq");
    expect(urls).toContain("https://shop.example/en/contacts");
  });
});
