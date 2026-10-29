import { createTranslator } from "@fluxkit/ui";
import type { Metadata } from "next";
import { LegalPage } from "../components/legal-page";
import { legalPages, type LegalPageSlug } from "../config/legal";
import { messagesByLocale } from "../messages";
import { legalMetadata } from "./page-metadata";
import { publicOrigin } from "./public-url.server";
import { routeLocale } from "./route-locale";

/**
 * The two exports every legal page route needs, made from its slug (`app/[locale]/(site)/legal/<slug>/page.tsx`), so the
 * three routes cannot drift apart. A slug that `config/legal.ts` does not list is a bug and throws.
 */
export interface LegalRouteProps {
  params: Promise<{ locale: string }>;
}

function titleKeyOf(slug: LegalPageSlug): string {
  const page = legalPages.find((entry) => entry.slug === slug);
  if (page === undefined)
    throw new Error(`The legal page "${slug}" is not listed in config/legal.ts.`);
  return page.labelKey;
}

export function legalPageMetadata(slug: LegalPageSlug) {
  return async function generateMetadata({ params }: LegalRouteProps): Promise<Metadata> {
    const locale = await routeLocale(params);
    return legalMetadata({
      origin: await publicOrigin(),
      locale,
      t: createTranslator(messagesByLocale[locale], locale),
      titleKey: titleKeyOf(slug),
      slug,
    });
  };
}

export function legalPageRoute(slug: LegalPageSlug) {
  return async function LegalRoute({ params }: LegalRouteProps) {
    const locale = await routeLocale(params);
    return (
      <LegalPage
        slug={slug}
        locale={locale}
        t={createTranslator(messagesByLocale[locale], locale)}
      />
    );
  };
}
