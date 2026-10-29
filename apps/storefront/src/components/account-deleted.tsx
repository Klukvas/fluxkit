"use client";

import { Alert, Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect } from "react";
import { localizedHref } from "../lib/locale-path";
import { useI18n } from "./i18n-provider";
import { useAccount, useCart } from "./session-provider";
import { linkButton } from "./styles";

/** The confirmation after a deletion: what happened, in plain words, and a way back to the shop. */
export function AccountDeletedView({ t, locale }: { t: Translator; locale: Locale }) {
  return (
    <Container className="flex max-w-xl flex-col gap-4 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t("account.data.deleted.title")}</h1>
      <Alert variant="success">
        <p>{t("account.data.deleted.body")}</p>
      </Alert>
      <p className="text-foreground">{t("account.data.deleted.orders")}</p>
      <div>
        <Link href={localizedHref(locale, "/")} className={linkButton}>
          {t("account.data.deleted.home")}
        </Link>
      </div>
    </Container>
  );
}

/**
 * `/account/deleted`. The page is public (the session is gone): it reads the session and the cart once, so the header shows
 * a signed-out shopper with an empty cart, whatever the way here was (a visit without a deletion changes nothing: the read
 * answers the truth).
 */
export function AccountDeleted() {
  const { t, locale } = useI18n();
  const { store } = useAccount();
  const cart = useCart();
  useEffect(() => {
    void store.refresh();
    void cart.store.refresh();
  }, [store, cart.store]);
  return <AccountDeletedView t={t} locale={locale} />;
}
