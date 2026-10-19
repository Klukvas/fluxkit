import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { CheckoutPage } from "../../../../components/checkout-page";
import { getShopExponent } from "../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../lib/page-metadata";
import { routeLocale } from "../../../../lib/route-locale";
import { messagesByLocale } from "../../../../messages";

interface CheckoutRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: CheckoutRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "checkout.title");
}

/**
 * Shell only. The cart, the session and the order are read and sent in the browser (`CheckoutPage`): the cookies have
 * `Path=/store`, so the Next server never sees them. The server contributes the shop's currency digits.
 */
export default async function CheckoutRoute({ params }: CheckoutRouteProps) {
  await routeLocale(params);
  return <CheckoutPage exponent={await getShopExponent()} />;
}
