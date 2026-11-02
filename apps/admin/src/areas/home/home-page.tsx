import type { Translator } from "@fluxkit/ui";
import { lazy, Suspense, type ReactNode } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { LoadingView, PageHeading } from "../../views/status-views";

/**
 * The getting-started checklist lives in the help area's lazy chunk (with its messages), so the start page, which is in
 * the entry chunk, stays small. A chunk that cannot be loaded goes to the route's error boundary, like any lazy area.
 */
const HomeChecklist = lazy(() =>
  import("../help").then((module) => ({ default: module.HomeChecklist })),
);

export function HomeView({ t, checklist }: { t: Translator; checklist?: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PageHeading>{t("page.home.title")}</PageHeading>
        <p className="text-muted-foreground">{t("page.home.welcome")}</p>
      </div>
      {checklist}
    </div>
  );
}

/** The start page after sign-in: the getting-started checklist (until hidden); the navigation leads on. */
export function HomePage() {
  const { t } = useI18n();
  return (
    <HomeView
      t={t}
      checklist={
        <Suspense fallback={<LoadingView t={t} />}>
          <HomeChecklist />
        </Suspense>
      }
    />
  );
}
