"use client";

import { Skeleton, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { sessionLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import type { SessionState } from "../lib/account-store";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";
import { navLink } from "./styles";

/**
 * "Sign in" for a guest, the customer's first name for a signed-in shopper, "My account" otherwise. When the state cannot be read the neutral account link is shown (the
 * account pages handle a missing session themselves). The slot has a fixed minimum width, so nothing shifts.
 */
export function AccountLinkView({
  state,
  t,
  locale,
}: {
  state: SessionState;
  t: Translator;
  locale: Locale;
}) {
  return (
    <div className="inline-flex min-w-28 justify-end" aria-live="polite">
      {state.status === "loading" ? (
        <>
          <Skeleton className="h-6 w-24" />
          <VisuallyHidden>{t("nav.account.loading")}</VisuallyHidden>
        </>
      ) : state.status === "guest" ? (
        <Link href={localizedHref(locale, sessionLinks.signIn)} className={navLink}>
          {t("nav.account.signIn")}
        </Link>
      ) : state.status === "signedIn" ? (
        <Link href={localizedHref(locale, sessionLinks.account)} className={`${navLink} max-w-48`}>
          {/* The name is the customer's own text: rendered as text only, cut with an ellipsis when it is long. */}
          <span className="truncate">
            {t("nav.account.named", { name: state.customer.firstName })}
          </span>
        </Link>
      ) : (
        <Link href={localizedHref(locale, sessionLinks.account)} className={navLink}>
          {t("nav.account.account")}
        </Link>
      )}
    </div>
  );
}

/** The session comes from the shared account store (`SessionProvider`): one `GET /store/account/me` per page load; 401 means guest. */
export function AccountLink() {
  const { locale, t } = useI18n();
  const { state } = useAccount();
  return <AccountLinkView state={state.session} t={t} locale={locale} />;
}
