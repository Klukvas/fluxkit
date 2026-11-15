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

interface Entry {
  destination: string;
  origin: string;
  kind: "push" | "replace";
  opener: SignInOpener | null;
}

export function createSignInNavigation() {
  let pending: Entry | null = null;
  let active: Entry | null = null;
  let wasOpen = false;
  let closing = false;
  let traversing = false;
  let entries: { destination: string; entry: Entry | null }[] = [];
  let traversalHistoryComplete = true;
  return {
    prepare(entry: Entry) {
      pending = entry;
    },
    traversal() {
      traversing = true;
      pending = null;
    },
    route(open: boolean, destination: string) {
      const returning = !open && wasOpen && active?.origin === destination;
      const opener = returning ? active?.opener : null;
      if (open && (!wasOpen || pending !== null || traversing)) {
        const matches = entries.filter((record) => record.destination === destination);
        active =
          pending?.destination === destination
            ? pending
            : traversing && traversalHistoryComplete && matches.length === 1
              ? (matches[0]?.entry ?? null)
              : null;
        // Next exposes no entry index. Never guess between identical URLs (including unknown entries).
        if (!traversing && traversalHistoryComplete) {
          entries = [...entries, { destination, entry: active }];
          if (entries.length > 20) {
            // Eviction would make a duplicate appear unique again: stop restoring traversal metadata.
            entries = [];
            traversalHistoryComplete = false;
          }
        }
        closing = false;
      }
      if (!open) active = null;
      wasOpen = open;
      pending = null;
      traversing = false;
      return { skipFocus: open || returning, restoreFocus: returning, opener };
    },
    dismiss(): "back" | "home" | null {
      if (closing) return null;
      closing = true;
      return active?.kind === "push" ? "back" : "home";
    },
  };
}

export function shouldRedirectAccountGuest(status: string, modalActive: boolean): boolean {
  return status === "guest" && !modalActive;
}
