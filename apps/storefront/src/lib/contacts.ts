import { shopContacts, type ShopContacts } from "../config/contacts";
import { checkBannerHref } from "./home-banners";

/**
 * The shop's contacts as the footer and the contacts page render them (`config/contacts.ts`). Pure. Empty parts (`null`, `""`,
 * blank, `[]`) are dropped, so a block is shown only for what is set; a malformed value throws (the config is the template's
 * own code, never shopper data).
 */

export interface ContactsView {
  phones: { href: string; text: string }[];
  email: { href: string; text: string } | null;
  addressKey: string | null;
  hoursKey: string | null;
  links: { id: string; href: string; labelKey: string }[];
  mapHref: string | null;
  /** Nothing to show at all: the footer block and the page section are left out. */
  empty: boolean;
}

const E164 = /^\+[1-9]\d{6,14}$/;
/** Digits, spaces, `+`, `(`, `)`, `-` and `.`: a written phone number, nothing a shopper could mistake for words. */
const PHONE_DISPLAY = /^[0-9+() .-]+$/;
/**
 * A plain address only: it becomes `mailto:<address>`, so no `?`, `&`, `=`, spaces or quotes (in the local part either) can add
 * headers or a body, and no `%` (some mail handlers decode it). A plus-address (`shop+orders@`) stays valid.
 */
const EMAIL = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const ID = /^[a-z][a-z0-9-]*$/;

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/** An `https://` address with a host and no credentials (the banner link rule); anything else throws. */
function httpsHref(href: string, what: string): string {
  const result = checkBannerHref(href);
  if (!result.ok || result.kind !== "https") {
    throw new RangeError(`The ${what} "${href}" is not an https:// address.`);
  }
  return new URL(href).href;
}

export function contactsView(contacts: ShopContacts = shopContacts): ContactsView {
  const phones = contacts.phones
    .filter((phone) => !blank(phone.tel) || !blank(phone.display))
    .map((phone) => {
      if (!E164.test(phone.tel)) {
        throw new RangeError(
          `The phone "${phone.tel}" is not in E.164 form (+ and 7 to 15 digits).`,
        );
      }
      if (blank(phone.display) || !PHONE_DISPLAY.test(phone.display)) {
        throw new RangeError(`The phone display "${phone.display}" must be a written number.`);
      }
      return { href: `tel:${phone.tel}`, text: phone.display.trim() };
    });
  let email: ContactsView["email"] = null;
  if (!blank(contacts.email)) {
    const address = (contacts.email as string).trim();
    if (!EMAIL.test(address))
      throw new RangeError(`The email "${address}" is not a plain address.`);
    email = { href: `mailto:${address}`, text: address };
  }
  const ids = new Set<string>();
  const links = contacts.links
    .filter((link) => !blank(link.href))
    .map((link) => {
      if (!ID.test(link.id) || ids.has(link.id)) {
        throw new RangeError(`The contact link id "${link.id}" is malformed or repeated.`);
      }
      ids.add(link.id);
      return { id: link.id, href: httpsHref(link.href, "contact link"), labelKey: link.labelKey };
    });
  const mapHref = blank(contacts.mapHref)
    ? null
    : httpsHref(contacts.mapHref as string, "map link");
  const addressKey = blank(contacts.addressKey) ? null : contacts.addressKey;
  const hoursKey = blank(contacts.hoursKey) ? null : contacts.hoursKey;
  return {
    phones,
    email,
    addressKey,
    hoursKey,
    links,
    mapHref,
    empty:
      phones.length === 0 &&
      email === null &&
      addressKey === null &&
      hoursKey === null &&
      links.length === 0 &&
      mapHref === null,
  };
}
