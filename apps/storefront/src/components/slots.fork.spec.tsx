import { createTranslator, type Locale } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { slots } from "../config/slots";
import type { FooterConfig } from "../layout/footer-layout";
import { footerLinks } from "../layout/navigation";
import { contactsView } from "../lib/contacts";
import { cardDisplay } from "../lib/product-card-model";
import { summary } from "../lib/test-fixtures";
import { messagesByLocale } from "../messages";
import { resolveCard } from "./cards/registry";
import { I18nProvider } from "./i18n-provider";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";

// Runs ONLY in `vitest.home-fork.config.ts`, where `config/slots.tsx` is a fork's (`lib/slots-fork-fixture.tsx`, texts in
// `lib/messages-extra-fork-fixture.{uk,en}.json`): every UI slot filled with config and new files only, plan S1 and section 1,
// request 5 (a four-column footer without a core edit).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/en/catalog",
  useSearchParams: () => new URLSearchParams(),
}));

const locale: Locale = "en";
const messages = messagesByLocale[locale];
const t = createTranslator(messages, locale);

/** The fork's `config/footer.ts` for four columns: the navigation and contacts move into the slot's columns. */
const fourColumnFooter: FooterConfig = {
  blocks: ["themeSwitch", "copyright"],
  navigation: { groups: [{ kind: "shopPages" }, { kind: "legal" }] },
};
const shopLinks = [
  { labelKey: "shopPages.about.title", href: "/about" },
  { labelKey: "shopPages.contacts.title", href: "/contacts" },
];
const contacts = contactsView({
  phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
  email: "hello@example.com",
  addressKey: null,
  hoursKey: null,
  links: [],
  mapHref: null,
});

const footer = renderToStaticMarkup(
  <I18nProvider locale={locale} messages={messages}>
    <SiteFooter
      locale={locale}
      t={t}
      year={2026}
      themeMode="light"
      showThemeSwitch
      shopLinks={shopLinks}
      contacts={contacts}
      config={fourColumnFooter}
    />
  </I18nProvider>,
);

const header = renderToStaticMarkup(
  <I18nProvider locale={locale} messages={messages}>
    <SessionProvider locale={locale}>
      <SiteHeader locale={locale} t={t} categories={[]} searchEnabled />
    </SessionProvider>
  </I18nProvider>,
);

describe("a fork's filled UI slots", () => {
  it("runs with the fork's slots and texts", () => {
    expect(Object.keys(slots)).toEqual([
      "header.top",
      "product-card.badges",
      "product-card.actions",
      "footer.columns",
    ]);
    expect(slots["footer.columns"]).toHaveLength(4);
    expect(messagesByLocale.uk["custom.slots.footer.newsletter"]).toBe("Розсилка");
  });

  it("renders a four-column footer: shop pages, legal pages, contacts and the newsletter placeholder, then the blocks", () => {
    expect(footer).toContain('<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">');
    const grid = footer.slice(footer.indexOf('<div class="grid gap-6'));
    expect(grid.match(/<(?:nav|section)\b[^>]*>/g)).toEqual([
      '<nav aria-label="Shop">',
      '<nav aria-label="Legal">',
      '<section aria-labelledby="fork-footer-contacts">',
      '<section aria-labelledby="fork-footer-newsletter" data-fork-newsletter="">',
    ]);
    expect(footer).toContain(
      `<a class="whitespace-normal" href="/en/about">${messages["shopPages.about.title"]}</a>`,
    );
    for (const link of footerLinks) expect(footer).toContain(`href="/en${link.href}"`);
    expect(footer).toContain('<a href="mailto:hello@example.com">hello@example.com</a>');
    expect(footer).toContain("Our newsletter is coming soon.");
    // The theme switch, the copyright and the powered-by line follow the columns; no second navigation, no second address.
    expect(footer.indexOf("fork-footer-newsletter")).toBeLessThan(footer.indexOf("fk-theme-form"));
    expect(footer.match(/<nav[ >]/g)).toHaveLength(2);
    expect(footer.match(/<address>/g)).toHaveLength(1);
    expect(footer).not.toContain(`aria-label="${messages["footer.nav.label"]}"`);
    expect(footer.endsWith(`<p>${messages["footer.powered"]}</p></div></footer>`)).toBe(true);
  });

  it("gives every column a heading and keeps the footer's texts translated", () => {
    const headings = [...footer.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]);
    expect(headings).toEqual(["Shop", "Legal", "Contacts", "Newsletter"]);
  });

  it("renders the announcement bar first inside the header, before the header row", () => {
    // CORE-EDIT (fork a1-reshape): this run reads the fork's real config/header.ts, whose `centred` layout renders another row class.
    expect(header).toMatch(
      /^<header class="fk-site-header"><div data-fork-announcement="" class="bg-primary text-primary-foreground"><div class="mx-auto w-full max-w-6xl px-4"><p class="py-2 text-center text-sm">Free delivery from 1 000 UAH<\/p><\/div><\/div><div class="mx-auto w-full max-w-6xl px-4 fk-header-(?:row|centred)">/,
    );
  });

  it("puts the badge and the action on both built-in cards, the action named with the product's title", () => {
    const card = cardDisplay({
      product: summary("lamp", { title: "Desk lamp" }),
      locale,
      t,
      exponent: 2,
      imageHosts: [],
      brandPath: null,
    });
    for (const kind of ["grid", "list"] as const) {
      const { Card } = resolveCard(kind);
      const html = renderToStaticMarkup(
        <Card card={card} headingLevel="h2" eager={false} locale={locale} t={t} />,
      );
      expect(html, kind).toContain('<div class="flex flex-wrap gap-1"><span');
      expect(html, kind).toContain(">New</span></div>");
      expect(html, kind).toContain('aria-label="Save Desk lamp" aria-pressed="false"');
    }
  });
});
