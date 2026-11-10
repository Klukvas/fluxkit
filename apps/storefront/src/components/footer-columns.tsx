import { textStyles, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { SVGProps } from "react";
import type { LocalImage } from "../config/home";
import { socialLinks, type SocialLink } from "../config/social";
import type { FooterColumnsSlotProps, SlotLink } from "../lib/slots";
import { FooterContacts } from "./contact-details";
import { LocalPicture } from "./local-picture";
import { focusRing } from "./styles";

/**
 * The four columns of the fork's footer (`footer.columns` slot, `config/slots.tsx`): the shop pages, the legal pages, the
 * contacts with the social icons, and a newsletter placeholder with the payment icons. `config/footer.ts` lists only
 * `themeSwitch` and `copyright` as blocks, so the template's own navigation and contacts blocks are not drawn twice. SERVER
 * components; the footer's own CSS styles lists and links (`.fk-site-footer ul` a wrapping row, links `whitespace-nowrap`), so
 * a column's list gets `flex-col` and its links `whitespace-normal`.
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

export function ShopColumn({ shopLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.shop")} links={shopLinks} />;
}

export function LegalColumn({ legalLinks, t }: FooterColumnsSlotProps) {
  return <LinkColumn label={t("custom.footer.legal")} links={legalLinks} />;
}

function SocialIcon({ icon, ...props }: { icon: SocialLink["icon"] } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
      className="fk-icon"
      {...props}
    >
      {icon === "instagram" ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <path d="M17.5 6.5h.01" />
        </>
      ) : icon === "facebook" ? (
        <path d="M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8.5A.5.5 0 0 1 14 8Z" />
      ) : (
        <path d="M21 4 3 11l5 2 2 6 3-4 5 4 3-15ZM8 13l9-6" />
      )}
    </svg>
  );
}

/** Social icons: external links (so `rel`), each a 44 px target with the network's name as its accessible name. */
function SocialIcons({ t }: { t: Translator }) {
  return (
    <ul aria-label={t("custom.footer.social.label")} className="gap-x-1">
      {socialLinks.map((link) => (
        <li key={link.id}>
          <a
            href={link.href}
            rel="noopener noreferrer"
            aria-label={t(link.labelKey)}
            className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-0 text-foreground hover:bg-muted ${focusRing}`}
          >
            <SocialIcon icon={link.icon} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function ContactsColumn({ contacts, t }: FooterColumnsSlotProps) {
  return (
    <section aria-labelledby="footer-contacts-title">
      <h2 id="footer-contacts-title" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.footer.contacts")}
      </h2>
      <FooterContacts contacts={contacts} />
      <SocialIcons t={t} />
    </section>
  );
}

/**
 * Payment icons: pictures under `public/payments/` shown with `LocalPicture` (internal, not contract: `docs/customization.md`).
 * TODO(fluxkit): neutral placeholder drawings ("card", "cash", "transfer"), not real payment-scheme marks; the client's real marks
 * (and the ones its payment providers allow) replace the files.
 */
const PAYMENT_ICONS: readonly { id: string; image: LocalImage }[] = [
  {
    id: "card",
    image: {
      src: "/payments/card.svg",
      width: 64,
      height: 40,
      altKey: "custom.footer.payment.card",
    },
  },
  {
    id: "cash",
    image: {
      src: "/payments/cash.svg",
      width: 64,
      height: 40,
      altKey: "custom.footer.payment.cash",
    },
  },
  {
    id: "transfer",
    image: {
      src: "/payments/transfer.svg",
      width: 64,
      height: 40,
      altKey: "custom.footer.payment.transfer",
    },
  },
];

/**
 * A newsletter PLACEHOLDER above the payment icons. TODO(fluxkit): the template has no newsletter feature (it would be an
 * optional feature module and needs consent handling, `docs/privacy/`). Disabled controls and no form element: nothing can be typed
 * or sent, so no personal data is collected until a real sign-up is wired.
 */
export function NewsletterPaymentsColumn({ t }: FooterColumnsSlotProps) {
  return (
    <section aria-labelledby="footer-newsletter-title" className="flex flex-col gap-2">
      <h2 id="footer-newsletter-title" className={`${textStyles.navGroupTitle} px-2`}>
        {t("custom.footer.newsletter")}
      </h2>
      <div className="flex gap-2 px-2">
        <input
          type="email"
          disabled
          aria-label={t("custom.footer.newsletter.email")}
          placeholder={t("custom.footer.newsletter.email")}
          className="min-h-11 min-w-0 flex-1 rounded-control border border-border-input bg-background px-3 text-foreground"
        />
        <button
          type="button"
          disabled
          className="min-h-11 rounded-control bg-muted px-4 font-medium text-muted-foreground"
        >
          {t("custom.footer.newsletter.submit")}
        </button>
      </div>
      <p className="px-2 text-sm">{t("custom.footer.newsletter.soon")}</p>
      <ul aria-label={t("custom.footer.payment.label")} className="items-center gap-x-2 px-2 pt-2">
        {PAYMENT_ICONS.map((icon) => (
          <li key={icon.id}>
            <LocalPicture
              image={icon.image}
              t={t}
              eager={false}
              sizes="64px"
              className="h-8 w-auto"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
