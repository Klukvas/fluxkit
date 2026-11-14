import { Suspense } from "react";
import { getShopExponent } from "../lib/catalog-pages.server";
import { imageHosts } from "../lib/image-hosts.server";
import { CartDrawer } from "./cart-drawer";

/** Server-only settings use the same cached shop config and image allow-list as the cart page. */
async function ResolvedCartDrawer() {
  return <CartDrawer exponent={await getShopExponent()} imageHosts={imageHosts()} />;
}

/** Only the optional overlay can suspend; the page and header retain their existing streaming boundary. */
export function CartDrawerSettings() {
  return (
    <Suspense fallback={null}>
      <ResolvedCartDrawer />
    </Suspense>
  );
}
