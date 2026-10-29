import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { PrivacyFrame } from "./privacy-frame";
import {
  readRequestListQuery,
  withStatus,
  writeRequestListQuery,
  type RequestListQuery,
} from "./request-list-query";
import { RequestFilter, RequestResultsView } from "./requests-view";

function RequestResults({ query }: { query: RequestListQuery }) {
  const { t, locale } = useI18n();
  const key = writeRequestListQuery(query);
  const resource = useResource(
    (signal) =>
      adminClient.listPrivacyRequests({
        ...(query.status === undefined ? {} : { status: query.status }),
        limit: query.limit,
        offset: query.offset,
        signal,
      }),
    [key],
  );
  return (
    <RequestResultsView
      t={t}
      uiLocale={locale}
      query={query}
      state={resource}
      onRetry={resource.reload}
      hrefForOffset={(offset) => `${PATHS.privacy}${writeRequestListQuery({ ...query, offset })}`}
    />
  );
}

/** `/privacy`: the privacy requests, open ones first (the API orders them), filter and paging in the URL. */
export function PrivacyRequestsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = readRequestListQuery(params);
  return (
    <PrivacyFrame t={t} current="privacy" title={t("page.privacy.title")}>
      <p className="max-w-prose text-muted-foreground">{t("personal.list.intro")}</p>
      <RequestFilter
        key={writeRequestListQuery(query)}
        t={t}
        query={query}
        onChange={(status) => setParams(writeRequestListQuery(withStatus(query, status)))}
      />
      <RequestResults query={query} />
    </PrivacyFrame>
  );
}
