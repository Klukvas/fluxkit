import type { SearchFacet } from "@fluxkit/api-client";
import { Button, Checkbox, Input, type Translator } from "@fluxkit/ui";
import { facetTitle, facetValueLabel, priceBoxHints } from "../lib/search-facets";
import { minorUnitsToInput } from "../lib/search-money";
import { rangeOf, type SearchQuery } from "../lib/search-query";

/**
 * The fields of the filter form, as server markup (the form element and its script-side behaviour are `SearchFilterForm`).
 * One `fieldset` with a `legend` per facet; every value is a checkbox named `f` with the value `<facetKey>:<code>`, the
 * exact parameter of `GET /store/search`. Counts appear only where the API gives one (product-level facets): the
 * variant-level facets list their values without numbers (ADR 0034 decision 4), never a made-up one. A number attribute is
 * two boxes (`rmin.<key>`, `rmax.<key>`), the price two boxes in major units (`priceMin`, `priceMax`); both are turned into
 * `f` and `price` by `parseSearchForm`, here in the browser or on the server for a submit without a script.
 *
 * The page keys this component by the address, so the checkboxes and boxes start over with every new result (they are
 * uncontrolled).
 */

const group = "flex min-w-0 flex-col gap-1 border-0 p-0";
const legend = "mb-1 p-0 font-semibold text-foreground";

function FacetValues({ facet, t }: { facet: SearchFacet; t: Translator }) {
  return (
    <fieldset className={group}>
      <legend className={legend}>{facetTitle(t, facet)}</legend>
      <ul className="flex max-h-64 flex-col overflow-auto">
        {facet.values.map((value) => (
          <li key={value.code}>
            <Checkbox
              name="f"
              value={`${facet.key}:${value.code}`}
              defaultChecked={value.selected}
              label={
                <>
                  {facetValueLabel(t, facet, value)}
                  {value.count === null ? null : (
                    <span className="text-muted-foreground"> ({value.count})</span>
                  )}
                </>
              }
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function RangeBoxes({
  facet,
  query,
  t,
}: {
  facet: SearchFacet;
  query: SearchQuery;
  t: Translator;
}) {
  const chosen = rangeOf(query, facet.key);
  return (
    <fieldset className={group}>
      <legend className={legend}>{facetTitle(t, facet)}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm text-foreground">
          <span>{t("search.facet.min")}</span>
          <Input
            name={`rmin.${facet.key}`}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={chosen?.min ?? ""}
            {...(facet.range === null ? {} : { placeholder: String(facet.range.min) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-foreground">
          <span>{t("search.facet.max")}</span>
          <Input
            name={`rmax.${facet.key}`}
            inputMode="decimal"
            autoComplete="off"
            defaultValue={chosen?.max ?? ""}
            {...(facet.range === null ? {} : { placeholder: String(facet.range.max) })}
          />
        </label>
      </div>
    </fieldset>
  );
}

export function SearchFilters({
  t,
  query,
  facets,
  price,
  currency,
  exponent,
}: {
  t: Translator;
  query: SearchQuery;
  facets: readonly SearchFacet[];
  /** Cheapest and dearest price of the result (minor units), for the placeholders. */
  price: { min: number; max: number } | null;
  currency: string;
  exponent: number;
}) {
  const hints = priceBoxHints(price, exponent);
  const chosenPrice = query.price ?? { min: null, max: null };
  return (
    <>
      {/* The words go along, so a filter keeps them. The sort select (outside the form's box) joins by its `form` attribute. */}
      <input type="hidden" name="q" value={query.q} />
      <fieldset className={group}>
        <legend className={legend}>{t("search.facet.price", { currency })}</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span>{t("search.facet.min")}</span>
            <Input
              name="priceMin"
              inputMode="decimal"
              autoComplete="off"
              pattern="[0-9]*[.,]?[0-9]*"
              defaultValue={
                chosenPrice.min === null ? "" : minorUnitsToInput(chosenPrice.min, exponent)
              }
              placeholder={hints.min}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-foreground">
            <span>{t("search.facet.max")}</span>
            <Input
              name="priceMax"
              inputMode="decimal"
              autoComplete="off"
              pattern="[0-9]*[.,]?[0-9]*"
              defaultValue={
                chosenPrice.max === null ? "" : minorUnitsToInput(chosenPrice.max, exponent)
              }
              placeholder={hints.max}
            />
          </label>
        </div>
      </fieldset>
      {facets.map((facet) =>
        facet.kind === "range" ? (
          <RangeBoxes key={facet.key} facet={facet} query={query} t={t} />
        ) : facet.values.length === 0 ? null : (
          <FacetValues key={facet.key} facet={facet} t={t} />
        ),
      )}
      <Button type="submit" className="min-h-11 self-start">
        {t("search.filters.apply")}
      </Button>
    </>
  );
}
