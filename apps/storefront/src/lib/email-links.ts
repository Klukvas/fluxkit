import type { Locale } from "@fluxkit/ui";
import { localizedHref } from "./locale-path";

/**
 * The "Forgot password?" link of the sign-in page. It exists only when the shop sends email (`emailDelivery` of
 * `GET /store/config`): without a provider the reset routes answer `404`, so a link would lead to a dead end.
 */
export function forgotPasswordHref(locale: Locale, emailDelivery: boolean): string | undefined {
  return emailDelivery ? localizedHref(locale, "/account/forgot-password") : undefined;
}
