import type { AdminConfig, AdminResult, AdminShippingMethod } from "@fluxkit/api-client";
import { Button, ConfirmDialog, StatusBadge } from "@fluxkit/ui";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { jsonEqual } from "../../lib/diff-for-patch";
import type { WriteOutcome } from "../../lib/run-write";
import { useRefreshingResource } from "../../lib/use-refreshing-resource";
import { PATHS } from "../../router/paths";
import { useUnsavedChangesGuard } from "../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../router/unsaved-changes-dialog";
import { ResourceFallback } from "../../views/status-views";
import { ConfigGate, useAdminConfig, useContentLocales } from "../catalog-dictionaries/config-gate";
import {
  CreateUnknown,
  DangerZone,
  DeletedPanel,
  FocusedPanel,
  NoticeBar,
  linkClass,
  type NoticeKind,
} from "../catalog-dictionaries/dictionary-frame";
import { FormErrorSummary, type ContentLocales } from "../catalog-dictionaries/form-parts";
import { hasIssues } from "../catalog-dictionaries/form-rules";
import { localeFieldNames } from "../catalog-dictionaries/locale-text";
import { useEditorState } from "../catalog-dictionaries/use-editor-state";
import { useFormSubmit } from "../catalog-dictionaries/use-form-submit";
import { MethodFormView } from "./method-form-view";
import {
  emptyMethodForm,
  methodCreateBody,
  methodFormFrom,
  methodPatchBody,
  pricedInShopCurrency,
  validateMethodForm,
  type MethodFormContext,
  type MethodFormValues,
} from "./method-form";
import { METHOD_STATUS_TONES, methodHref, methodStatusLabelKey, methodTitle } from "./method-view";
import { ShippingFrame } from "./shipping-frame";
import { useCanManageShipping } from "./shipping-permissions";
import { deleteProblemMapper, methodProblemMapper } from "./shipping-errors";

/** The field names a method form can show an error on (the API's `errors[].path`), for the values on screen now. */
export function methodFieldNames(values: MethodFormValues, locales: readonly string[]): string[] {
  const tiers = values.pricing.tiers.flatMap((_, index) => [
    `pricing.tiers.${String(index)}.fromSubtotal`,
    `pricing.tiers.${String(index)}.amount`,
  ]);
  return [
    "code",
    "kind",
    "providerCode",
    "providerService",
    "countryCodes",
    "position",
    "isActive",
    "pricing",
    "pricing.type",
    "pricing.amount",
    "pricing.freeFrom",
    "pricing.tiers",
    ...tiers,
    ...localeFieldNames("title", locales),
    ...localeFieldNames("description", locales),
  ];
}

function contextOf(content: ContentLocales, config: AdminConfig): MethodFormContext {
  return {
    defaultLocale: content.defaultLocale,
    locales: content.locales,
    exponent: config.currencyExponent,
  };
}

function MethodCreate() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const config = useAdminConfig();
  const canManage = useCanManageShipping();
  const context = contextOf(content, config);
  const [initial, setInitial] = useState(() => emptyMethodForm(content.locales));
  const [values, setValues] = useState<MethodFormValues>(initial);
  const [created, setCreated] = useState<AdminShippingMethod | null>(null);
  const [unknown, setUnknown] = useState(false);
  const form = useFormSubmit(methodFieldNames(values, content.locales), methodProblemMapper);
  const blocker = useUnsavedChangesGuard(
    !jsonEqual(initial, values) && created === null && !form.state.busy,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canManage) return;
    const issues = validateMethodForm(values, "create", context);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = methodCreateBody(values, context);
    const outcome = await form.submit(() => adminClient.createShippingMethod(body));
    if (outcome.kind === "ok") setCreated(outcome.data);
    else if (outcome.kind === "unknown") setUnknown(true);
  }

  function again() {
    const fresh = emptyMethodForm(content.locales);
    setInitial(fresh);
    setValues(fresh);
    setCreated(null);
    setUnknown(false);
  }

  return (
    <ShippingFrame t={t} current="shipping" title={t("page.shippingMethodNew.title")}>
      {created !== null ? (
        <FocusedPanel
          title={t("ship.created", { title: methodTitle(created, locale, content.defaultLocale) })}
        >
          <p className="flex flex-wrap gap-4">
            <Link to={methodHref(created.id)} className={linkClass}>
              {t("ship.openCreated")}
            </Link>
            <Button variant="secondary" onClick={again}>
              {t("dict.form.createAnother")}
            </Button>
            <Link to={PATHS.shipping} className={linkClass}>
              {t("dict.form.backToList")}
            </Link>
          </p>
        </FocusedPanel>
      ) : (
        <>
          {unknown ? <CreateUnknown t={t} listTo={PATHS.shipping} /> : null}
          <MethodFormView
            t={t}
            uiLocale={locale}
            content={content}
            mode="create"
            idPrefix="method"
            values={values}
            onChange={setValues}
            issues={form.state.fieldErrors}
            summary={form.state.summary}
            summaryRef={form.summaryRef}
            busy={form.state.busy}
            canManage={canManage}
            onSubmit={(event) => void submit(event)}
            cancelTo={PATHS.shipping}
            currency={config.shopCurrency}
            exponent={config.currencyExponent}
          />
        </>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </ShippingFrame>
  );
}

/** `/shipping/methods/new`: create a delivery method (inactive unless the box is ticked). */
export function ShippingMethodNewPage() {
  return (
    <ConfigGate>
      <MethodCreate />
    </ConfigGate>
  );
}

function MethodEditForm({
  method,
  content,
  config,
  onChanged,
}: {
  method: AdminShippingMethod;
  content: ContentLocales;
  config: AdminConfig;
  onChanged: (kind: NoticeKind) => void;
}) {
  const { t, locale } = useI18n();
  const canManage = useCanManageShipping();
  const context = contextOf(content, config);
  const exponent = config.currencyExponent;
  const pricingShown = pricedInShopCurrency(method, config.shopCurrency);
  const [initial, setInitial] = useState(() =>
    methodFormFrom(method, content.locales, exponent, config.shopCurrency),
  );
  const [values, setValues] = useState<MethodFormValues>(initial);
  const form = useFormSubmit(methodFieldNames(values, content.locales), methodProblemMapper);
  const blocker = useUnsavedChangesGuard(!jsonEqual(initial, values) && !form.state.busy);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.state.busy || !canManage) return;
    const issues = validateMethodForm(values, "edit", context);
    if (hasIssues(issues)) {
      form.showIssues(issues);
      return;
    }
    const body = methodPatchBody(initial, values, context, { pricingShown });
    if (Object.keys(body).length === 0) {
      onChanged("noChanges");
      return;
    }
    const outcome = await form.submit(() => adminClient.updateShippingMethod(method.id, body));
    if (outcome.kind === "ok") {
      setInitial(values);
      onChanged("saved");
    } else if (outcome.kind === "unknown") onChanged("unknown");
  }

  return (
    <>
      <MethodFormView
        t={t}
        uiLocale={locale}
        content={content}
        mode="edit"
        idPrefix="method"
        values={values}
        onChange={setValues}
        issues={form.state.fieldErrors}
        summary={form.state.summary}
        summaryRef={form.summaryRef}
        busy={form.state.busy}
        canManage={canManage}
        onSubmit={(event) => void submit(event)}
        cancelTo={PATHS.shipping}
        currency={config.shopCurrency}
        exponent={exponent}
        {...(pricingShown
          ? {}
          : {
              pricingNotice: t("ship.pricing.otherCurrency", {
                currency: method.currency,
                shop: config.shopCurrency,
              }),
            })}
      />
      <UnsavedChangesDialog blocker={blocker} />
    </>
  );
}

/**
 * Delete with a confirmation (danger tone, the safe choice focused). `409 method_in_use` is explained in the dialog, which
 * stays open, with the advice to deactivate the method instead; a lost answer closes it and hands over to the page, which
 * reloads what the server has. Renders nothing without the permission.
 */
function ConfirmDeleteMethod({
  canManage,
  open,
  onClose,
  remove,
  onDeleted,
  onUnknown,
  code,
}: {
  canManage: boolean;
  open: boolean;
  onClose: () => void;
  remove: () => Promise<AdminResult<undefined>>;
  onDeleted: () => void;
  onUnknown: () => void;
  code: string;
}) {
  const { t } = useI18n();
  const form = useFormSubmit([], deleteProblemMapper);
  if (!canManage) return null;

  async function confirm() {
    const outcome: WriteOutcome<undefined> = await form.submit(remove);
    if (outcome.kind === "ok") {
      form.clear();
      onDeleted();
    } else if (outcome.kind === "unknown") {
      form.clear();
      onUnknown();
    }
  }

  return (
    <ConfirmDialog
      open={open}
      tone="danger"
      busy={form.state.busy}
      title={t("ship.delete.title", { code })}
      description={t("ship.delete.body")}
      confirmLabel={t("ship.delete.confirm")}
      cancelLabel={t("dict.form.cancel")}
      onClose={() => {
        form.clear();
        onClose();
      }}
      onConfirm={() => void confirm()}
    >
      <FormErrorSummary t={t} summary={form.state.summary} summaryRef={form.summaryRef} />
    </ConfirmDialog>
  );
}

function MethodEditor({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const config = useAdminConfig();
  const canManage = useCanManageShipping();
  const resource = useRefreshingResource(
    (signal) => adminClient.getShippingMethod(id, { signal }),
    [id],
  );
  const editor = useEditorState(resource.reload);
  const method = resource.data;
  const title =
    method === null
      ? t("page.shippingMethodDetail.title")
      : methodTitle(method, locale, content.defaultLocale);

  if (editor.deleted) {
    return (
      <ShippingFrame t={t} current="shipping" title={t("page.shippingMethodDetail.title")}>
        <DeletedPanel t={t} title={t("ship.deleted")} listTo={PATHS.shipping} />
      </ShippingFrame>
    );
  }

  return (
    <ShippingFrame
      t={t}
      current="shipping"
      title={title}
      actions={
        method === null ? null : (
          <StatusBadge
            tone={METHOD_STATUS_TONES[method.isActive ? "active" : "inactive"]}
            label={t(methodStatusLabelKey(method.isActive))}
          />
        )
      }
    >
      <NoticeBar t={t} notice={editor.notice} innerRef={editor.noticeRef} />
      {resource.fallback !== null ? (
        <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
      ) : method === null ? null : (
        <div className="flex flex-col gap-8" aria-busy={resource.refreshing || undefined}>
          <MethodEditForm
            key={method.updatedAt}
            method={method}
            content={content}
            config={config}
            onChanged={editor.changed}
          />
          <DangerZone
            t={t}
            canWrite={canManage}
            id="method-danger"
            info={t("ship.delete.info")}
            buttonLabel={t("ship.delete.button")}
            onDelete={() => editor.setConfirmingDelete(true)}
          />
          {editor.confirmingDelete ? (
            <ConfirmDeleteMethod
              canManage={canManage}
              open
              code={method.code}
              onClose={() => editor.setConfirmingDelete(false)}
              remove={() => adminClient.deleteShippingMethod(method.id)}
              onDeleted={() => {
                editor.setConfirmingDelete(false);
                editor.setDeleted(true);
              }}
              onUnknown={() => {
                editor.setConfirmingDelete(false);
                editor.changed("unknown");
              }}
            />
          ) : null}
        </div>
      )}
    </ShippingFrame>
  );
}

/** `/shipping/methods/:id`: one delivery method with its editor and the delete section. */
export function ShippingMethodDetailPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error("The shipping method route has no id parameter.");
  return (
    <ConfigGate>
      <MethodEditor key={id} id={id} />
    </ConfigGate>
  );
}
