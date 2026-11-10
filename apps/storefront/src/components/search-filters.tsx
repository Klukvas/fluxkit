import type { SearchFacet } from "@fluxkit/api-client";
import { Button, Checkbox, Input, textStyles, VisuallyHidden, type Translator } from "@fluxkit/ui";
import type { ReactNode } from "react";
import { openFacetKeys } from "../lib/mobile-ux";
import { facetTitle, facetValueLabel, priceBoxHints } from "../lib/search-facets";
import { minorUnitsToInput } from "../lib/search-money";
import { rangeOf, type SearchQuery } from "../lib/search-query";
import { ChevronDownIcon } from "./icons";
import { focusRing } from "./styles";

/**
 * The fields of the filter form, as server markup (the form element and its script-side behaviour are `SearchFilterForm`).
 * One `fieldset` with a `legend` per facet; every value is a checkbox named `f` with the value `<facetKey>:<code>`, the
 * exact parameter of `GET /store/search`. Counts appear only where the API gives one (product-level facets): the
 * variant-level facets list their values without numbers (ADR 0034 decision 4), never a made-up one. A number attribute is
 * two boxes (`rmin.<key>`, `rmax.<key>`), the price two boxes in major units (`priceMin`, `priceMax`); both are turned into
 * `f` and `price` by `parseSearchForm`, here in the browser or on the server for a submit without a script.
 *
 * Each facet is a collapsible group (`details`, review D-05): the first two and every group with a choice start open, so a
 * root catalog with many product types is a short list of titles. A closed group's checkboxes still belong to the form.
 * The actions (Apply and Clear) stick to the bottom of the mobile filter sheet.
 *
 * The page keys this component by the address, so the checkboxes and boxes start over with every new result (they are
 * uncontrolled).
 */

const group = "flex min-w-0 flex-col gap-1 border-0 p-0";

/** A collapsible facet group: the summary shows the title; the fieldset keeps its legend for assistive technology. */
function FacetGroup({
  title,
  open,
  children,
}: {
  title: string;
  open: boolean;
  children: ReactNode;
}) {
  return (
    <details open={open} className="group/facet border-t border-border pt-2">
      <summary className={`fk-facet-summary ${focusRing}`}>
        <span>{title}</span>
        <ChevronDownIcon className="shrink-0 group-open/facet:rotate-180" />
      </summary>
      {children}
    </details>
  );
}

function FacetValues({ facet, t }: { facet: SearchFacet; t: Translator }) {
  return (
    <fieldset className={group}>
      <legend>
        <VisuallyHidden>{facetTitle(t, facet)}</VisuallyHidden>
      </legend>
      <ul className="flex max-h-64 flex-col overflow-auto">
        {facet.values.map((value) => (
          <li key={value.code}>
            <Checkbox
              fullWidth
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
      <legend>
        <VisuallyHidden>{facetTitle(t, facet)}</VisuallyHidden>
      </legend>
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
  clearHref,
}: {
  t: Translator;
  query: SearchQuery;
  /** The same list without filters (the "Clear" link next to Apply), `null` when nothing is chosen. */
  clearHref: string | null;
  facets: readonly SearchFacet[];
  /** Cheapest and dearest price of the result (minor units), for the placeholders. */
  price: { min: number; max: number } | null;
  currency: string;
  exponent: number;
}) {
  const hints = priceBoxHints(price, exponent);
  const chosenPrice = query.price ?? { min: null, max: null };
  const open = openFacetKeys(facets, query, 2);
  return (
    <>
      {/* The words go along, so a filter keeps them. The sort select (outside the form's box) joins by its `form` attribute. */}
      <input type="hidden" name="q" value={query.q} />
      {/* The list view goes along too (plan 2026-11-08 L5); the default grid writes nothing. */}
      {query.view === undefined ? null : <input type="hidden" name="view" value={query.view} />}
      <fieldset className={group}>
        <legend className={`${textStyles.itemTitle} mb-1 p-0`}>
          {t("search.facet.price", { currency })}
        </legend>
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
          <FacetGroup key={facet.key} title={facetTitle(t, facet)} open={open.has(facet.key)}>
            <RangeBoxes facet={facet} query={query} t={t} />
          </FacetGroup>
        ) : facet.values.length === 0 ? null : (
          <FacetGroup key={facet.key} title={facetTitle(t, facet)} open={open.has(facet.key)}>
            <FacetValues facet={facet} t={t} />
          </FacetGroup>
        ),
      )}
      {/* Sticks to the bottom of the mobile sheet (and of the screen while the inline form is in view). */}
      <div className="fk-bottom-bar flex flex-wrap items-center gap-3 border-t border-border bg-background pt-3 max-lg:sticky max-lg:bottom-0 max-lg:z-10">
        <Button type="submit" className="min-h-11 max-lg:flex-1">
          {t("search.filters.apply")}
        </Button>
        {clearHref === null ? null : (
          <a
            href={clearHref}
            // Below `lg` only: from `lg` the chips above the list have "Clear all filters".
            className={`inline-flex min-h-11 items-center px-2 text-foreground underline underline-offset-4 lg:hidden ${focusRing}`}
          >
            {t("search.filters.clear")}
          </a>
        )}
      </div>
    </>
  );
}
