import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { AccountOrder } from "../../../../../../components/account-orders";
import { getOnlinePayment, getShopMoney } from "../../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../../messages";

interface AccountOrderRouteProps {
  params: Promise<{ locale: string; number: string }>;
}

export async function generateMetadata({ params }: AccountOrderRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "order.title");
}

/** Shell only: the order is read in the browser with the session (`AccountOrder`), behind the account gate. */
export default async function AccountOrderRoute({ params }: AccountOrderRouteProps) {
  await routeLocale(params);
  const { number } = await params;
  return (
    <AccountOrder
      number={number}
      shop={await getShopMoney()}
      onlinePayment={await getOnlinePayment()}
    />
  );
}
