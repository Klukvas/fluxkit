import type { AdminOperationPermission } from "@fluxkit/api-client";
import { LiveRegion, SideNav, SkipLink, type SideNavGroup, type Translator } from "@fluxkit/ui";
import { Fragment, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useMatches, useNavigation } from "react-router";
import { useI18n } from "../i18n/i18n-context";
import { useDocumentTitle } from "../i18n/use-document-title";
import { PATHS } from "../router/paths";
import { createUnsavedChangesRegistry, UnsavedChangesContext } from "../router/unsaved-changes";
import { ReauthDialog } from "../session/reauth-dialog";
import { useSession } from "../session/session-context";
import { NotAllowedView } from "../views/status-views";
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
  children: ReactNode;
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
  children,
}: ShellFrameProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SkipLink targetId="main">{t("shell.skipLink")}</SkipLink>
      <header className="border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Link to={PATHS.home} className="text-lg font-semibold text-foreground">
            {t("app.name")}
          </Link>
          <div className="flex flex-wrap items-center gap-4">
            {languageSwitch}
            {userMenu}
          </div>
        </div>
      </header>
      <div className="flex flex-col md:flex-row">
        <aside className="border-b border-border p-4 md:w-64 md:shrink-0 md:border-e md:border-b-0">
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
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-6">
          <LiveRegion visuallyHidden>{navigating ? t("shell.navigating") : null}</LiveRegion>
          {children}
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

  const handle = matches
    .map((match) => match.handle)
    .filter(isRouteHandle)
    .pop();
  useDocumentTitle(handle?.titleKey ?? "notFound.title");

  const allowed = mayOpenRoute(handle, (permission) => session.can(permission));
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
    <UnsavedChangesContext.Provider value={unsaved}>
      <ShellFrame
        t={t}
        navigation={groups}
        languageSwitch={<LanguageSwitch />}
        userMenu={<UserMenu />}
        navigating={navigation.state === "loading"}
      >
        <Fragment key={session.state.generation}>
          {allowed ? <Outlet /> : <NotAllowedView t={t} />}
        </Fragment>
      </ShellFrame>
      {session.state.status === "expired" ? <ReauthDialog /> : null}
    </UnsavedChangesContext.Provider>
  );
}
