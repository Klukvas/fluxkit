import type { AdminOperationPermission } from "@fluxkit/api-client";
import {
  Button,
  DataTableScrollHint,
  LiveRegion,
  SideNav,
  SidebarCollapseIcon,
  SidebarExpandIcon,
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
import { featureRouteGate, shownFeatures, useEnabledFeatures } from "./enabled-features";
import { FeatureRouteFallback, fallbackTitleKey } from "./feature-route-view";
import { LanguageSwitch } from "./language-switch";
import { isCurrentPath, visibleNavigation } from "./navigation";
import { mayOpenRoute } from "./route-gate";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";
import { UserMenu } from "./user-menu";

/** What each route object carries for the shell (`router/route-objects.tsx`). */
export interface RouteHandle {
  routeId: string;
  titleKey: string;
  permission: AdminOperationPermission;
  /** The feature slice a screen belongs to (ADR 0049); absent on core screens. */
  feature?: string;
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
  helpNavigation?: SideNavGroup[];
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
export const DESKTOP_NAVIGATION_PANEL_ID = "admin-navigation-desktop";
export const NAVIGATION_PANEL_ID = "admin-navigation";
/** The id of the header part with the language switch and the user menu, behind the same button below `md`. */
export const ACCOUNT_PANEL_ID = "admin-account";

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

/** Both responsive panels share exactly the same links and muted current-item style. */
function ShellNavigation({
  t,
  navigation,
  helpNavigation = [],
  collapsed = false,
}: Pick<ShellFrameProps, "t" | "navigation" | "helpNavigation" | "collapsed">) {
  const renderNav = (groups: SideNavGroup[], label: string) => (
    <SideNav
      label={label}
      groups={groups}
      collapsed={collapsed}
      currentTone="muted"
      renderLink={({ href, children, ...link }) => (
        <Link to={href} {...link}>
          {children}
        </Link>
      )}
    />
  );
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {renderNav(navigation, t("shell.navLabel"))}
      </div>
      <div className="shrink-0 pt-4">{renderNav(helpNavigation, t("page.help.title"))}</div>
    </>
  );
}

function CollapseControl({
  t,
  collapsed,
  onToggle,
}: {
  t: Translator;
  collapsed: boolean;
  onToggle?: () => void;
}) {
  return (
    <Button
      variant="secondary"
      className="mt-2 w-full shrink-0 gap-3 px-3"
      aria-expanded={!collapsed}
      aria-controls={DESKTOP_NAVIGATION_PANEL_ID}
      onClick={onToggle}
    >
      {collapsed ? <SidebarExpandIcon /> : <SidebarCollapseIcon />}
      <span className={collapsed ? "sr-only" : undefined}>
        {t(collapsed ? "shell.expandPanel" : "shell.collapsePanel")}
      </span>
    </Button>
  );
}

function ShellHeader({
  t,
  menuOpen,
  setMenuOpen,
  menuButton,
  languageSwitch,
  userMenu,
  onEscape,
}: {
  t: Translator;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  menuButton: React.RefObject<HTMLButtonElement | null>;
  languageSwitch: ReactNode;
  userMenu: ReactNode;
  onEscape: React.KeyboardEventHandler;
}) {
  return (
    <header className="border-b border-border md:col-start-2">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <Link to={PATHS.home} className="text-lg font-semibold text-foreground">
          {t("app.name")}
        </Link>
        <Button
          ref={menuButton}
          variant="secondary"
          className="md:hidden"
          aria-expanded={menuOpen}
          aria-controls={`${ACCOUNT_PANEL_ID} ${NAVIGATION_PANEL_ID}`}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {t(menuOpen ? "shell.menuClose" : "shell.menuOpen")}
        </Button>
        <div
          id={ACCOUNT_PANEL_ID}
          className={cn(
            "w-full flex-wrap items-center gap-4 md:flex md:w-auto",
            menuOpen ? "flex" : "hidden",
          )}
          onKeyDown={onEscape}
        >
          {languageSwitch}
          {userMenu}
        </div>
      </div>
    </header>
  );
}

/** Presentational frame; mobile always renders the expanded navigation. */
export function ShellFrame({
  t,
  navigation,
  helpNavigation = [],
  collapsed = false,
  onToggleCollapsed,
  languageSwitch,
  userMenu,
  navigating,
  contextHelp,
  navigationKey,
  children,
}: ShellFrameProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [navigationKey]);
  const onEscape: React.KeyboardEventHandler = (event) => {
    if (event.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      menuButton.current?.focus();
    }
  };
  const navProps = { t, navigation, helpNavigation };
  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:admin-shell-grid">
      <SkipLink targetId="main">{t("shell.skipLink")}</SkipLink>
      <ShellHeader
        {...{ t, menuOpen, setMenuOpen, menuButton, languageSwitch, userMenu, onEscape }}
      />
      <aside
        id={DESKTOP_NAVIGATION_PANEL_ID}
        className={cn(
          "sticky top-0 hidden h-dvh min-h-0 flex-col border-e border-border p-4 sidebar-safe-bottom md:col-start-1 md:row-start-1 md:row-span-2 md:flex",
          collapsed ? "w-20" : "w-64",
        )}
      >
        <ShellNavigation {...navProps} collapsed={collapsed} />
        <CollapseControl t={t} collapsed={collapsed} onToggle={onToggleCollapsed} />
      </aside>
      <aside
        id={NAVIGATION_PANEL_ID}
        className={cn(
          "flex-col border-b border-border p-4 md:hidden",
          menuOpen ? "flex" : "hidden",
        )}
        onKeyDown={onEscape}
      >
        <ShellNavigation {...navProps} />
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 p-4 md:col-start-2 md:row-start-2 md:p-6">
        <LiveRegion visuallyHidden>{navigating ? t("shell.navigating") : null}</LiveRegion>
        {contextHelp === undefined || contextHelp === null ? null : (
          <div className="mb-2 flex justify-end">{contextHelp}</div>
        )}
        <DataTableScrollHint.Provider value={t("shell.tableScrollHint")}>
          {children}
        </DataTableScrollHint.Provider>
      </main>
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
  const sidebar = useSidebarCollapsed();
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
  const me = session.state.me;
  const features = useEnabledFeatures(
    me === null ? null : `${String(session.state.generation)}:${me.user.id}`,
  );
  // A feature slice's screen waits for `GET /admin/config` (ADR 0049): it shows only when its feature is enabled.
  const featureGate = featureRouteGate(handle?.feature, features.state);
  const heldBack = featureGate !== null && featureGate !== "open" ? featureGate : null;
  // A page may name itself (a help article); the name counts only while its own path is shown.
  const [pageTitle, setPageTitle] = useState<PageTitleOverride | null>(null);
  useDocumentTitle(
    heldBack !== null ? fallbackTitleKey(heldBack) : (handle?.titleKey ?? "notFound.title"),
    pageTitle !== null && pageTitle.pathname === location.pathname ? pageTitle.text : null,
  );

  const allowed = mayOpenRoute(handle, (permission) => session.can(permission));
  const help =
    allowed && handle !== undefined && handle.feature === undefined
      ? contextHelpFor(handle.routeId, new URLSearchParams(location.search).get("tab"))
      : null;
  const visibleGroups = visibleNavigation(me?.permissions ?? null, shownFeatures(features.state));
  const groups: SideNavGroup[] = visibleGroups.map((group) => ({
    id: group.id,
    ...(group.headingKey ? { heading: t(group.headingKey) } : {}),
    items: group.items.map((item) => ({
      icon: <item.icon />,
      id: item.routeId,
      label: t(item.labelKey),
      href: item.href,
      current: isCurrentPath(location.pathname, item.href),
    })),
  }));

  return (
    <PageTitleProvider value={setPageTitle}>
      <ScreenAccessProvider value={screenAccess}>
        <UnsavedChangesContext.Provider value={unsaved}>
          <ShellFrame
            t={t}
            navigation={groups.filter((_, index) => visibleGroups[index]?.placement !== "bottom")}
            helpNavigation={groups.filter(
              (_, index) => visibleGroups[index]?.placement === "bottom",
            )}
            collapsed={sidebar.collapsed}
            onToggleCollapsed={sidebar.toggle}
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
              {heldBack !== null ? (
                <FeatureRouteFallback
                  t={t}
                  gate={heldBack}
                  state={features.state}
                  onRetry={features.retry}
                />
              ) : allowed ? (
                <Outlet />
              ) : (
                <NotAllowedView t={t} />
              )}
            </Fragment>
          </ShellFrame>
          {session.state.status === "expired" ? <ReauthDialog /> : null}
        </UnsavedChangesContext.Provider>
      </ScreenAccessProvider>
    </PageTitleProvider>
  );
}
