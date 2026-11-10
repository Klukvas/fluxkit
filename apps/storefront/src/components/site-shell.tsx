import type { ThemeMode } from "@fluxkit/theme";
import { SkipLink, type Locale, type Messages, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { MAIN_CONTENT_ID } from "../layout/navigation";
import { pickClientMessages } from "../lib/client-messages";
import { I18nProvider } from "./i18n-provider";
import { RouteFocus } from "./route-focus";
import { SessionNotices } from "./session-notices";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { CentredHeader } from "./centred-header";
import type { NavigationCategory } from "./site-header";

/**
 * The page frame inside `<body>`: skip link first (the first Tab stop), then the header, `<main>` (the skip link's target,
 * focusable by script), the footer. Landmarks are `header`, `nav`, `main` and `footer`; each `nav` is labelled.
 */
export function SiteShell({
  locale,
  messages,
  t,
  categories,
  searchEnabled,
  year,
  themeMode,
  children,
}: {
  locale: Locale;
  messages: Messages;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
  /** `search` of the store config: false means no search box in the header. */
  searchEnabled: boolean;
  year: number;
  /** The theme `<html data-theme>` was rendered with; the footer's switch starts from it. */
  themeMode: ThemeMode;
  children: ReactNode;
}) {
  return (
    <I18nProvider locale={locale} messages={pickClientMessages(messages)}>
      <SessionProvider locale={locale}>
        <RouteFocus />
        <SkipLink targetId={MAIN_CONTENT_ID}>{t("skip.content")}</SkipLink>
        <CentredHeader
          locale={locale}
          t={t}
          categories={categories}
          searchEnabled={searchEnabled}
        />
        <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
          <SessionNotices />
          {children}
        </main>
        <SiteFooter locale={locale} t={t} year={year} themeMode={themeMode} />
      </SessionProvider>
    </I18nProvider>
  );
}
