import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { SEARCH_DEBOUNCE_MS, createDebounce } from "../../lib/debounce";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import {
  checkCustomerSearch,
  listRequest,
  readCustomerListQuery,
  withSearch,
  writeCustomerListQuery,
  type CustomerListQuery,
} from "./customer-list-query";
import { CustomerListView, CustomerResultsView } from "./customer-list-view";

/** One page of customers for a request the API accepts. */
function CustomerResults({ query, requestKey }: { query: CustomerListQuery; requestKey: string }) {
  const { t, locale } = useI18n();
  const resource = useResource(
    (signal) => adminClient.listCustomers({ ...listRequest(query), signal }),
    [requestKey],
  );
  return (
    <CustomerResultsView
      t={t}
      uiLocale={locale}
      query={query}
      state={resource}
      onRetry={resource.reload}
      hrefForOffset={(offset) =>
        `${PATHS.customers}${writeCustomerListQuery({ ...query, offset })}`
      }
    />
  );
}

/** `/customers`: the server-driven customer list; the email search and the paging live in the URL. */
export function CustomerListPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = readCustomerListQuery(params);
  const queryKey = writeCustomerListQuery(query);
  const queryRef = useRef(query);
  queryRef.current = query;

  // The search field: typed text is applied to the URL 300 ms after the last keystroke, if the API would accept it.
  const [searchText, setSearchText] = useState(query.q);
  const [debounce] = useState(() => createDebounce(SEARCH_DEBOUNCE_MS));
  const applied = useRef(query.q);
  useEffect(() => () => debounce.cancel(), [debounce]);
  useEffect(() => {
    // Back and forward changed the URL's search: the field follows.
    if (query.q !== applied.current) {
      applied.current = query.q;
      setSearchText(query.q);
    }
  }, [query.q]);
  const check = checkCustomerSearch(searchText);

  function applySearch(value: string, replace: boolean) {
    applied.current = value;
    setParams(writeCustomerListQuery(withSearch(queryRef.current, value)), { replace });
  }

  function onSearchChange(text: string) {
    setSearchText(text);
    const result = checkCustomerSearch(text);
    if (!result.ok || result.value === queryRef.current.q) {
      debounce.cancel();
      return;
    }
    // Typing replaces the history entry, so Back leaves the list instead of undoing keystrokes.
    debounce.schedule(() => applySearch(result.value, true));
  }

  function onSearchSubmit() {
    debounce.cancel();
    if (check.ok && check.value !== query.q) applySearch(check.value, false);
  }

  return (
    <CustomerListView
      t={t}
      query={query}
      results={<CustomerResults query={query} requestKey={queryKey} />}
      searchText={searchText}
      searchError={check.ok ? undefined : { key: "customer.list.searchTooLong" }}
      onSearchChange={onSearchChange}
      onSearchSubmit={onSearchSubmit}
    />
  );
}
