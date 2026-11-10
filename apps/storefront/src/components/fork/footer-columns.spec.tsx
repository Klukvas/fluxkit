import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { payIcons, socialLinks } from "../../config/footer-extras";
import { contactsView } from "../../lib/contacts";
import type { FooterColumnsSlotProps } from "../../lib/slots";
import { leftoverText, sentinelTranslator, textAttributes } from "../test-helpers";
import {
  FooterContactsColumn,
  FooterLegalColumn,
  FooterNewsletterColumn,
  FooterShopColumn,
} from "./footer-columns";

// FORK spec (reshape R5): the fork's four footer columns, rendered directly with the slot's plain view model (the slot
// registry is replaced by fixtures in upstream's fork runs).
const props: FooterColumnsSlotProps = {
  locale: "uk",
  t: sentinelTranslator(),
  shopLinks: [
    { label: "§delivery", href: "/uk/delivery-and-payment" },
    { label: "§returns", href: "/uk/returns" },
  ],
  legalLinks: [{ label: "§privacy", href: "/uk/legal/privacy" }],
  contacts: contactsView({
    phones: [{ tel: "+380441234567", display: "+380 44 123 45 67" }],
    email: null,
    addressKey: null,
    hoursKey: null,
    links: [],
    mapHref: null,
  }),
};

describe("the footer columns (fork, reshape R5)", () => {
  it("renders the shop and legal pages as two labelled navigations with stacked, wrapping links", () => {
    const shop = renderToStaticMarkup(<FooterShopColumn {...props} />);
    expect(shop).toMatch(/^<nav aria-label="§custom\.footer\.shop"><h2 [^>]*>§custom\.footer\.shop<\/h2>/);
    expect(shop).toContain('<ul class="flex-col">');
    expect(shop.match(/<a class="whitespace-normal" href="\/uk\//g)).toHaveLength(2);
    const legal = renderToStaticMarkup(<FooterLegalColumn {...props} />);
    expect(legal).toContain('aria-label="§custom.footer.legal"');
    expect(legal).toContain('href="/uk/legal/privacy"');
  });

  it("renders the contacts and the social links as named icon links to https addresses only", () => {
    const html = renderToStaticMarkup(
      <FooterContactsColumn
        {...props}
        social={[...socialLinks, { id: "bad", labelKey: "§", href: "/local", glyph: "photo" }]}
      />,
    );
    expect(html).toContain('<a href="tel:+380441234567">+380 44 123 45 67</a>');
    expect(html).toContain('<ul aria-label="§custom.footer.social.label">');
    const external = [...html.matchAll(/<a href="(https:[^"]*)" rel="noopener noreferrer"/g)];
    expect(external.map((match) => match[1])).toEqual(socialLinks.map((link) => link.href));
    for (const link of socialLinks) expect(html).toContain(`§${link.labelKey}</span>`);
    expect(html).not.toContain('href="/local"');
    const none = renderToStaticMarkup(<FooterContactsColumn {...props} social={[]} />);
    expect(none).not.toContain("<ul");
  });

  it("renders the newsletter as a text placeholder (no form) and the ways to pay as pictures with a text alternative", () => {
    const html = renderToStaticMarkup(<FooterNewsletterColumn {...props} />);
    expect(html).toContain("§custom.footer.newsletter.soon");
    expect(html).not.toMatch(/<form|<input|<button/);
    expect(textAttributes(html)).toEqual(payIcons.map((image) => `§${String(image.altKey)}`));
    expect(leftoverText(html)).toBe("");
  });

  it("returns one element per column (a fragment's parts would become separate grid cells)", () => {
    for (const Column of [
      FooterShopColumn,
      FooterLegalColumn,
      FooterContactsColumn,
      FooterNewsletterColumn,
    ]) {
      const html = renderToStaticMarkup(<Column {...props} />);
      expect(html).toMatch(/^<(nav|section)[\s\S]*<\/\1>$/);
    }
  });

  it("names social pages once each and pay pictures that exist under public/ with their real size", () => {
    expect(new Set(socialLinks.map((link) => link.id)).size).toBe(socialLinks.length);
    const publicRoot = join(import.meta.dirname, "..", "..", "..", "public");
    for (const image of payIcons) {
      const file = join(publicRoot, image.src);
      expect(existsSync(file), image.src).toBe(true);
      expect(readFileSync(file, "utf8")).toContain(
        `viewBox="0 0 ${String(image.width)} ${String(image.height)}"`,
      );
    }
  });
});
