import { Badge, Container, textStyles } from "@fluxkit/ui";
import Link from "next/link";
import { FooterContacts } from "../components/contact-details";
import type {
  FooterColumnsSlotProps,
  HeaderTopSlotProps,
  ProductCardSlotProps,
  SlotLink,
  SlotRegistry,
} from "./slots";
import { ForkSaveButton } from "./slots-save-button-fork-fixture";

/**
 * A client fork's `config/slots.tsx` as it would write it, for the fork runs `vitest.home-fork.config.ts` and
 * `vitest.brand-fork.config.ts` only (its texts are in
 * `messages-extra-fork-fixture.{uk,en}.json`): every slot filled, so the unit suite runs again as such a fork has it and a spec
 * that depends on empty slots fails upstream, not in a fork (plan 2026-11-08-design-changeability.md, S1 and section 1,
 * request 5: a four-column footer with config and new files only). Server components, token classes, translated texts.
 */

/** An announcement bar above the header row: its own opaque surface, the content in the page width. */
function ForkAnnouncement({ t }: HeaderTopSlotProps) {
  return (
    <div data-fork-announcement="" className="bg-primary text-primary-foreground">
      <Container>
        <p className="py-2 text-center text-sm">{t("custom.slots.announcement")}</p>
      </Container>
    </div>
  );
}

/** A badge on every card (a real fork decides from the view model, for example `publishedAt` once the list item has it). */
function ForkNewBadge({ t }: ProductCardSlotProps) {
  return <Badge variant="neutral">{t("custom.slots.badge")}</Badge>;
}

/**
 * An action: a control of its own (not a second link to the product: the title stays the card's link), a client island
 * rendered with plain, translated props; its own opaque surface, a 44 px target and an accessible name with the title.
 */
function ForkSaveAction({ card, t }: ProductCardSlotProps) {
  return (
    <ForkSaveButton
      label={t("custom.slots.save", { title: card.title })}
      text={t("custom.slots.saveShort")}
    />
  );
}

/**
 * A column of links. The footer's own rules (`.fk-site-footer nav`, `ul`, `ul a` in app/globals.css) style these too: the list
 * is a wrapping row and each link `whitespace-nowrap`. In a column the list stacks (`flex-col`) and long names such as the
 * legal pages wrap (`whitespace-normal`): utilities win over those component rules.
 */
function LinkColumn({ label, links }: { label: string; links: readonly SlotLink[] }) {
  if (links.length === 0) return null;
  return (
    <nav aria-label={label}>
      <h2 className={`${textStyles.navGroupTitle} px-2`}>{label}</h2>
      <ul className="flex-col">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="whitespace-normal">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Column 1: the shop pages, with their own labelled navigation. */
function ForkShopColumn({ shopLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.slots.footer.shop")} links={shopLinks} />;
}

/** Column 2: the legal pages. */
function ForkLegalColumn({ legalLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.slots.footer.legal")} links={legalLinks} />;
}

/** Column 3: the contacts, rendered by the template's own `FooterContacts`. */
function ForkContactsColumn({ contacts, t }: FooterColumnsSlotProps) {
  if (contacts.phones.length === 0 && contacts.email === null) return null;
  return (
    <section aria-labelledby="fork-footer-contacts">
      <h2 id="fork-footer-contacts" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.slots.footer.contacts")}
      </h2>
      <FooterContacts contacts={contacts} />
    </section>
  );
}

/**
 * Column 4: a newsletter PLACEHOLDER (TODO(fluxkit): the template has no newsletter feature; a fork wires its own form here).
 * Text only: no form that would post nowhere.
 */
function ForkNewsletterColumn({ t }: FooterColumnsSlotProps) {
  return (
    <section aria-labelledby="fork-footer-newsletter" data-fork-newsletter="">
      <h2 id="fork-footer-newsletter" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.slots.footer.newsletter")}
      </h2>
      <p className="px-2">{t("custom.slots.footer.newsletterSoon")}</p>
    </section>
  );
}

export const slots: SlotRegistry = {
  "header.top": [ForkAnnouncement],
  "product-card.badges": [ForkNewBadge],
  "product-card.actions": [ForkSaveAction],
  "footer.columns": [ForkShopColumn, ForkLegalColumn, ForkContactsColumn, ForkNewsletterColumn],
};
