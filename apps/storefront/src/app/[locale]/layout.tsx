import { createTranslator, isLocale, locales } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SiteShell } from "../../components/site-shell";
import { headerSearchEnabled } from "../../lib/search-data.server";
import { navigationCategories } from "../../lib/store-data.server";
import { messagesByLocale } from "../../messages";
import "../globals.css";

interface LocaleParams {
  params: Promise<{ locale: string }>;
}

/**
 * Only the locales are known at build time. The shell reads the API (categories), which `connection()` in the store data
 * layer keeps out of the build: these routes render per request (README, "Rendering").
 */
export function generateStaticParams(): { locale: string }[] {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const t = createTranslator(messagesByLocale[locale], locale);
  return { title: t("site.title"), description: t("site.description") };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { children: ReactNode }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const messages = messagesByLocale[locale];
  const t = createTranslator(messages, locale);
  const categories = await navigationCategories(locale);
  const searchEnabled = await headerSearchEnabled();

  return (
    <html lang={locale} data-theme="light">
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <SiteShell
          locale={locale}
          messages={messages}
          t={t}
          categories={categories}
          searchEnabled={searchEnabled}
          year={new Date().getFullYear()}
        >
          {children}
        </SiteShell>
      </body>
    </html>
  );
}
