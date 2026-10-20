import type { Translator } from "@fluxkit/ui";
import { useI18n } from "../../i18n/i18n-context";
import { PageHeading } from "../../views/status-views";

export function HomeView({ t }: { t: Translator }) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeading>{t("page.home.title")}</PageHeading>
      <p className="text-muted-foreground">{t("page.home.welcome")}</p>
    </div>
  );
}

/** The start page after sign-in. Dashboards and reports are out of scope (plan); the navigation leads on. */
export function HomePage() {
  const { t } = useI18n();
  return <HomeView t={t} />;
}
