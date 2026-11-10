import { textStyles } from "@fluxkit/ui";
import Link from "next/link";
import { paymentIcons, socialLinks, type SocialIcon } from "../config/social";
import type { FooterColumnsSlotProps, SlotLink } from "../lib/slots";
import { FooterContacts } from "./contact-details";
import { LocalPicture } from "./local-picture";

/**
 * FORK `footer.columns` components (`config/slots.tsx`): a four-column footer. `navigation` and `contacts` are left out of
 * `blocks` in `config/footer.ts`; these columns render them from the slot's props. The footer's own CSS styles column content
 * (`.fk-site-footer ul` a wrapping row, links `whitespace-nowrap`): lists get `flex-col`, links `whitespace-normal`.
 */

function LinkColumn({ label, links }: { label: string; links: readonly SlotLink[] }) {
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

/** Column 1: the shop pages. */
export function ShopColumn({ shopLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.shop")} links={shopLinks} />;
}

/** Column 2: the legal pages (always present: `config/legal.ts`). */
export function LegalColumn({ legalLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.legal")} links={legalLinks} />;
}

const iconPaths: Record<SocialIcon, string> = {
  photo: "M4 7h3l2-2h6l2 2h3v12H4zM12 10a3 3 0 1 0 0 6a3 3 0 0 0 0-6",
  video: "M3 6h13v12H3zM16 10l5-3v10l-5-3",
  chat: "M4 5h16v11H9l-5 4z",
};

/** Column 3: the contacts and the social profiles (`config/social.ts`). */
export function ContactsColumn({ contacts, t }: FooterColumnsSlotProps) {
  return (
    <section aria-labelledby="footer-contacts-title">
      <h2 id="footer-contacts-title" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.footer.contacts")}
      </h2>
      <FooterContacts contacts={contacts} />
      <ul aria-label={t("custom.footer.social")} className="mt-2">
        {socialLinks.map((link) => (
          <li key={link.href}>
            <a href={link.href} rel="noopener noreferrer" aria-label={t(link.labelKey)}>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              >
                <path d={iconPaths[link.icon]} />
              </svg>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Column 4: a newsletter PLACEHOLDER and the accepted payment methods.
 * TODO(fluxkit): no newsletter feature in the template; text only (no form that would post nowhere).
 */
export function NewsletterColumn({ t }: FooterColumnsSlotProps) {
  return (
    <section aria-labelledby="footer-newsletter-title" className="flex flex-col gap-2">
      <h2 id="footer-newsletter-title" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.footer.newsletter")}
      </h2>
      <p className="px-2">{t("custom.footer.newsletterSoon")}</p>
      <h2 className={`${textStyles.navGroupTitle} px-2 pt-2`}>{t("custom.footer.payment")}</h2>
      <ul className="items-center gap-2 px-2">
        {paymentIcons.map((icon) => (
          <li key={icon.src}>
            <LocalPicture
              image={{ src: icon.src, width: 48, height: 32, altKey: icon.altKey }}
              t={t}
              eager={false}
              sizes="48px"
              className="rounded-control border border-border"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
