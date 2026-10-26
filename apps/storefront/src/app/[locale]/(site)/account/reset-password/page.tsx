import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { ResetPasswordPage } from "../../../../../components/account-reset-password";
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
    "account.reset.title",
    {
      noReferrer: true,
    },
  );
}

/**
 * Shell only. The reset token lives in the URL fragment (`#t=...`), which the browser never sends to a server, so this
 * server component cannot know it: the page reads it in the browser, removes it from the address bar and sends it only in
 * the body of the confirm call. The route gets `Referrer-Policy: no-referrer` from `next.config.ts`.
 */
export default async function Route({ params }: RouteProps) {
  await routeLocale(params);
  return <ResetPasswordPage emailDelivery={await getEmailDelivery()} />;
}
