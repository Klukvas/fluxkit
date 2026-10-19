import { isLocale, type Locale } from "@fluxkit/ui";
import { notFound } from "next/navigation";

/**
 * The locale of a route. The locale layout has already refused an unknown one before any page renders, so this never
 * fails in practice; it narrows the type for pages that have no content to be "not found" about (the cart and account
 * pages), keeping `notFound()` out of the page files that live under a `loading.tsx` (`route-structure.spec.ts`).
 */
export async function routeLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
