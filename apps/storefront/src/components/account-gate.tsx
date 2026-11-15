"use client";

import type { Customer } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  Container,
  Skeleton,
  Spinner,
  textStyles,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isAccountGateBehindSignIn, shouldRedirectAccountGuest } from "../lib/sign-in-navigation";
import { localizedHref } from "../lib/locale-path";
import { sessionLinks } from "../layout/navigation";
import { useSignInNavigation } from "./sign-in-navigation";
import type { SessionState } from "../lib/account-store";
import { currentPath, loginHref } from "../lib/safe-next";
import { useI18n } from "./i18n-provider";
import { AccountBreadcrumbs, AccountLayoutView, AccountNav } from "./account-nav";
import { useAccount } from "./session-provider";
import { linkButton } from "./styles";

/**
 * What a protected account page shows for each state of the session: a skeleton while it is read, the page for a signed-in
 * customer, a link to sign in for a guest (the island also sends the browser there), and a retry when the session could
 * not be read at all.
 */
export function AccountGateView({
  state,
  t,
  title,
  signInHref,
  onRetry,
  children,
}: {
  state: SessionState;
  t: Translator;
  /** The page's `h1` while the page itself is not shown, so every state of the route has one heading. */
  title: string;
  signInHref: string;
  onRetry: () => void;
  children: (customer: Customer) => ReactNode;
}) {
  if (state.status === "signedIn") return <>{children(state.customer)}</>;
  if (state.status === "guest") {
    return (
      <Container className="flex flex-col items-start gap-4 py-8">
        <h1 className={textStyles.pageTitle}>{title}</h1>
        <p role="status" className="text-muted-foreground">
          {t("account.gate.redirecting")}
        </p>
        <Link href={signInHref} className={linkButton}>
          {t("account.gate.signIn")}
        </Link>
      </Container>
    );
  }
  if (state.status === "error") {
    return (
      <Container className="flex flex-col items-start gap-4 py-8">
        <h1 className={textStyles.pageTitle}>{title}</h1>
        <Alert variant="danger">{t("account.gate.error")}</Alert>
        <Button onClick={onRetry}>{t("account.gate.retry")}</Button>
      </Container>
    );
  }
  return (
    <Container className="flex flex-col gap-4 py-8" aria-busy="true">
      <h1 className={textStyles.pageTitle}>{title}</h1>
      <Spinner label={t("account.loading")} />
      <Skeleton className="h-24 w-full" />
    </Container>
  );
}

/**
 * Guards a page of the signed-in area. Without a session (also when it ends while the page is open: any account call that
 * answers 401 makes the store a guest) the browser goes to the login page with this page as `next`.
 */
export function AccountGate({
  titleKey,
  children,
}: {
  /** Message key of the page title, shown as the `h1` until the customer is known. */
  titleKey: string;
  children: (customer: Customer) => ReactNode;
}) {
  const { locale, t } = useI18n();
  const { state, store } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const navigation = useSignInNavigation();
  const protectedPath = useRef(pathname);
  const behindSignIn = isAccountGateBehindSignIn({
    pathname,
    loginPath: localizedHref(locale, sessionLinks.signIn),
    modalActive: navigation?.active ?? false,
  });
  // The query string (`?page=3`) is read in the browser only, after hydration: the server render has none, and the link must
  // not differ between the two. The redirect reads it again at the moment it happens, so it never uses a stale value.
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (behindSignIn) return;
    protectedPath.current = pathname;
    setSearch(window.location.search);
  }, [pathname, behindSignIn]);
  const signInHref = loginHref(locale, currentPath(protectedPath.current, search));

  useEffect(() => {
    if (shouldRedirectAccountGuest(state.session.status, behindSignIn)) {
      router.replace(loginHref(locale, currentPath(protectedPath.current, window.location.search)));
    }
  }, [state.session.status, router, locale, pathname, behindSignIn]);

  return (
    <AccountGateView
      state={state.session}
      t={t}
      title={t(titleKey)}
      signInHref={signInHref}
      onRetry={() => void store.refresh()}
    >
      {(customer) => (
        // Every signed-in account page gets the account menu (side menu on desktop, tabs on a phone; 2026-11-02).
        <AccountLayoutView nav={<AccountNav />} breadcrumbs={<AccountBreadcrumbs />}>
          {children(customer)}
        </AccountLayoutView>
      )}
    </AccountGateView>
  );
}
