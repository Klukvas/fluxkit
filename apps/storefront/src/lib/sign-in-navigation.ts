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

export function shouldRedirectAccountGuest(status: string, modalActive: boolean): boolean {
  return status === "guest" && !modalActive;
}
