import type { AdminProduct } from "@fluxkit/api-client";
import { Button } from "@fluxkit/ui";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { jsonEqual } from "../../lib/diff-for-patch";
import { PATHS, buildPath } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { PageHeading } from "../../views/status-views";
import { ConfigGate, useContentLocales } from "../catalog-dictionaries/config-gate";
import {
  BackLink,
  CreateUnknown,
  FocusedPanel,
  linkClass,
} from "../catalog-dictionaries/dictionary-frame";
import { hasIssues } from "../catalog-dictionaries/form-rules";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import { useFormSubmit } from "../catalog-dictionaries/use-form-submit";
import {
  emptyProductForm,
  productCreateBody,
  productFieldNames,
  validateProductForm,
  type ProductFormValues,
} from "./product-form";
import { ProductGeneralView } from "./product-general-view";
import { BrandPicker, ProductTypePicker } from "./product-pickers";
import { useCan } from "./use-can";

/**
 * `/products/new`: product type, title, description, slug and brand. The API creates the draft with its default variant;
 * attribute values, categories and the rest are edited in the editor. After the create a focused panel links to the
 * editor (no redirect: a redirect from a form races the unsaved-changes guard, step 5's decision). A lost answer is
 * "result unknown": the admin checks the list before trying again; nothing is sent twice by the screen.
 */
function ProductCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canWrite = useCan("createProduct");
  const [initial, setInitial] = useState(() => emptyProductForm(content.locales));
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [created, setCreated] = useState<AdminProduct | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(productFieldNames(content.locales));
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canWrite) return;
    const issues = validateProductForm(values, content, "create");
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const outcome = await form.submit(() =>
      adminClient.createProduct(productCreateBody(values, content.locales)),
    );
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyProductForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink to={PATHS.products} label={t("products.backToList")} />
      <PageHeading>{t("page.productNew.title")}</PageHeading>
      {created !== null ? (
        <FocusedPanel
          title={t("products.create.created", {
            title: resolveLocalized(created.title, locale, content.defaultLocale) || created.slug,
          })}
        >
          <p className="text-muted-foreground">{t("products.create.next")}</p>
          <p className="flex flex-wrap gap-4">
            <Link to={buildPath(PATHS.productDetail, { id: created.id })} className={linkClass}>
              {t("products.create.openEditor")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.products} className={linkClass}>
              {t("products.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.products} /> : null}
          <ProductGeneralView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canWrite={canWrite}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.products}
            typePicker={
              <ProductTypePicker
                value={values.productTypeId}
                onChange={(productTypeId) => setValues({ ...values, productTypeId })}
                error={form.state.fieldErrors["productTypeId"]}
              />
            }
            brandPicker={
              <BrandPicker
                value={values.brandId}
                onChange={(brandId) => setValues({ ...values, brandId })}
                disabled={!canWrite}
                error={form.state.fieldErrors["brandId"]}
              />
            }
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}

export function ProductNewPage() {
  return (
    <ConfigGate>
      <ProductCreate />
    </ConfigGate>
  );
}
