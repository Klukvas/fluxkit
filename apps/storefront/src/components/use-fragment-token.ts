import { useEffect, useState } from "react";
import { takeFragmentToken } from "../lib/fragment-token";

/** The token of the fragment and how many links were read so far (a page that waits for a press starts over on each). */
export interface FragmentTokenRead {
  readonly token: string | null | undefined;
  readonly reads: number;
}

/**
 * The token of the page's `#t=` fragment, read in the browser after hydration (the server never has it) and removed from
 * the address bar at once (`takeFragmentToken`). The token lives in this state only.
 *
 * `token` is `undefined` while the fragment has not been read yet (the server render and the first client render), `null`
 * when the link has no usable token, else the token. A later `hashchange` (a second link pasted into the same tab) is read
 * the same way and counts as a new read even when it holds the same token. A strict-mode double effect is harmless: the
 * second read finds no fragment and keeps what the first one found.
 */
export function useFragmentTokenRead(): FragmentTokenRead {
  const [state, setState] = useState<FragmentTokenRead>({ token: undefined, reads: 0 });
  useEffect(() => {
    function read(): void {
      const found = takeFragmentToken(window);
      if (found.kind === "token") {
        setState((current) => ({ token: found.token, reads: current.reads + 1 }));
      } else if (found.kind === "malformed") {
        setState((current) => ({ token: null, reads: current.reads + 1 }));
      } else {
        setState((current) =>
          current.token === undefined ? { token: null, reads: current.reads + 1 } : current,
        );
      }
    }
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return state;
}

/** `useFragmentTokenRead` when only the token matters. */
export function useFragmentToken(): string | null | undefined {
  return useFragmentTokenRead().token;
}
