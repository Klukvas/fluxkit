import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { CartPage } from "../../../../components/cart-page";
import { getShopExponent } from "../../../../lib/catalog-pages.server";
import { imageHosts } from "../../../../lib/image-hosts.server";
import { privateMetadata } from "../../../../lib/page-metadata";
import { routeLocale } from "../../../../lib/route-locale";
import { messagesByLocale } from "../../../../messages";

interface CartRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: CartRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "cart.title");
}

/**
 * Shell only. The cart itself is read in the browser (`CartPage`): its cookie has `Path=/store`, so the Next server never
 * sees it. The server contributes what the browser cannot know: the shop's currency digits and the image host allow-list.
 */
export default async function CartRoute({ params }: CartRouteProps) {
  await routeLocale(params);
  return <CartPage exponent={await getShopExponent()} imageHosts={imageHosts()} />;
}
