import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { ForgotPasswordPage } from "../../../../../components/account-forgot-password";
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
    "account.forgot.title",
    {
      noReferrer: true,
    },
  );
}

/**
 * Shell only. `emailDelivery` of the shop's config decides between the form and the "not available" state (the routes
 * answer `404` without a mail provider). The route gets `Referrer-Policy: no-referrer` from `next.config.ts`.
 */
export default async function Route({ params }: RouteProps) {
  await routeLocale(params);
  return <ForgotPasswordPage emailDelivery={await getEmailDelivery()} />;
}
