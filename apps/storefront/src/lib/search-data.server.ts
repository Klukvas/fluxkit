import { loadStorefrontEnv } from "@fluxkit/config";
import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";
import { loadSearchEnabled } from "./catalog-data";
import { forwardableAddresses } from "./forwarded-address";
import { createSearchData } from "./search-data";
import { StoreUnavailableError } from "./store-data";
import { storeData } from "./store-data.server";

/**
 * The search reads of the running app. Server code only (a test keeps `.server` modules out of client files). `headers()`
 * is read here and nowhere else, for the forwarded address, and only when the operator switched the forwarding on
 * (`STOREFRONT_FORWARD_CLIENT_ADDRESS=true`, ADR 0037): a storefront reachable around the edge would otherwise let a client
 * choose its own rate-limit key. Off, every page read counts as the Next server's one address.
 */
export const searchData = createSearchData({
  baseUrl: () => loadStorefrontEnv(process.env).apiInternalUrl,
  beforeRequest: connection,
  forwardedFor: async () =>
    loadStorefrontEnv(process.env).forwardClientAddress
      ? forwardableAddresses((await headers()).get("x-forwarded-for"))
      : null,
});

/**
 * Whether the shop has search (`search` of the cached `GET /store/config`). Read once per request. The results page uses
 * this one: a config that cannot be read throws and the route's error page renders.
 */
export const getSearchEnabled = cache(() => loadSearchEnabled(storeData));

/**
 * The same for the header's search box. The header must not take every page down, so an API that cannot be read (already
 * logged by the store data layer) means no box, exactly like the header's category links; anything else throws.
 */
export async function headerSearchEnabled(): Promise<boolean> {
  try {
    return await getSearchEnabled();
  } catch (error) {
    if (error instanceof StoreUnavailableError) return false;
    throw error;
  }
}
