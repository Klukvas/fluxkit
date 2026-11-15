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
  return {
    recordOpener(activation: Activation) {
      latest = activation;
    },
    openerFor(destination: string): SignInOpener | null {
      return latest?.origin === destination && latest.opener.isConnected ? latest.opener : null;
    },
  };
}

export function shouldRedirectAccountGuest(status: string, modalActive: boolean): boolean {
  return status === "guest" && !modalActive;
}
