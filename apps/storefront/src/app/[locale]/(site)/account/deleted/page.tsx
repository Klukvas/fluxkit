import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { AccountDeleted } from "../../../../../components/account-deleted";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface DeletedRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: DeletedRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "account.data.deleted.title",
  );
}

/** The confirmation page after an account deletion. Not behind the account gate: the account is gone. */
export default async function DeletedRoute({ params }: DeletedRouteProps) {
  await routeLocale(params);
  return <AccountDeleted />;
}
