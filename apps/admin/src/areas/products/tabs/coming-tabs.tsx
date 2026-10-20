import type { Translator } from "@fluxkit/ui";
import { useI18n } from "../../../i18n/i18n-context";
import { describe } from "../../catalog-dictionaries/form-parts";
import { placeholderFocusId } from "../field-ids";
import type { EditorTabId, PublishProblem } from "../publish-problems";
import type { ProductTabProps } from "../tab-props";

/** Where a publish problem sits, in words: the variant's row (1-based) and SKU, and the attribute. */
export function problemPlace(t: Translator, problem: PublishProblem): string | null {
  const parts: string[] = [];
  if (problem.variantIndex !== undefined) {
    parts.push(
      problem.variantSku === undefined
        ? t("products.problems.variantRowNoSku", { row: problem.variantIndex + 1 })
        : t("products.problems.variantRow", {
            row: problem.variantIndex + 1,
            sku: problem.variantSku,
          }),
    );
  }
  if (problem.attributeCode !== undefined) {
    parts.push(t("products.problems.attribute", { code: problem.attributeCode }));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/**
 * A tab whose screen a later step builds (media, options and variants: step 6b; prices and stock: step 7): what it will
 * hold, and the problems of the last publish attempt that belong to it (for variants, row by row in the product's variant
 * order), so a publish refusal is never a dead end.
 */
export function ComingTabView({
  t,
  tab,
  problems,
}: {
  t: Translator;
  tab: EditorTabId;
  problems: readonly PublishProblem[];
}) {
  const own = problems.filter((problem) => problem.tab === tab);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t(`products.placeholder.${tab}`)}</p>
      {own.length === 0 ? null : (
        <section
          id={placeholderFocusId(tab)}
          tabIndex={-1}
          aria-labelledby={`${placeholderFocusId(tab)}-heading`}
          className="flex flex-col gap-2 rounded-md border border-danger p-4"
        >
          <h2 id={`${placeholderFocusId(tab)}-heading`} className="font-semibold">
            {t("products.problems.onTab")}
          </h2>
          <ul className="flex flex-col gap-1">
            {own.map((problem, index) => {
              const place = problemPlace(t, problem);
              return (
                <li key={`${problem.path}-${index}`}>
                  {place === null ? null : <span className="font-medium">{place}: </span>}
                  {describe(t, problem.message)}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function comingTab(tab: EditorTabId) {
  function ComingTab({ problems }: ProductTabProps) {
    const { t } = useI18n();
    return <ComingTabView t={t} tab={tab} problems={problems} />;
  }
  return ComingTab;
}

/** Step 6b. */
export const MediaTab = comingTab("media");
/** Step 6b. */
export const OptionsTab = comingTab("options");
/** Step 6b: the variant table; publish problems at `variants.N` are listed by row until then. */
export const VariantsTab = comingTab("variants");
/** Step 7. */
export const PricesTab = comingTab("prices");
/** Step 7. */
export const StockTab = comingTab("stock");
