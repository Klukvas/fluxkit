"use client";

import { createStoreClient } from "@fluxkit/api-client";
import { Skeleton, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionLinks } from "../layout/navigation";
import { localizedHref } from "../lib/locale-path";
import { loadAccountLinkState, type AccountLinkState } from "../lib/session-state";
import { useI18n } from "./i18n-provider";
import { navLink } from "./styles";

/**
 * "Sign in" for a guest, "My account" otherwise. When the state cannot be read the neutral account link is shown (the
 * account pages handle a missing session themselves). The slot has a fixed minimum width, so nothing shifts.
 */
export function AccountLinkView({
  state,
  t,
  locale,
}: {
  state: AccountLinkState;
  t: Translator;
  locale: Locale;
}) {
  return (
    <span className="inline-flex min-w-28 justify-end" aria-live="polite">
      {state.status === "loading" ? (
        <>
          <Skeleton className="h-6 w-24" />
          <VisuallyHidden>{t("nav.account.loading")}</VisuallyHidden>
        </>
      ) : state.status === "guest" ? (
        <Link href={localizedHref(locale, sessionLinks.signIn)} className={navLink}>
          {t("nav.account.signIn")}
        </Link>
      ) : (
        <Link href={localizedHref(locale, sessionLinks.account)} className={navLink}>
          {t("nav.account.account")}
        </Link>
      )}
    </span>
  );
}

/** Reads the session once per page load, from the browser (the session cookie has `Path=/store`). 401 means guest. */
export function AccountLink() {
  const { locale, t } = useI18n();
  const [state, setState] = useState<AccountLinkState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    loadAccountLinkState(createStoreClient({ baseUrl: "" }), controller.signal).then(
      setState,
      (error: unknown) => {
        if (!controller.signal.aborted) throw error;
      },
    );
    return () => controller.abort();
  }, []);

  return <AccountLinkView state={state} t={t} locale={locale} />;
}
