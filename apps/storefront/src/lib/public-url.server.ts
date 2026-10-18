import { loadStorefrontEnv } from "@fluxkit/config";
import { connection } from "next/server";

/**
 * The public origin (`STOREFRONT_PUBLIC_URL`, no trailing slash) for canonical URLs, hreflang, the sitemap and JSON-LD.
 * Server code only. `connection()` first: the variable is a RUNTIME setting (a production server without it fails here,
 * loudly), so no prerender and no `next build` may read it.
 */
export async function publicOrigin(): Promise<string> {
  await connection();
  return loadStorefrontEnv(process.env).storefrontPublicUrl;
}
