import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { PaymentReturnPage } from "../../../../../components/payment-return-page";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface PaymentReturnRouteProps {
  params: Promise<{ locale: string }>;
}

/** A fixed title: never an attempt id or anything from the query. */
export async function generateMetadata({ params }: PaymentReturnRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "payment.return.title",
    { noReferrer: true },
  );
}

/**
 * Shell only (ADR 0032 decision 6). The provider sends the shopper back here with `?payment=<id>`; this server component
 * reads nothing of the query. `PaymentReturnPage` takes the attempt id as a hint in the browser, finds the order in this
 * tab's hand-off and shows what the status route answers. The route gets `Referrer-Policy: no-referrer` from `next.config.ts`.
 */
export default async function PaymentReturnRoute({ params }: PaymentReturnRouteProps) {
  await routeLocale(params);
  return <PaymentReturnPage />;
}
