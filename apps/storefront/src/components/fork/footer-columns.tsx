import { textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import {
  payIcons,
  socialLinks,
  type SocialGlyphName,
  type SocialLink,
} from "../../config/footer-extras";
import { checkBannerHref } from "../../lib/home-banners";
import type { FooterColumnsSlotProps, SlotLink } from "../../lib/slots";
import { FooterContacts } from "../contact-details";
import { LocalPicture } from "../local-picture";

/**
 * FORK (reshape R5): the four columns of the footer, the `footer.columns` slot (`config/slots.tsx`, `docs/contracts/slots.md`):
 * the shop pages, the legal pages, the contacts with the social links, and a newsletter placeholder with the ways to pay.
 * `config/footer.ts` leaves `navigation` and `contacts` out of its blocks (these columns render them) and keeps the theme
 * switch and the copyright below. Server components, token classes, texts through `t`.
 *
 * The footer's own rules style what a column renders (`.fk-site-footer ul`, `ul a`, `address` in app/globals.css: a wrapping
 * row of 44 px links): a link list stacks with `flex-col` and lets long names wrap with `whitespace-normal`.
 */

const columnTitle = `${textStyles.navGroupTitle} px-2`;

function LinkColumn({ label, links }: { label: string; links: readonly SlotLink[] }) {
  return (
    <nav aria-label={label}>
      <h2 className={columnTitle}>{label}</h2>
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

/** Column 1: the shop pages. With no page the heading stays, so the grid keeps its four cells. */
export function FooterShopColumn({ shopLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.shop")} links={shopLinks} />;
}

/** Column 2: the legal pages. */
export function FooterLegalColumn({ legalLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.legal")} links={legalLinks} />;
}

/** A neutral line glyph (24 x 24, `currentColor`), decorative: the link carries the name. Not a network's logo. */
function SocialGlyph({ name }: { name: SocialGlyphName }) {
  const paths: Record<SocialGlyphName, string> = {
    photo: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    message: "M21 4 3 11l6 2 2 6 3-4 4 3z",
    video: "M3 6h18v12H3zM10 9.5v5l4.5-2.5z",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

/** Only `https://` addresses with a host and no credentials (the banner link rule); a slot component must not throw. */
function isHttpsAddress(href: string): boolean {
  const result = checkBannerHref(href);
  return result.ok && result.kind === "https";
}

/** Column 3: the contacts (the template's `FooterContacts`) and the social links as icon links to other sites. */
export function FooterContactsColumn({
  contacts,
  t,
  social = socialLinks,
}: FooterColumnsSlotProps & {
  /** `config/footer-extras.ts`; a prop for tests. */
  social?: readonly SocialLink[];
}) {
  const links = social.filter((link) => isHttpsAddress(link.href));
  return (
    <section aria-labelledby="footer-contacts-title" className="flex flex-col gap-1">
      <h2 id="footer-contacts-title" className={columnTitle}>
        {t("custom.footer.contacts")}
      </h2>
      <FooterContacts contacts={contacts} />
      {links.length === 0 ? null : (
        <ul aria-label={t("custom.footer.social.label")}>
          {links.map((link) => (
            <li key={link.id}>
              <a href={link.href} rel="noopener noreferrer" className="min-w-11 justify-center">
                <SocialGlyph name={link.glyph} />
                <VisuallyHidden>{t(link.labelKey)}</VisuallyHidden>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Column 4: a newsletter PLACEHOLDER and the ways to pay.
 *
 * TODO(fluxkit): the template has no newsletter feature (it would be a feature module with its own consent and storage,
 * AGENTS.md sections 2.1 and 11), so this is text only: no form that would post nowhere. The pay pictures are placeholders too
 * (`config/footer-extras.ts`).
 */
export function FooterNewsletterColumn({ t }: FooterColumnsSlotProps) {
  return (
    <section
      aria-labelledby="footer-newsletter-title"
      data-newsletter-placeholder=""
      className="flex flex-col gap-1"
    >
      <h2 id="footer-newsletter-title" className={columnTitle}>
        {t("custom.footer.newsletter.title")}
      </h2>
      <p className="px-2">{t("custom.footer.newsletter.soon")}</p>
      {payIcons.length === 0 ? null : (
        <>
          <h2 className={`${columnTitle} mt-3`}>{t("custom.footer.pay.title")}</h2>
          <ul className="items-center gap-2 px-2 py-1">
            {payIcons.map((image) => (
              <li key={image.src}>
                <LocalPicture
                  image={image}
                  t={t}
                  eager={false}
                  sizes="64px"
                  className="h-8 w-auto rounded-media"
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
