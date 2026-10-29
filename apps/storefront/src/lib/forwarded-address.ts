import { isIP } from "node:net";

/**
 * The address chain of a page request, for the API's per-address rate limit. Server code only.
 *
 * The search window of the API is 60 a minute per client address (ADR 0036). The results page is rendered by the Next
 * server, whose own address every shopper would share, so one busy minute would answer every shopper `429`. The edge proxy
 * sets `X-Forwarded-For` on page requests as well as on `/store/*` (README, "Deployment"); the Next server passes that
 * header on unchanged, and the API (`TRUST_PROXY` hops) counts the shopper, not the Next server: the Next server is one hop
 * in the chain exactly like the edge proxy is on the browser's path. Only a well-formed chain of at most 10 addresses
 * (the largest `TRUST_PROXY`) is passed on; anything else is dropped and the Next server's own address counts.
 */

const MAX_HOPS = 10;

export function forwardableAddresses(header: string | null): string | null {
  if (header === null || header.trim() === "") return null;
  const addresses = header.split(",").map((part) => part.trim());
  if (addresses.length > MAX_HOPS || addresses.some((address) => isIP(address) === 0)) return null;
  return addresses.join(", ");
}
