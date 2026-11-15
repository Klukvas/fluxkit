import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { ensureStorefrontLocales } from "../../../../../lib/store-data.server";
import { SignInModal } from "../../../../../components/sign-in-modal";
import { SignInModalForm } from "../../../../../components/sign-in-modal-form";
import { getEmailDelivery } from "../../../../../lib/catalog-pages.server";
import { privateMetadata } from "../../../../../lib/page-metadata";
import { routeLocale } from "../../../../../lib/route-locale";
import { messagesByLocale } from "../../../../../messages";

interface LoginRouteProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: LoginRouteProps): Promise<Metadata> {
  const locale = await routeLocale(params);
  return privateMetadata(createTranslator(messagesByLocale[locale], locale), "account.login.title");
}

/**
 * Shell only. `next` (where to go afterwards) is read in the browser by `SignInModalForm` and passed on as it came; the form
 * checks it with `safeNextPath` before it navigates or links anywhere, so a value from the URL can never leave the storefront.
 */
export default async function LoginRoute({ params }: LoginRouteProps) {
  await routeLocale(params);
  await ensureStorefrontLocales();
  return (
    <SignInModal>
      <SignInModalForm emailDelivery={await getEmailDelivery()} />
    </SignInModal>
  );
}
