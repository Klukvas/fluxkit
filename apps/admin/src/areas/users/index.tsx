import { useI18n } from "../../i18n/i18n-context";
import type { LazyFile } from "../../messages";
import { NotBuiltView } from "../../views/status-views";

/** The eager messages are enough for the placeholder. */
export const MESSAGE_FILES: readonly LazyFile[] = [];

/** Admin users area (plan step 10, owner only). Its own lazy chunk; a placeholder until that step fills it. */
export function UsersPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.users.title" />;
}
