import { focusPageHeading, type FocusableDocument } from "./navigation-focus";

/** In-memory presentation state only; Next owns the URL and browser history. */
export interface SignInOpener {
  readonly isConnected: boolean;
  focus(options?: { preventScroll?: boolean }): void;
}

/** Next 16 returns the whole intercepted path; its singular slot hook returns the last segment. */
export function isSignInModalActive(segments: readonly string[] | null): boolean {
  // Next returns null without a LayoutRouterContext (including standalone static markup renders).
  return segments?.[0] === "(.)account" && segments[1] === "login";
}

export function signInCloseAction(canGoBack: boolean | undefined): "back" | "home" {
  return canGoBack === true ? "back" : "home";
}

/** Includes a bare #, which also creates a same-document history entry under native navigation. */
export function isSameDocumentFragment(href: string, currentHref: string): boolean {
  const url = new URL(href, currentHref);
  return url.href.includes("#") && url.href.split("#")[0] === currentHref.split("#")[0];
}

export function isSignInOpenerLink({
  href,
  currentHref,
  loginPath,
  insideDialog,
}: {
  href: string;
  currentHref: string;
  loginPath: string;
  insideDialog: boolean;
}): boolean {
  if (insideDialog || isSameDocumentFragment(href, currentHref)) return false;
  const url = new URL(href, currentHref);
  return url.origin === new URL(currentHref).origin && url.pathname === loginPath;
}

interface Activation {
  origin: string;
  opener: SignInOpener;
}

/** Keep only the latest login-link activation for focus return; no history-entry bookkeeping. */
export function createSignInNavigation() {
  let latest: Activation | null = null;
  let postSignInHeading = false;
  return {
    setPostSignInHeading(pending: boolean) {
      postSignInHeading = pending;
    },
    takePostSignInHeading(): boolean {
      const pending = postSignInHeading;
      postSignInHeading = false;
      return pending;
    },
    recordOpener(activation: Activation) {
      latest = activation;
    },
    openerFor(destination: string): SignInOpener | null {
      return latest?.origin === destination && latest.opener.isConnected ? latest.opener : null;
    },
  };
}

/** Only page headings gain tabindex; a connected opener keeps its native keyboard behaviour. */
export function focusSignInDestination(
  destination: string,
  navigation: Pick<ReturnType<typeof createSignInNavigation>, "openerFor"> | null,
  doc: FocusableDocument,
): void {
  const opener = navigation?.openerFor(destination);
  if (opener) opener.focus({ preventScroll: true });
  else focusPageHeading(doc);
}

/**
 * Whether a protected page's gate is only the retained background of the sign-in modal. Next can commit the login pathname a
 * render before the slot's segments mark the modal active; a gate that acted on that render took the login page for its own
 * path and redirected again to a bare login address (its auth-page `next` dropped).
 */
export function isAccountGateBehindSignIn({
  pathname,
  loginPath,
  modalActive,
}: {
  pathname: string;
  loginPath: string;
  modalActive: boolean;
}): boolean {
  return modalActive || pathname === loginPath;
}

export function shouldRedirectAccountGuest(status: string, modalActive: boolean): boolean {
  return status === "guest" && !modalActive;
}
