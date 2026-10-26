import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { VerifyEmailPage } from "../../../../../components/account-verify-email";
import { getEmailDelivery } from "../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface RouteProps {
  params: Promise<{ locale: string }>;
}

/** A fixed title (never anything from the fragment) and the no-referrer meta tag. */
export async function generateMetadata({ params }: RouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "account.verify.title",
    {
      noReferrer: true,
    },
  );
}

/**
 * Shell only. The verification token lives in the URL fragment (`#t=...`), which the browser never sends to a server:
 * the page reads it in the browser, removes it from the address bar and sends it only in the body of the confirm call.
 * The route gets `Referrer-Policy: no-referrer` from `next.config.ts`.
 */
export default async function Route({ params }: RouteProps) {
  await routeLocale(params);
  return <VerifyEmailPage emailDelivery={await getEmailDelivery()} />;
}
