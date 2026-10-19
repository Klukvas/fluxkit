import { useI18n } from "../../i18n/i18n-context";
import { NotBuiltView } from "../../views/status-views";

/** Admin users area (plan step 10, owner only). Its own lazy chunk; a placeholder until that step fills it. */
export function UsersPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.users.title" />;
}
