import type {
  AdminBrand,
  AdminCategory,
  AdminProductSummary,
  AdminResult,
  LocalizedText,
} from "@fluxkit/api-client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { SEARCH_DEBOUNCE_MS, createDebounce } from "../../lib/debounce";
import { failureFromError } from "../../lib/failure";
import { loadByIds } from "../../lib/load-by-ids";
import { useCrash } from "../../lib/use-crash";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { ConfigGate, useContentLocales } from "../catalog-dictionaries/config-gate";
import { resolveLocalized } from "../catalog-dictionaries/locale-text";
import { ServerPicker } from "../catalog-dictionaries/server-picker";
import {
  PRODUCT_STATUSES,
  checkSearchText,
  listRequest,
  readProductListQuery,
  withFilter,
  writeProductListQuery,
  type FilterChange,
  type ProductListQuery,
} from "./product-list-query";
import { ProductListView, shortId } from "./product-list-view";

interface Named {
  name: LocalizedText;
  slug: string;
}
import { useCan } from "./use-can";

/**
 * Brand names of the products on the page: one read per distinct brand (at most six at a time), kept while the page lives
 * so paging does not ask again. A brand that cannot be read shows its short id.
 */
function useBrandNames(products: readonly AdminProductSummary[] | null): Map<string, AdminBrand> {
  const [known, setKnown] = useState<Map<string, AdminBrand>>(() => new Map());
  const knownRef = useRef(known);
  knownRef.current = known;
  const crash = useCrash();
  const wanted = (products ?? [])
    .map((product) => product.brandId)
    .filter((id): id is string => id !== null && !known.has(id));
  const key = [...new Set(wanted)].sort().join(",");
  useEffect(() => {
    if (key === "") return undefined;
    const controller = new AbortController();
    loadByIds(key.split(","), (id) => adminClient.getBrand(id, { signal: controller.signal })).then(
      (found) => {
        if (controller.signal.aborted) return;
        setKnown(new Map([...knownRef.current, ...found]));
      },
      (error: unknown) => {
        // A lost answer only costs the names (short ids stay); a bug goes to the boundary.
        try {
          failureFromError(error);
        } catch (bug) {
          crash(bug);
        }
      },
    );
    return () => controller.abort();
  }, [key, crash]);
  return known;
}

/** The label of a filter's current value (a brand or category id from the URL that may not be on a loaded page). */
function useFilterLabel(
  id: string | undefined,
  read: (id: string, signal: AbortSignal) => Promise<AdminResult<Named>>,
): { value: string; label: string } | null {
  const { locale } = useI18n();
  const content = useContentLocales();
  const resource = useResource<Named | null>(
    (signal) =>
      id === undefined ? Promise.resolve({ ok: true, status: 200, data: null }) : read(id, signal),
    [id],
  );
  if (id === undefined) return null;
  if (resource.status !== "ready" || resource.data === null) {
    return { value: id, label: shortId(id) };
  }
  return {
    value: id,
    label:
      resolveLocalized(resource.data.name, locale, content.defaultLocale) || resource.data.slug,
  };
}

function ProductList() {
  const { t, locale } = useI18n();
  const content = useContentLocales();
  const canCreate = useCan("createProduct");
  const [params, setParams] = useSearchParams();
  const query = readProductListQuery(params);
  const queryKey = writeProductListQuery(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  const resource = useResource(
    (signal) => adminClient.listProducts({ ...listRequest(query), signal }),
    [queryKey],
  );
  const brands = useBrandNames(resource.status === "ready" ? resource.data.items : null);
  const brandNames = new Map(
    [...brands].map(([id, brand]) => [
      id,
      resolveLocalized(brand.name, locale, content.defaultLocale) || brand.slug,
    ]),
  );

  // The search field: typed text is applied to the URL 300 ms after the last keystroke, if the API would accept it.
  const [searchText, setSearchText] = useState(query.q);
  const [debounce] = useState(() => createDebounce(SEARCH_DEBOUNCE_MS));
  const applied = useRef(query.q);
  useEffect(() => () => debounce.cancel(), [debounce]);
  useEffect(() => {
    // Back and forward (or a link) changed the URL's search: the field follows.
    if (query.q !== applied.current) {
      applied.current = query.q;
      setSearchText(query.q);
    }
  }, [query.q]);
  const check = checkSearchText(searchText);

  function apply(change: FilterChange, replace: boolean) {
    const next = withFilter(queryRef.current, change);
    if (change.q !== undefined) applied.current = next.q;
    setParams(writeProductListQuery(next), { replace });
  }

  function onSearchChange(text: string) {
    setSearchText(text);
    const result = checkSearchText(text);
    if (!result.ok) {
      debounce.cancel();
      return;
    }
    if (result.value === queryRef.current.q) {
      debounce.cancel();
      return;
    }
    // Typing replaces the history entry, so Back leaves the list instead of undoing keystrokes.
    debounce.schedule(() => apply({ q: result.value }, true));
  }

  function onSearchSubmit() {
    debounce.cancel();
    if (check.ok && check.value !== query.q) apply({ q: check.value }, false);
  }

  const brandSelected = useFilterLabel(query.brandId, (id, signal) =>
    adminClient.getBrand(id, { signal }),
  );
  const categorySelected = useFilterLabel(query.categoryId, (id, signal) =>
    adminClient.getCategory(id, { signal }),
  );

  return (
    <ProductListView
      t={t}
      uiLocale={locale}
      defaultLocale={content.defaultLocale}
      query={query}
      state={resource}
      onRetry={resource.reload}
      brandNames={brandNames}
      canCreate={canCreate}
      searchText={searchText}
      searchError={
        check.ok
          ? undefined
          : {
              key:
                check.reason === "too_long"
                  ? "products.list.searchTooLong"
                  : "products.list.searchInvalid",
            }
      }
      onSearchChange={onSearchChange}
      onSearchSubmit={onSearchSubmit}
      onStatusChange={(status) =>
        apply(
          {
            status: (PRODUCT_STATUSES as readonly string[]).includes(status)
              ? (status as ProductListQuery["status"])
              : undefined,
          },
          false,
        )
      }
      brandFilter={
        <div className="min-w-56">
          <ServerPicker<AdminBrand>
            t={t}
            id="product-brand-filter"
            name="brandId"
            label={t("products.list.brand")}
            value={query.brandId ?? ""}
            selected={brandSelected}
            onChange={(value) => apply({ brandId: value === "" ? undefined : value }, false)}
            fetchPage={(offset, limit, signal) => adminClient.listBrands({ offset, limit, signal })}
            keyOf={(brand) => brand.id}
            labelOf={(brand) =>
              resolveLocalized(brand.name, locale, content.defaultLocale) || brand.slug
            }
            emptyChoiceLabel={t("products.list.anyBrand")}
          />
        </div>
      }
      categoryFilter={
        <div className="min-w-56">
          <ServerPicker<AdminCategory>
            t={t}
            id="product-category-filter"
            name="categoryId"
            label={t("products.list.category")}
            hint={t("products.list.categoryHint")}
            value={query.categoryId ?? ""}
            selected={categorySelected}
            onChange={(value) => apply({ categoryId: value === "" ? undefined : value }, false)}
            fetchPage={(offset, limit, signal) =>
              adminClient.listCategories({ offset, limit, signal })
            }
            keyOf={(category) => category.id}
            labelOf={(category) =>
              t("products.list.categoryChoice", {
                name:
                  resolveLocalized(category.name, locale, content.defaultLocale) || category.slug,
                slug: category.slug,
              })
            }
            emptyChoiceLabel={t("products.list.anyCategory")}
          />
        </div>
      }
      hrefForOffset={(offset) => `${PATHS.products}${writeProductListQuery({ ...query, offset })}`}
    />
  );
}

/** `/products`: the server-driven product list; filters, search and paging live in the URL. */
export function ProductsPage() {
  return (
    <ConfigGate>
      <ProductList />
    </ConfigGate>
  );
}
