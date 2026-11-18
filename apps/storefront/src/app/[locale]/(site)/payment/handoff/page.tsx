import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { PaymentHandoffPage } from "../../../../../components/payment-handoff-page";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface PaymentHandoffRouteProps {
  params: Promise<{ locale: string }>;
}

/** Fixed title: never an attempt id or anything from the query. */
export async function generateMetadata({ params }: PaymentHandoffRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(
    createTranslator(messagesByLocale[locale], locale),
    "payment.handoff.title",
    { noReferrer: true },
  );
}

/**
 * Form-handoff bridge (ADR 0059). The create flow navigates here with `?payment=<id>`; this server component reads
 * nothing of the query. `PaymentHandoffPage` loads signed fields and POSTs to the provider. `Referrer-Policy: no-referrer`
 * comes from `next.config.ts`.
 */
export default async function PaymentHandoffRoute({ params }: PaymentHandoffRouteProps) {
  await routeLocale(params);
  return <PaymentHandoffPage />;
}
