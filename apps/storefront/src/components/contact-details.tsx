import { textStyles, type Translator } from "@fluxkit/ui";
import { Fragment, type ReactNode } from "react";
import type { ContactsView } from "../lib/contacts";
import { focusRing } from "./styles";

/**
 * The shop's contacts (`config/contacts.ts` through `contactsView`). Server components: nothing here needs the browser. Every
 * row is rendered only when its value is set; with nothing set both render nothing.
 */

const linkClass = `inline-flex min-h-6 items-center break-all underline underline-offset-4 ${focusRing}`;

/** The contacts page section: a labelled list (phone, email, address, hours, messengers, map). */
export function ContactDetails({
  contacts,
  t,
  headingId,
  titleKey,
}: {
  contacts: ContactsView;
  t: Translator;
  headingId: string;
  titleKey?: string;
}) {
  if (contacts.empty) return null;
  const rows: { key: string; label: string; value: ReactNode }[] = [];
  if (contacts.phones.length > 0) {
    rows.push({
      key: "phone",
      label: t("contacts.phone"),
      value: (
        <ul className="flex flex-col gap-1">
          {contacts.phones.map((phone) => (
            <li key={phone.href}>
              <a href={phone.href} className={linkClass}>
                {phone.text}
              </a>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (contacts.email !== null) {
    rows.push({
      key: "email",
      label: t("contacts.email"),
      value: (
        <a href={contacts.email.href} className={linkClass}>
          {contacts.email.text}
        </a>
      ),
    });
  }
  if (contacts.addressKey !== null || contacts.mapHref !== null) {
    rows.push({
      key: "address",
      label: t("contacts.address"),
      value: (
        <span className="flex flex-col gap-1">
          {contacts.addressKey === null ? null : <span>{t(contacts.addressKey)}</span>}
          {contacts.mapHref === null ? null : (
            <a href={contacts.mapHref} className={linkClass} rel="noopener noreferrer">
              {t("contacts.map")}
            </a>
          )}
        </span>
      ),
    });
  }
  if (contacts.hoursKey !== null) {
    rows.push({ key: "hours", label: t("contacts.hours"), value: t(contacts.hoursKey) });
  }
  if (contacts.links.length > 0) {
    rows.push({
      key: "links",
      label: t("contacts.links"),
      value: (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {contacts.links.map((link) => (
            <li key={link.id}>
              <a href={link.href} className={linkClass} rel="noopener noreferrer">
                {t(link.labelKey)}
              </a>
            </li>
          ))}
        </ul>
      ),
    });
  }
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={titleKey === undefined ? "sr-only" : textStyles.sectionTitle}>
        {t(titleKey ?? "contacts.title")}
      </h2>
      <address className="not-italic">
        <dl className="flex max-w-xl flex-col gap-3 text-foreground">
          {rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
              <dt className="text-muted-foreground sm:w-40 sm:shrink-0">{row.label}</dt>
              <dd className="min-w-0">{row.value}</dd>
            </div>
          ))}
        </dl>
      </address>
    </section>
  );
}

/**
 * The footer's contacts: the phones and the email as plain links, no labels (a `tel:` or `mailto:` link speaks for itself) and
 * no class (`.fk-site-footer address` in app/globals.css): the footer is part of every page's first HTML, which has a size budget (README, "Keep the
 * header small"). The address, the hours and the messengers are on the contacts page.
 */
export function FooterContacts({ contacts }: { contacts: ContactsView }) {
  const links = [...contacts.phones, ...(contacts.email === null ? [] : [contacts.email])];
  if (links.length === 0) return null;
  return (
    // No class here or on the links: `.fk-site-footer address` styles them (app/globals.css). A `<br>` separates the links
    // (review m8 of PR 232): real whitespace for reader mode, copied text and screen readers' text view, so the number and the
    // address never run together; in the flex row it draws nothing, so the layout is unchanged.
    <address>
      {links.map((link, index) => (
        <Fragment key={link.href}>
          {index === 0 ? null : <br />}
          <a href={link.href}>{link.text}</a>
        </Fragment>
      ))}
    </address>
  );
}
