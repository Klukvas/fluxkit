import type { AdminConfig, AdminListOrdersOptions } from "@fluxkit/api-client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { SEARCH_DEBOUNCE_MS, createDebounce } from "../../lib/debounce";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { ResourceFallback } from "../../views/status-views";
import { browserTimeZone } from "../../lib/date-range";
import {
  ORDER_STATUS_FILTERS,
  checkOrderSearch,
  listRequest,
  readOrderListQuery,
  withFilter,
  writeOrderListQuery,
  type OrderFilterChange,
  type OrderListQuery,
} from "./order-list-query";
import { OrderListView, OrderResultsView } from "./order-list-view";
import { useOrderConfig } from "./order-parts";
import { moneyText } from "./order-view";

/** One page of orders for a request the API accepts; mounted only when the date range can be sent. */
function OrderResults({
  query,
  options,
  requestKey,
}: {
  query: OrderListQuery;
  options: AdminListOrdersOptions;
  requestKey: string;
}) {
  const { t, locale } = useI18n();
  const config = useOrderConfig();
  const resource = useResource(
    (signal) => adminClient.listOrders({ ...options, signal }),
    [requestKey],
  );
  if (config.status !== "ready") {
    return <ResourceFallback t={t} state={config} onRetry={config.reload} />;
  }
  const settings: AdminConfig = config.data;
  return (
    <OrderResultsView
      t={t}
      uiLocale={locale}
      query={query}
      state={resource}
      onRetry={resource.reload}
      totalText={(row) => moneyText(row.total, { locale, config: settings })}
      hrefForOffset={(offset) => `${PATHS.orders}${writeOrderListQuery({ ...query, offset })}`}
    />
  );
}

/** `/orders`: the server-driven order list; filters, search and paging live in the URL. */
export function OrderListPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = readOrderListQuery(params);
  const queryKey = writeOrderListQuery(query);
  const queryRef = useRef(query);
  queryRef.current = query;
  // The browser's zone (there is no shop time zone, plan gap 18); read once per screen.
  const [timeZone] = useState(browserTimeZone);
  const request = listRequest(query, timeZone);

  // The search field: typed text is applied to the URL 300 ms after the last keystroke, if the API would accept it.
  const [searchText, setSearchText] = useState(query.q);
  const [debounce] = useState(() => createDebounce(SEARCH_DEBOUNCE_MS));
  const applied = useRef(query.q);
  useEffect(() => () => debounce.cancel(), [debounce]);
  useEffect(() => {
    // Back and forward (or a link, such as a reservation's order link) changed the URL's search: the field follows.
    if (query.q !== applied.current) {
      applied.current = query.q;
      setSearchText(query.q);
    }
  }, [query.q]);
  const check = checkOrderSearch(searchText);

  function apply(change: OrderFilterChange, replace: boolean) {
    const next = withFilter(queryRef.current, change);
    if (change.q !== undefined) applied.current = next.q;
    setParams(writeOrderListQuery(next), { replace });
  }

  function onSearchChange(text: string) {
    setSearchText(text);
    const result = checkOrderSearch(text);
    if (!result.ok || result.value === queryRef.current.q) {
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

  return (
    <OrderListView
      t={t}
      query={query}
      rangeError={request.ok ? null : { field: request.field, reason: request.reason }}
      results={
        request.ok ? (
          <OrderResults query={query} options={request.options} requestKey={queryKey} />
        ) : null
      }
      searchText={searchText}
      searchError={check.ok ? undefined : { key: "order.list.searchTooLong" }}
      onSearchChange={onSearchChange}
      onSearchSubmit={onSearchSubmit}
      onStatusChange={(status) =>
        apply(
          {
            status: (ORDER_STATUS_FILTERS as readonly string[]).includes(status)
              ? (status as OrderListQuery["status"])
              : undefined,
          },
          false,
        )
      }
      onFromChange={(day) => apply({ from: day }, false)}
      onToChange={(day) => apply({ to: day }, false)}
      hrefWithoutCustomer={`${PATHS.orders}${writeOrderListQuery(withFilter(query, { customerId: undefined }))}`}
    />
  );
}
