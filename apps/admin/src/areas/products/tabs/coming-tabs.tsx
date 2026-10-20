import type { Translator } from "@fluxkit/ui";
import { useI18n } from "../../../i18n/i18n-context";
import type { EditorTabId } from "../publish-problems";

/**
 * A tab whose screen a later step builds (prices and stock: step 7): what it will hold. No publish problem belongs to
 * these tabs (a missing price is reported on the variant's row in Variants).
 */
export function ComingTabView({ t, tab }: { t: Translator; tab: EditorTabId }) {
  return <p className="text-muted-foreground">{t(`products.placeholder.${tab}`)}</p>;
}

function comingTab(tab: EditorTabId) {
  function ComingTab() {
    const { t } = useI18n();
    return <ComingTabView t={t} tab={tab} />;
  }
  return ComingTab;
}

/** Step 7. */
export const PricesTab = comingTab("prices");
/** Step 7. */
export const StockTab = comingTab("stock");
