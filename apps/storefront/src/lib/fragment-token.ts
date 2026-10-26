import { tokenFromFragment } from "./order-links";

/**
 * Reading a bearer token from the URL fragment (`#t=...`) of an emailed link, once, in the browser (email plan step 10,
 * ADR 0031 decision on tokens): password reset and email verification links carry their token in the fragment, which a
 * browser never sends to a server, so it stays out of access logs, proxies and `Referer`.
 *
 * The fragment is REMOVED from the address bar the moment it is read (`history.replaceState`, same path and query, the
 * history entry's own state kept so Next's router is not confused), so the token is not in the visible URL, a bookmark, a
 * shared screen, the browser's history entry or a later `Referer`. The caller keeps the token in memory only.
 */

/** The slice of `window` this module uses, so a test can pass a fake. */
export interface FragmentWindow {
  location: { hash: string; pathname: string; search: string };
  history: {
    state: unknown;
    replaceState(data: unknown, unused: string, url?: string | null): void;
  };
}

export type FragmentRead =
  /** No fragment: nothing was read and nothing was touched. */
  | { kind: "none" }
  | { kind: "token"; token: string }
  /** A fragment that is not exactly one well-formed `t`: it is scrubbed as well and never shown or sent. */
  | { kind: "malformed" };

export function takeFragmentToken(win: FragmentWindow): FragmentRead {
  const { hash, pathname, search } = win.location;
  if (hash === "" || hash === "#") return { kind: "none" };
  const token = tokenFromFragment(hash);
  win.history.replaceState(win.history.state, "", `${pathname}${search}`);
  return token === null ? { kind: "malformed" } : { kind: "token", token };
}
