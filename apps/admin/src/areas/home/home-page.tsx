import type { Translator } from "@fluxkit/ui";
import { lazy, Suspense, type ReactNode } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { LoadingView, PageHeader } from "../../views/status-views";

/**
 * The getting-started checklist lives in the help area's lazy chunk (with its messages), so the start page, which is in
 * the entry chunk, stays small. A chunk that cannot be loaded goes to the route's error boundary, like any lazy area.
 */
const HomeChecklist = lazy(() =>
  import("../help").then((module) => ({ default: module.HomeChecklist })),
);

const HomeWorkspace = lazy(() =>
  import("./home-workspace").then((module) => ({ default: module.HomeWorkspace })),
);

export function HomeView({
  t,
  workspace,
  checklist,
}: {
  t: Translator;
  workspace?: ReactNode;
  checklist?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("page.home.title")} description={t("page.home.welcome")} />
      {workspace}
      {checklist}
    </div>
  );
}

/** Daily workspace and the independently loaded getting-started checklist. */
export function HomePage() {
  const { t } = useI18n();
  return (
    <HomeView
      t={t}
      workspace={
        <Suspense fallback={<LoadingView t={t} />}>
          <HomeWorkspace />
        </Suspense>
      }
      checklist={
        <Suspense fallback={<LoadingView t={t} />}>
          <HomeChecklist />
        </Suspense>
      }
    />
  );
}
