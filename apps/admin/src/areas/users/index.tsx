import { useI18n } from "../../i18n/i18n-context";
import type { LazyFile } from "../../messages";
import { NotBuiltView } from "../../views/status-views";

/** The admin users area (plan step 10, owner only) loads its own messages only (`users`). */
export const MESSAGE_FILES: readonly LazyFile[] = ["users"];

/** Admin users area (plan step 10, owner only). Its own lazy chunk; the screens follow in the next commit. */
export function UsersPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.users.title" />;
}
