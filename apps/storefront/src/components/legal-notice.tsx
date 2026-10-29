import type { Locale, Translator } from "@fluxkit/ui";
import Link from "next/link";
import { privacyPageSlug, termsPageSlug } from "../config/legal";
import { localizedHref } from "../lib/locale-path";
import { slotValues, splitMessage } from "../lib/rich-message";

/**
 * The information sentence at the two places where personal data is collected (privacy plan question 11, ADR 0033 decision
 * 11): registration and checkout. "By ... you accept the Terms. How we use your data is described in the Privacy notice."
 * with both as links. No checkbox and nothing stored: the contract needs no consent, the duty is to inform. The sentence is a
 * message (`notice.*`), so the word order and the wording are the shop's to replace.
 */

const SLOTS = ["terms", "privacy"] as const;

export type NoticeKind = "register" | "checkout";

export function noticeLinks(locale: Locale): { terms: string; privacy: string } {
  return {
    terms: localizedHref(locale, `/legal/${termsPageSlug}`),
    privacy: localizedHref(locale, `/legal/${privacyPageSlug}`),
  };
}

export function LegalNotice({
  t,
  kind,
  links,
}: {
  t: Translator;
  kind: NoticeKind;
  links: { terms: string; privacy: string };
}) {
  const parts = splitMessage(t(`notice.${kind}`, slotValues(SLOTS)), SLOTS);
  return (
    <p className="text-sm text-muted-foreground">
      {parts.map((part, index) =>
        part.kind === "text" ? (
          <span key={index}>{part.text}</span>
        ) : (
          <Link
            key={index}
            href={part.name === "terms" ? links.terms : links.privacy}
            className="underline underline-offset-4"
          >
            {t(part.name === "terms" ? "notice.termsLink" : "notice.privacyLink")}
          </Link>
        ),
      )}
    </p>
  );
}
