import { createTranslator, isLocale, locales } from "@fluxkit/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SiteShell } from "../../components/site-shell";
import { fonts } from "../../config/fonts";
import { themeConfig } from "../../config/theme";
import { fontVariableClasses } from "../../lib/font-classes";
import { headerSearchEnabled } from "../../lib/search-data.server";
import { navigationCategories } from "../../lib/store-data.server";
import { resolveThemeMode, THEME_COOKIE } from "../../lib/theme-mode";
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
  // The theme is decided here, on the server, so the first paint already has it: no script, no flash of the other theme.
  // `system` leaves the choice to the CSS media query (`tokens.css`), which also works without a script.
  const themeMode = resolveThemeMode((await cookies()).get(THEME_COOKIE)?.value, themeConfig);

  return (
    // The fonts' `variable` classes (`config/fonts.ts`; none in the template, then no attribute) sit on <html>, where the tokens are.
    <html lang={locale} data-theme={themeMode} className={fontVariableClasses(fonts)}>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        <SiteShell
          locale={locale}
          messages={messages}
          t={t}
          categories={categories}
          searchEnabled={searchEnabled}
          year={new Date().getFullYear()}
          themeMode={themeMode}
        >
          {children}
        </SiteShell>
      </body>
    </html>
  );
}
