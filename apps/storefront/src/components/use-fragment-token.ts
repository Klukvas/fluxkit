import { useEffect, useState } from "react";
import { takeFragmentToken } from "../lib/fragment-token";

/**
 * The token of the page's `#t=` fragment, read in the browser after hydration (the server never has it) and removed from
 * the address bar at once (`takeFragmentToken`). The token lives in this state only.
 *
 * `undefined` while the fragment has not been read yet (the server render and the first client render), `null` when the
 * link has no usable token, else the token. A later `hashchange` (a second link pasted into the same tab) is read the same
 * way. A strict-mode double effect is harmless: the second read finds no fragment and keeps what the first one found.
 */
export function useFragmentToken(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    function read(): void {
      const found = takeFragmentToken(window);
      if (found.kind === "token") setToken(found.token);
      else if (found.kind === "malformed") setToken(null);
      else setToken((current) => (current === undefined ? null : current));
    }
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return token;
}
