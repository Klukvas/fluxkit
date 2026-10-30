import { Button, Field, Input, Select, type Translator } from "@fluxkit/ui";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import type { FormIssues } from "../catalog-dictionaries/form-rules";
import { describe } from "../catalog-dictionaries/form-parts";
import { MAX_TIERS, PRICING_TYPES, type PricingType, type PricingValues } from "./pricing-form";

export interface PricingFieldsProps {
  t: Translator;
  idPrefix: string;
  values: PricingValues;
  onChange: (next: PricingValues) => void;
  issues: FormIssues;
  /** The shop currency's code (shown in the labels; it is data from the config, not a symbol typed here). */
  currency: string;
  /** Digits of the minor unit: how many decimals an amount may have. */
  exponent: number;
  readOnly: boolean;
  /** A note above the fields (the stored pricing is in another currency and has to be typed again). */
  notice?: string;
}

function MoneyField({
  t,
  id,
  label,
  hint,
  value,
  issue,
  readOnly,
  onChange,
}: {
  t: Translator;
  id: string;
  label: string;
  hint: string;
  value: string;
  issue: FormIssues[string];
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={issue === undefined ? undefined : describe(t, issue)}
      required
      requiredIndicator={t("dict.form.requiredMark")}
    >
      {(control) => (
        <Input
          {...control}
          name={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * The price of a method: the type, then the amounts of that type typed as DECIMALS in the shop currency (the request holds
 * minor units; `pricing-form.ts` converts). Amounts are labelled with the currency code from the config, never a symbol.
 */
export function PricingFields({
  t,
  idPrefix,
  values,
  onChange,
  issues,
  currency,
  exponent,
  readOnly,
  notice,
}: PricingFieldsProps) {
  const addId = `${idPrefix}-add-tier`;
  const focusAfterCommit = useFocusAfterCommit();
  const hint = t("ship.pricing.amountHint", { currency, decimals: exponent });
  const setTier = (index: number, field: "fromSubtotal" | "amount", value: string) =>
    onChange({
      ...values,
      tiers: values.tiers.map((tier, position) =>
        position === index ? { ...tier, [field]: value } : tier,
      ),
    });
  const groupIssue = issues["pricing"] ?? issues["pricing.tiers"];

  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
      <legend className="px-1 text-lg font-semibold text-foreground">
        {t("ship.pricing.legend")}
      </legend>
      {notice === undefined ? null : (
        <p role="note" className="rounded-md border border-warning p-3 text-foreground">
          {notice}
        </p>
      )}
      <Field
        id={`${idPrefix}-type`}
        label={t("ship.pricing.type")}
        required
        requiredIndicator={t("dict.form.requiredMark")}
      >
        {(control) => (
          <Select
            {...control}
            name="pricingType"
            value={values.type}
            disabled={readOnly}
            onChange={(event) => onChange({ ...values, type: event.target.value as PricingType })}
          >
            {PRICING_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`ship.pricing.type.${type}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p className="max-w-prose text-sm text-muted-foreground">
        {t(`ship.pricing.explain.${values.type}`)}
      </p>
      {values.type === "flat" || values.type === "free_over" ? (
        <MoneyField
          t={t}
          id={`${idPrefix}-amount`}
          label={t("ship.pricing.amount", { currency })}
          hint={hint}
          value={values.amount}
          issue={issues["pricing.amount"]}
          readOnly={readOnly}
          onChange={(amount) => onChange({ ...values, amount })}
        />
      ) : null}
      {values.type === "free_over" ? (
        <MoneyField
          t={t}
          id={`${idPrefix}-freeFrom`}
          label={t("ship.pricing.freeFrom", { currency })}
          hint={t("ship.pricing.freeFromHint")}
          value={values.freeFrom}
          issue={issues["pricing.freeFrom"]}
          readOnly={readOnly}
          onChange={(freeFrom) => onChange({ ...values, freeFrom })}
        />
      ) : null}
      {values.type === "tiers" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{hint}</p>
          {groupIssue === undefined ? null : (
            <p className="text-sm text-danger">{describe(t, groupIssue)}</p>
          )}
          <ol className="flex flex-col gap-4">
            {values.tiers.map((tier, index) => (
              <li key={index} className="flex flex-wrap items-start gap-4">
                <MoneyField
                  t={t}
                  id={`${idPrefix}-tier-${String(index)}-from`}
                  label={t("ship.pricing.tierFrom", { number: index + 1, currency })}
                  hint={t("ship.pricing.tierFromHint")}
                  value={tier.fromSubtotal}
                  issue={issues[`pricing.tiers.${String(index)}.fromSubtotal`]}
                  readOnly={readOnly}
                  onChange={(value) => setTier(index, "fromSubtotal", value)}
                />
                <MoneyField
                  t={t}
                  id={`${idPrefix}-tier-${String(index)}-amount`}
                  label={t("ship.pricing.tierAmount", { number: index + 1, currency })}
                  hint={t("ship.pricing.tierAmountHint")}
                  value={tier.amount}
                  issue={issues[`pricing.tiers.${String(index)}.amount`]}
                  readOnly={readOnly}
                  onChange={(value) => setTier(index, "amount", value)}
                />
                {readOnly || values.tiers.length <= 1 ? null : (
                  <div className="pt-7">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        onChange({
                          ...values,
                          tiers: values.tiers.filter((_, position) => position !== index),
                        });
                        focusAfterCommit(addId);
                      }}
                    >
                      {t("ship.pricing.removeTier", { number: index + 1 })}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {readOnly ? null : (
            <div>
              <Button
                id={addId}
                variant="secondary"
                disabled={values.tiers.length >= MAX_TIERS}
                onClick={() => {
                  const next = values.tiers.length;
                  onChange({
                    ...values,
                    tiers: [...values.tiers, { fromSubtotal: "", amount: "" }],
                  });
                  focusAfterCommit(`${idPrefix}-tier-${String(next)}-from`);
                }}
              >
                {t("ship.pricing.addTier")}
              </Button>
              {values.tiers.length >= MAX_TIERS ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {t("ship.pricing.maxTiers", { max: MAX_TIERS })}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </fieldset>
  );
}
