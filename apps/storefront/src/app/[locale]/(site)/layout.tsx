import type { ReactNode } from "react";
import { ensureStorefrontLocales } from "../../../lib/store-data.server";

/**
 * Fails loudly (logged error, `error.tsx`) when the API does not serve every locale the storefront renders. It runs at
 * request time on every page below, from a cached `GET /store/config`.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  await ensureStorefrontLocales();
  return children;
}
