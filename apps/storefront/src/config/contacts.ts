/**
 * How a shopper reaches the shop (repair batch 2, plan docs/plans/2026-11-06-storefront-shop-pages.md). Internal to the
 * storefront: a client fork edits THIS object and the `contacts.*` messages. Read by the footer, the `contacts` page section
 * (`config/shop-pages.ts`) and nothing else; the trust bar's contact line links to the contacts page.
 *
 * Every part is optional: `null`, `""` or `[]` hides that part, and with every part empty the footer and the page show no
 * contacts block at all (never an empty label). `lib/contacts.ts` `contactsView` checks the values and throws on a malformed
 * one (the template's own code). The footer reads them in the root layout, so a malformed value fails EVERY page at request time,
 * site-wide; `config/contacts.spec.ts` runs the same check in CI, so it never reaches a deployment unnoticed:
 * - a phone's `tel` is E.164 (`+` and 7 to 15 digits, the `tel:` link), `display` is how it is written on the page;
 * - the email is a plain address (it becomes a `mailto:` link, so no `?`, spaces or other parts);
 * - messenger, social and map links are absolute `https://` addresses with a host (the banner link rule, `lib/home-banners.ts`).
 *
 * TODO(fluxkit): demo values (`demo-content.json` `contacts`), chosen so that they reach nobody: a phone in the unassigned
 * `+380 00` range, an `example.com` address (reserved, RFC 2606) and an "Example Street" address. No messenger or map link.
 */

export interface ShopPhone {
  /** E.164, for the `tel:` link: `+380441234567`. */
  tel: string;
  /** As shown: `+380 44 123 45 67`. Digits and spacing only, no words (words belong in messages). */
  display: string;
}

export interface ShopContactLink {
  /** Unique: the list key. */
  id: string;
  /** Message key of the link text ("Telegram", "Instagram"). */
  labelKey: string;
  /** `https://` only. */
  href: string;
}

export interface ShopContacts {
  phones: readonly ShopPhone[];
  email: string | null;
  /** Message key of the postal or shop address (the address differs by language), or `null`. */
  addressKey: string | null;
  /** Message key of the working hours, or `null`. */
  hoursKey: string | null;
  /** Messengers and social pages. */
  links: readonly ShopContactLink[];
  /** A map of the address (`https://`), or `null`. */
  mapHref: string | null;
}

export const shopContacts: ShopContacts = {
  phones: [{ tel: "+380000000000", display: "+380 00 000 00 00" }],
  email: "shop@example.com",
  addressKey: "contacts.demo.address",
  hoursKey: "contacts.demo.hours",
  links: [],
  mapHref: null,
};
