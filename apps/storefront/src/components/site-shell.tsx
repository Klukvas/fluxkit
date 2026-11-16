import type { ThemeMode } from "@fluxkit/theme";
import { SkipLink, type Locale, type Messages, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { CartDrawerProvider } from "./cart-drawer-provider";
import { CartDrawerSettings } from "./cart-drawer-settings";
import { ToastProvider } from "./toast-provider";
import { MAIN_CONTENT_ID, type NavigationLink } from "../layout/navigation";
import { pickClientMessages } from "../lib/client-messages";
import { I18nProvider } from "./i18n-provider";
import { SignInNavigation } from "./sign-in-navigation";
import { RouteFocus } from "./route-focus";
import { SessionNotices } from "./session-notices";
import { SessionProvider } from "./session-provider";
import { SiteFooter } from "./site-footer";
import { SiteHeader, type NavigationCategory } from "./site-header";
import { DemoNotice } from "./demo-notice";
import { DemoNoticeDialog } from "./demo-notice-dialog";

/** The links of the enabled feature slices, by place (`featureNavigation` of `features/registry.ts`). */
export interface FeatureLinks {
  header: readonly NavigationLink[];
  footer: readonly NavigationLink[];
}

const NO_FEATURE_LINKS: FeatureLinks = { header: [], footer: [] };

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
  demoNotice = false,
  year,
  themeMode,
  featureLinks = NO_FEATURE_LINKS,
  children,
  modal,
}: {
  locale: Locale;
  messages: Messages;
  t: Translator;
  categories: readonly NavigationCategory[] | null;
  /** `search` of the store config: false means no search box in the header. */
  searchEnabled: boolean;
  /** Runtime deployment mode; off for client shops. */
  demoNotice?: boolean;
  year: number;
  /** The theme `<html data-theme>` was rendered with; the header's and the footer's switches start from it. */
  themeMode: ThemeMode;
  /** The header and footer links of the enabled feature slices (`features/registry.ts`); none by default. */
  featureLinks?: FeatureLinks;
  children: ReactNode;
  modal?: ReactNode;
}) {
  return (
    <I18nProvider locale={locale} messages={pickClientMessages(messages)}>
      <SessionProvider locale={locale}>
        <ToastProvider>
          <CartDrawerProvider drawer={<CartDrawerSettings />}>
            <SignInNavigation locale={locale}>
              <RouteFocus />
              <SkipLink targetId={MAIN_CONTENT_ID}>{t("skip.content")}</SkipLink>
              {demoNotice ? <DemoNotice locale={locale} t={t} /> : null}
              <SiteHeader
                locale={locale}
                t={t}
                categories={categories}
                searchEnabled={searchEnabled}
                themeMode={themeMode}
                featureLinks={featureLinks.header}
              />
              <main id={MAIN_CONTENT_ID} tabIndex={-1} className="flex-1 focus:outline-none">
                <SessionNotices />
                {children}
              </main>
              {modal}
              {demoNotice ? <DemoNoticeDialog /> : null}
              <SiteFooter
                locale={locale}
                t={t}
                year={year}
                themeMode={themeMode}
                featureLinks={featureLinks.footer}
              />
            </SignInNavigation>
          </CartDrawerProvider>
        </ToastProvider>
      </SessionProvider>
    </I18nProvider>
  );
}
