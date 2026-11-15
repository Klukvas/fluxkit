/** In-memory presentation state only; Next owns the URL and browser history. */
export interface SignInOpener {
  readonly isConnected: boolean;
  focus(options?: { preventScroll?: boolean }): void;
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
  let entries: Entry[] = [];
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
      if (open && !wasOpen) {
        active =
          pending?.destination === destination
            ? pending
            : traversing
              ? (entries.findLast((entry) => entry.destination === destination) ?? null)
              : null;
        if (active !== null)
          entries = [...entries.filter((entry) => entry !== active), active].slice(-20);
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
