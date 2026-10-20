import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { PATHS, buildPath } from "../../../router/paths";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { linkClass } from "../../catalog-dictionaries/dictionary-frame";
import { hasIssues } from "../../catalog-dictionaries/form-rules";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import { AttributeFieldsView } from "../attribute-fields-view";
import {
  attributeErrorsFromProblem,
  attributeFieldNames,
  attributeFieldSpecs,
  attributeFormFrom,
  attributesDirty,
  attributesPatchBody,
  validateAttributeForm,
  type AttributeFormValues,
} from "../attribute-values-form";
import { problemsOnTab } from "../publish-problems";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { useCan } from "../use-can";

/**
 * Attributes: the form generated from the product type's product-level attributes (`attribute-values-form.ts`). Saves
 * the whole `attributes` map with a PATCH (the API has no partial update; untouched values are sent as stored). An active
 * product needs its required attributes on every save; a draft may stay incomplete until it is published.
 */
export function AttributesTab({
  product,
  productType,
  content,
  problems,
  onChanged,
  onDirtyChange,
}: ProductTabProps) {
  const { t, locale } = useI18n();
  const canWrite = useCan("updateProduct");
  const specs = useMemo(() => attributeFieldSpecs(productType), [productType]);
  const [initial, setInitial] = useState(() =>
    attributeFormFrom(specs, product.attributes, content.locales),
  );
  const [values, setValues] = useState<AttributeFormValues>(initial);
  const fieldNames = useMemo(() => attributeFieldNames(specs, content.locales), [specs, content]);
  const form = useFormSubmit(fieldNames, (problem) =>
    attributeErrorsFromProblem(problem, specs, content.locales),
  );
  const mode = product.status === "active" ? "publish" : "draft";
  const dirty = attributesDirty(initial, values) && !form.state.busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);
  const issues = { ...problemsOnTab(problems, "attributes"), ...form.state.fieldErrors };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const local = validateAttributeForm(specs, values, { ...content, mode });
    if (hasIssues(local)) {
      form.showIssues(local);
      return;
    }
    const body = attributesPatchBody(specs, initial, values, product.attributes, content.locales);
    if (body.attributes === undefined) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateProduct(product.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  if (specs.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground">{t("products.attributes.none")}</p>
        <p>
          <Link
            to={buildPath(PATHS.productTypeDetail, { id: productType.id })}
            className={linkClass}
          >
            {t("products.attributes.openType")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <AttributeFieldsView
        t={t}
        uiLocale={locale}
        content={content}
        specs={specs}
        values={values}
        onChange={setValues}
        issues={issues}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canWrite={canWrite}
        mode={mode}
        onSubmit={(event) => void submit(event)}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}
