import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { AccountDataPage } from "../../../../../components/account-data";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface DataRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: DataRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "account.data.title");
}

/** Shell only: the session cookie has `Path=/store`, so the page is read and driven in the browser, behind the account gate. */
export default async function DataRoute({ params }: DataRouteProps) {
  await routeLocale(params);
  return <AccountDataPage />;
}
