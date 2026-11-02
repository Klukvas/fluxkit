"use client";

import { Skeleton, VisuallyHidden, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { accountLinks, guestLinks, sessionLinks } from "../layout/navigation";
import { failureText, type Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import type { SessionState } from "../lib/account-store";
import { HeaderDisclosure, menuItem } from "./header-menu";
import { useI18n } from "./i18n-provider";
import { UserIcon } from "./icons";
import { useAccount } from "./session-provider";
import { useLogout } from "./use-logout";

/**
 * The account as an icon with a menu (owner decision 2026-11-02). A guest gets "Sign in" and "Register"; a signed-in
 * customer the account pages (`accountLinks`) and "Sign out"; when the session could not be read, a plain link to the
 * account page (the account pages handle a missing session themselves). While the session is read the slot keeps its size
 * and says so to assistive technology. The customer's name is their own text: rendered as text only.
 */
export function AccountLinkView({
  state,
  t,
  locale,
  signOut = null,
}: {
  state: SessionState;
  t: Translator;
  locale: Locale;
  /** The "Sign out" entry of a signed-in customer's menu (`SignOutItem`, which needs the router). */
  signOut?: ReactNode;
}) {
  const slot = "inline-flex min-h-11 min-w-11 items-center justify-center";
  if (state.status === "loading") {
    return (
      <div className={slot} aria-live="polite">
        <Skeleton className="h-6 w-6 rounded-full" />
        <VisuallyHidden>{t("nav.account.loading")}</VisuallyHidden>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <Link
        href={localizedHref(locale, sessionLinks.account)}
        aria-label={t("nav.account.account")}
        className="fk-header-button"
      >
        <UserIcon />
      </Link>
    );
  }
  const signedIn = state.status === "signedIn";
  return (
    <HeaderDisclosure
      label={
        signedIn
          ? t("nav.account.named", { name: state.customer.firstName })
          : t("nav.account.menu")
      }
      summary={
        <>
          <UserIcon />
          {signedIn ? (
            // Shown from `md`; cut with an ellipsis when it is long.
            <span aria-hidden="true" className="hidden max-w-32 truncate text-sm md:inline">
              {state.customer.firstName}
            </span>
          ) : null}
        </>
      }
    >
      <ul className="flex flex-col">
        {(signedIn ? accountLinks : guestLinks).map((link) => (
          <li key={link.href}>
            <Link href={localizedHref(locale, link.href)} className={menuItem}>
              {t(link.labelKey)}
            </Link>
          </li>
        ))}
        {signedIn ? <li className="mt-1 border-t border-border pt-1">{signOut}</li> : null}
      </ul>
    </HeaderDisclosure>
  );
}

/** "Sign out" in the account menu: the shared logout (one request, home page after it), its failure under the button. */
export function SignOutItemView({
  t,
  pending,
  failure,
  onLogout,
}: {
  t: Translator;
  pending: boolean;
  failure: Failure | null;
  onLogout: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onLogout}
        disabled={pending}
        aria-busy={pending}
        className={`${menuItem} disabled:opacity-50`}
      >
        {pending ? t("account.logout.pending") : t("account.logout")}
      </button>
      {failure === null ? null : (
        <p role="alert" className="px-3 py-2 text-sm text-danger">
          {failureText(t, failure)}
        </p>
      )}
    </>
  );
}

function SignOutItem() {
  const { t } = useI18n();
  const { pending, failure, logout } = useLogout();
  return <SignOutItemView t={t} pending={pending} failure={failure} onLogout={logout} />;
}

/** The session comes from the shared account store (`SessionProvider`): one `GET /store/account/me` per page load; 401 means guest. */
export function AccountLink() {
  const { locale, t } = useI18n();
  const { state } = useAccount();
  return (
    <AccountLinkView
      state={state.session}
      t={t}
      locale={locale}
      signOut={state.session.status === "signedIn" ? <SignOutItem /> : null}
    />
  );
}
