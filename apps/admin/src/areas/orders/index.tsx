import { useI18n } from "../../i18n/i18n-context";
import { NotBuiltView } from "../../views/status-views";

/** Orders area (plan step 8). Its own lazy chunk; a placeholder until that step fills it. */
export function OrdersPage() {
  const { t } = useI18n();
  return <NotBuiltView t={t} titleKey="page.orders.title" />;
}
