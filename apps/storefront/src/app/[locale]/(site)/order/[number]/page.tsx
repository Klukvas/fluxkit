import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { GuestOrderPage } from "../../../../../components/guest-order-page";
import { getShopMoney } from "../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface OrderRouteProps {
  params: Promise<{ locale: string; number: string }>;
}

/** A fixed title: never the number or anything from the fragment (the token is not known here, and must not be). */
export async function generateMetadata({ params }: OrderRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "order.title");
}

/**
 * Shell only. The access token lives in the URL fragment (`#t=...`), which the browser never sends to a server, so this
 * server component cannot know it; `GuestOrderPage` reads it in the browser and looks the order up with a POST. The route
 * gets `Referrer-Policy: no-referrer` from `next.config.ts`.
 */
export default async function GuestOrderRoute({ params }: OrderRouteProps) {
  await routeLocale(params);
  const { number } = await params;
  return <GuestOrderPage number={number} shop={await getShopMoney()} />;
}
