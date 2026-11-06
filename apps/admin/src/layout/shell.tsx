import type { AdminOperationPermission } from "@fluxkit/api-client";
import {
  Button,
  DataTableScrollHint,
  LiveRegion,
  SideNav,
  SkipLink,
  cn,
  type SideNavGroup,
  type Translator,
} from "@fluxkit/ui";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useMatches, useNavigation } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { PageTitleProvider, type PageTitleOverride } from "../i18n/page-title";
import { useDocumentTitle } from "../i18n/use-document-title";
import { PATHS } from "../router/paths";
import { createUnsavedChangesRegistry, UnsavedChangesContext } from "../router/unsaved-changes";
import { ReauthDialog } from "../session/reauth-dialog";
import { useSession } from "../session/session-context";
import { NotAllowedView } from "../views/status-views";
import { routeById } from "../routes";
import { ScreenAccessProvider, type ScreenAccess } from "../router/screen-access";
import { contextHelpFor, helpArticlePath } from "./context-help";
import { LanguageSwitch } from "./language-switch";
import { isCurrentPath, visibleNavigation } from "./navigation";
import { mayOpenRoute } from "./route-gate";
import { UserMenu } from "./user-menu";

/** What each route object carries for the shell (`router/route-objects.tsx`). */
export interface RouteHandle {
  routeId: string;
  titleKey: string;
  permission: AdminOperationPermission;
}

export function isRouteHandle(value: unknown): value is RouteHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RouteHandle).routeId === "string" &&
    typeof (value as RouteHandle).titleKey === "string" &&
    typeof (value as RouteHandle).permission === "string"
  );
}

export interface ShellFrameProps {
  t: Translator;
  navigation: SideNavGroup[];
  languageSwitch: ReactNode;
  userMenu: ReactNode;
  /** Announced while a route chunk loads. */
  navigating: boolean;
  /** The link to the help of the current page (`ContextHelpLink`), above the page; none on screens without one. */
  contextHelp?: ReactNode;
  /** Changes with every navigation (`location.key`, also a link to the page shown): the small-screen menu closes. */
  navigationKey?: string;
  children: ReactNode;
}

/** The id of the navigation panel the small-screen Menu button opens and closes. */
export const NAVIGATION_PANEL_ID = "admin-navigation";

/** "Help for this page": the article (and section) of the screen, from `context-help.ts`. */
export function ContextHelpLink({ t, href }: { t: Translator; href: string }) {
  return (
    <Link
      to={href}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-foreground underline underline-offset-4"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-6 items-center justify-center rounded-full border border-border no-underline"
      >
        ?
      </span>
      {t("shell.contextHelp")}
    </Link>
  );
}

/**
 * The page frame: skip link, header (name, language, user), side navigation and `main`. Presentational; layout lives
 * here and in `navigation.ts` only, so a redesign does not touch the logic (AGENTS.md 2.2).
 */
export function ShellFrame({
  t,
  navigation,
  languageSwitch,
  userMenu,
  navigating,
  contextHelp,
  navigationKey,
  children,
}: ShellFrameProps) {
  // Below `md` the navigation is behind a Menu button (it filled the whole first screen of a phone); from `md` it is always
  // shown and the button is hidden. It closes when the page changes, on Escape (the focus goes back to the button) and with
  // the button.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [navigationKey]);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SkipLink targetId="main">{t("shell.skipLink")}</SkipLink>
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Link to={PATHS.home} className="text-lg font-semibold text-foreground">
            {t("app.name")}
          </Link>
          <Button
            ref={menuButton}
            variant="secondary"
            className="md:hidden"
            aria-expanded={menuOpen}
            aria-controls={NAVIGATION_PANEL_ID}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t(menuOpen ? "shell.menuClose" : "shell.menuOpen")}
          </Button>
          <div className="flex flex-wrap items-center gap-4">
            {languageSwitch}
            {userMenu}
          </div>
        </div>
      </header>
      <div className="flex flex-col md:flex-row">
        <aside
          id={NAVIGATION_PANEL_ID}
          className={cn(
            "border-b border-border p-4 md:block md:w-64 md:shrink-0 md:border-e md:border-b-0",
            menuOpen ? "block" : "hidden",
          )}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menuOpen) {
              setMenuOpen(false);
              menuButton.current?.focus();
            }
          }}
        >
          <SideNav
            label={t("shell.navLabel")}
            groups={navigation}
            renderLink={({ href, children: label, ...link }) => (
              <Link to={href} {...link}>
                {label}
              </Link>
            )}
          />
        </aside>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
          <LiveRegion visuallyHidden>{navigating ? t("shell.navigating") : null}</LiveRegion>
          {contextHelp === undefined || contextHelp === null ? null : (
            <div className="mb-2 flex justify-end">{contextHelp}</div>
          )}
          <DataTableScrollHint.Provider value={t("shell.tableScrollHint")}>
            {children}
          </DataTableScrollHint.Provider>
        </main>
      </div>
    </div>
  );
}

/**
 * The shell of every signed-in route: frame, navigation from the permissions, title per route (the focus after a
 * navigation is `router/route-focus.tsx`, at the root), the permission gate (a route the role may not open shows "not
 * allowed"), the re-sign-in dialog over the page when the session ended, and the registry of unsaved input that
 * sign-out consults. The pages are keyed by the session generation, so a sign-out or a user change drops their state.
 */
export function Shell() {
  const { t } = useI18n();
  const session = useSession();
  const location = useLocation();
  const matches = useMatches();
  const navigation = useNavigation();
  const [unsaved] = useState(createUnsavedChangesRegistry);
  const can = session.can;
  const screenAccess = useMemo<ScreenAccess>(
    () => ({
      canOpen: (route) => can(routeById(route).permission),
      titleKey: (route) => routeById(route).titleKey,
    }),
    [can],
  );

  const handle = matches
    .map((match) => match.handle)
    .filter(isRouteHandle)
    .pop();
  // A page may name itself (a help article); the name counts only while its own path is shown.
  const [pageTitle, setPageTitle] = useState<PageTitleOverride | null>(null);
  useDocumentTitle(
    handle?.titleKey ?? "notFound.title",
    pageTitle !== null && pageTitle.pathname === location.pathname ? pageTitle.text : null,
  );

  const allowed = mayOpenRoute(handle, (permission) => session.can(permission));
  const help =
    allowed && handle !== undefined
      ? contextHelpFor(handle.routeId, new URLSearchParams(location.search).get("tab"))
      : null;
  const groups: SideNavGroup[] = visibleNavigation(session.state.me?.permissions ?? null).map(
    (group) => ({
      id: group.id,
      heading: t(group.headingKey),
      items: group.items.map((item) => ({
        id: item.routeId,
        label: t(item.labelKey),
        href: item.href,
        current: isCurrentPath(location.pathname, item.href),
      })),
    }),
  );

  return (
    <PageTitleProvider value={setPageTitle}>
      <ScreenAccessProvider value={screenAccess}>
        <UnsavedChangesContext.Provider value={unsaved}>
          <ShellFrame
            t={t}
            navigation={groups}
            languageSwitch={<LanguageSwitch />}
            userMenu={<UserMenu />}
            navigating={navigation.state === "loading"}
            navigationKey={location.key}
            contextHelp={
              help === null ? null : (
                <ContextHelpLink t={t} href={helpArticlePath(help.article, help.section)} />
              )
            }
          >
            <Fragment key={session.state.generation}>
              {allowed ? <Outlet /> : <NotAllowedView t={t} />}
            </Fragment>
          </ShellFrame>
          {session.state.status === "expired" ? <ReauthDialog /> : null}
        </UnsavedChangesContext.Provider>
      </ScreenAccessProvider>
    </PageTitleProvider>
  );
}
