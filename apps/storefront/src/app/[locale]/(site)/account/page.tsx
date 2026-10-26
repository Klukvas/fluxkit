import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { AccountOverview } from "../../../../components/account-overview";
import { getEmailDelivery } from "../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../lib/page-metadata";
import { routeLocale } from "../../../../lib/route-locale";
import { messagesByLocale } from "../../../../messages";

interface AccountRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AccountRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "account.title");
}

/**
 * Shell only: the session cookie has `Path=/store`, so the overview is read in the browser (`AccountOverview`). The shop's
 * `emailDelivery` decides whether the overview shows the email verification state.
 */
export default async function AccountRoute({ params }: AccountRouteProps) {
  await routeLocale(params);
  return <AccountOverview emailDelivery={await getEmailDelivery()} />;
}
