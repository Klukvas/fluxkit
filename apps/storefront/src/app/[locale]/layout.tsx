import type { ThemeMode } from "@fluxkit/theme";
import { createTranslator, isLocale, locales } from "@fluxkit/ui";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SiteShell } from "../../components/site-shell";
import { brand } from "../../config/brand";
import { fonts } from "../../config/fonts";
import { themeConfig } from "../../config/theme";
import { brandIconsMetadata, brandThemeColor } from "../../lib/brand";
import { fontVariableClasses } from "../../lib/font-classes";
import { headerSearchEnabled } from "../../lib/search-data.server";
import { navigationCategories } from "../../lib/store-data.server";
import { templateFonts } from "../../lib/template-fonts";
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
  const icons = brandIconsMetadata(brand);
  return {
    title: t("site.title"),
    description: t("site.description"),
    // `config/brand.ts`: without icons the key is left out, so the head is what it was before the brand config existed.
    ...(icons === undefined ? {} : { icons }),
  };
}

/**
 * The theme `<html data-theme>` is rendered in: the stored choice of the `fluxkit_theme` cookie (the only cookie this app reads,
 * `security-headers.spec.ts`) or the configured default. The theme is decided on the server, so the first paint already has it:
 * no script, no flash of the other theme. `system` leaves the choice to the CSS media query (`tokens.css`), which also works
 * without a script.
 */
async function requestThemeMode(): Promise<ThemeMode> {
  return resolveThemeMode((await cookies()).get(THEME_COOKIE)?.value, themeConfig);
}

/**
 * `theme-color` from `config/brand.ts`, for the theme `<html data-theme>` is rendered in. Without a configured colour nothing
 * is read and Next renders its default viewport tag only (the head of the template is unchanged).
 */
export async function generateViewport(): Promise<Viewport> {
  if (!brand.themeColor) return {};
  return { themeColor: brandThemeColor(true, await requestThemeMode()) };
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
  const themeMode = await requestThemeMode();

  return (
    // Template font variables come first, then the fork's config/fonts.ts variables, on the root where tokens resolve.
    <html
      lang={locale}
      data-theme={themeMode}
      className={fontVariableClasses([...templateFonts, ...fonts])}
    >
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
