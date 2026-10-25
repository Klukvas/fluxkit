import { Checkbox, Field, Select, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import {
  FormActions,
  FormErrorSummary,
  LocaleFields,
  TextField,
  describe,
  type ContentLocales,
} from "../catalog-dictionaries/form-parts";
import { CODE_PATTERN_SOURCE, type FormIssues } from "../catalog-dictionaries/form-rules";
import {
  METHOD_KINDS,
  PROVIDER_SERVICE_MAX_LENGTH,
  kindUsesProvider,
  type MethodFormMode,
  type MethodFormValues,
} from "./method-form";
import { kindLabelKey } from "./method-view";
import { PricingFields } from "./pricing-fields";

export interface MethodFormViewProps {
  t: Translator;
  uiLocale: string;
  content: ContentLocales;
  mode: MethodFormMode;
  idPrefix: string;
  values: MethodFormValues;
  onChange: (next: MethodFormValues) => void;
  issues: FormIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  canManage: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  cancelTo: string;
  currency: string;
  exponent: number;
  /** Set when the stored pricing is in another currency than the shop's (its amounts are typed again). */
  pricingNotice?: string;
}

/**
 * The delivery method form, create and edit: code (never renamed), texts per language, kind, carrier and service, countries,
 * position, active, and the price. Read-only without the permission. Presentational: the page owns the values and sends.
 */
export function MethodFormView({
  t,
  uiLocale,
  content,
  mode,
  idPrefix,
  values,
  onChange,
  issues,
  summary,
  summaryRef,
  busy,
  canManage,
  onSubmit,
  cancelTo,
  currency,
  exponent,
  pricingNotice,
}: MethodFormViewProps) {
  const create = mode === "create";
  const usesProvider = kindUsesProvider(values.kind);
  const activeHintId = `${idPrefix}-active-hint`;
  const kindIssue = issues["kind"];
  return (
    <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
      <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
      <TextField
        t={t}
        id={`${idPrefix}-code`}
        name="code"
        label={t("ship.form.code")}
        hint={t(create ? "ship.form.codeHintCreate" : "ship.form.codeHintEdit")}
        value={values.code}
        readOnly={!create || !canManage}
        required={create}
        maxLength={64}
        pattern={CODE_PATTERN_SOURCE}
        patternHint={t("ship.form.codeHintCreate")}
        error={issues["code"]}
        onChange={(code) => onChange({ ...values, code })}
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-title`}
        legend={t("ship.form.title")}
        field="title"
        content={content}
        uiLocale={uiLocale}
        values={values.title}
        errors={issues}
        readOnly={!canManage}
        onChange={(locale, text) =>
          onChange({ ...values, title: { ...values.title, [locale]: text } })
        }
      />
      <LocaleFields
        t={t}
        id={`${idPrefix}-description`}
        legend={t("ship.form.description")}
        field="description"
        content={content}
        uiLocale={uiLocale}
        values={values.description}
        errors={issues}
        readOnly={!canManage}
        multiline
        required={false}
        onChange={(locale, text) =>
          onChange({ ...values, description: { ...values.description, [locale]: text } })
        }
      />
      <p className="-mt-4 text-sm text-muted-foreground">
        {t(
          values.kind === "store_pickup"
            ? "ship.form.descriptionHintPickup"
            : "ship.form.descriptionHint",
        )}
      </p>
      <Field
        id={`${idPrefix}-kind`}
        label={t("ship.form.kind")}
        hint={t(`ship.kind.hint.${values.kind}`)}
        error={kindIssue === undefined ? undefined : describe(t, kindIssue)}
        required
        requiredIndicator={t("dict.form.requiredMark")}
      >
        {(control) => (
          <Select
            {...control}
            name="kind"
            value={values.kind}
            disabled={!canManage}
            onChange={(event) =>
              onChange({ ...values, kind: event.target.value as MethodFormValues["kind"] })
            }
          >
            {METHOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(kindLabelKey(kind))}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {usesProvider ? (
        <>
          <TextField
            t={t}
            id={`${idPrefix}-providerCode`}
            name="providerCode"
            label={t("ship.form.providerCode")}
            hint={t(
              values.kind === "pickup_point"
                ? "ship.form.providerCodeHintRequired"
                : "ship.form.providerCodeHint",
            )}
            value={values.providerCode}
            readOnly={!canManage}
            required={values.kind === "pickup_point"}
            maxLength={64}
            pattern={CODE_PATTERN_SOURCE}
            patternHint={t("ship.form.providerCodeHint")}
            error={issues["providerCode"]}
            onChange={(providerCode) => onChange({ ...values, providerCode })}
          />
          <TextField
            t={t}
            id={`${idPrefix}-providerService`}
            name="providerService"
            label={t("ship.form.providerService")}
            hint={t("ship.form.providerServiceHint")}
            value={values.providerService}
            readOnly={!canManage}
            maxLength={PROVIDER_SERVICE_MAX_LENGTH}
            error={issues["providerService"]}
            onChange={(providerService) => onChange({ ...values, providerService })}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("ship.form.noCarrierForPickup")}</p>
      )}
      <TextField
        t={t}
        id={`${idPrefix}-countries`}
        name="countryCodes"
        label={t("ship.form.countries")}
        hint={t("ship.form.countriesHint")}
        value={values.countries}
        readOnly={!canManage}
        required
        autoComplete="off"
        error={issues["countryCodes"]}
        onChange={(countries) => onChange({ ...values, countries })}
      />
      <TextField
        t={t}
        id={`${idPrefix}-position`}
        name="position"
        label={t("ship.form.position")}
        hint={t("ship.form.positionHint")}
        value={values.position}
        readOnly={!canManage}
        inputMode="numeric"
        error={issues["position"]}
        onChange={(position) => onChange({ ...values, position })}
      />
      <PricingFields
        t={t}
        idPrefix={`${idPrefix}-pricing`}
        values={values.pricing}
        onChange={(pricing) => onChange({ ...values, pricing })}
        issues={issues}
        currency={currency}
        exponent={exponent}
        readOnly={!canManage}
        {...(pricingNotice === undefined ? {} : { notice: pricingNotice })}
      />
      <div className="flex flex-col gap-1">
        <Checkbox
          id={`${idPrefix}-active`}
          name="isActive"
          label={t("ship.form.active")}
          checked={values.isActive}
          disabled={!canManage}
          aria-describedby={activeHintId}
          onChange={(event) => onChange({ ...values, isActive: event.target.checked })}
        />
        <p id={activeHintId} className="max-w-prose text-sm text-muted-foreground">
          {t("ship.form.activeHint")}
        </p>
      </div>
      {canManage ? (
        <FormActions
          t={t}
          busy={busy}
          submitLabel={t(create ? "ship.form.create" : "dict.form.save")}
          busyLabel={t("dict.form.saving")}
          cancelTo={cancelTo}
          cancelLabel={t("dict.form.backToList")}
        />
      ) : null}
    </form>
  );
}
