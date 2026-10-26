import { expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { E2E_MAIL_FILE, E2E_ORIGIN } from "./env.ts";

/**
 * The mails the API's `fake` email provider accepted, read from `FAKE_EMAIL_CAPTURE_FILE` (one JSON object per line, oldest
 * first). Only what a test needs is typed. The links in a mail are `{STOREFRONT_PUBLIC_URL}/{locale}/account/<page>#t=<token>`.
 */
export interface CapturedMail {
  to: { address: string };
  subject: string;
  text: string;
  html: string;
  tags: { category: string };
}

export type LinkKind = "reset-password" | "verify-email";

export interface MailLink {
  /** The whole link, to open with `page.goto`. */
  url: string;
  locale: string;
  token: string;
}

export function readMailbox(file = E2E_MAIL_FILE): CapturedMail[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as CapturedMail);
}

const LINK = new RegExp(
  `${E2E_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([a-z]{2})/account/(reset-password|verify-email)#t=([A-Za-z0-9_-]+)`,
);

/** The link of one kind in the plain-text part of a mail, or `null` (the text part is the one a client always has). */
export function linkIn(mail: CapturedMail, kind: LinkKind): MailLink | null {
  const match = LINK.exec(mail.text);
  if (match === null || match[2] !== kind) return null;
  return { url: match[0], locale: match[1] as string, token: match[3] as string };
}

/**
 * The same link in another locale (the page reads the token from the fragment whatever the locale). Verification mails are
 * written in `DEFAULT_LOCALE` (`uk`), so a test that checks English wording opens the English page of the link.
 */
export function inLocale(link: MailLink, locale: "uk" | "en"): string {
  return link.url.replace(`/${link.locale}/account/`, `/${locale}/account/`);
}

/** Every link of this kind sent to this address, oldest first. */
export function linksTo(email: string, kind: LinkKind): MailLink[] {
  return readMailbox()
    .filter((mail) => mail.to.address === email)
    .flatMap((mail) => linkIn(mail, kind) ?? []);
}

/**
 * Waits (polling, no sleep) until this address has received at least `count` links of this kind, and returns the NEWEST.
 * The mail is sent after the answer of the API, so the file may lag behind the page by a moment.
 */
export async function newestLink(email: string, kind: LinkKind, count = 1): Promise<MailLink> {
  await expect
    .poll(() => linksTo(email, kind).length, { message: `${kind} mails to ${email}` })
    .toBeGreaterThanOrEqual(count);
  const links = linksTo(email, kind);
  return links[links.length - 1] as MailLink;
}

/** How many mails (of any kind) this address has received so far. */
export function mailCount(email: string): number {
  return readMailbox().filter((mail) => mail.to.address === email).length;
}
