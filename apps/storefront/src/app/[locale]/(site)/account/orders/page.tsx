import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { AccountOrders } from "../../../../../components/account-orders";
import { getShopMoney } from "../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface AccountOrdersRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AccountOrdersRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "account.orders.title",
  );
}

/** Shell only: the session cookie has `Path=/store`, so the history is read in the browser (`AccountOrders`). */
export default async function AccountOrdersRoute({ params }: AccountOrdersRouteProps) {
  await routeLocale(params);
  return <AccountOrders shop={await getShopMoney()} />;
}
