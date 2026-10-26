import type { AdminListEmailMessagesOptions } from "@fluxkit/api-client";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { browserTimeZone } from "../../lib/date-range";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { EmailFrame } from "./email-frame";
import {
  listRequest,
  readMessageListQuery,
  withFilters,
  writeMessageListQuery,
  type MessageFilters,
  type MessageListQuery,
} from "./message-list-query";
import { MessageResultsView, MessagesScreen } from "./messages-view";

/** One page of mail for a request the API accepts; mounted only when the date range can be sent. */
function MessageResults({
  query,
  options,
  requestKey,
}: {
  query: MessageListQuery;
  options: AdminListEmailMessagesOptions;
  requestKey: string;
}) {
  const { t, locale } = useI18n();
  const resource = useResource(
    (signal) => adminClient.listEmailMessages({ ...options, signal }),
    [requestKey],
  );
  return (
    <MessageResultsView
      t={t}
      uiLocale={locale}
      query={query}
      state={resource}
      onRetry={resource.reload}
      hrefForOffset={(offset) =>
        `${PATHS.emailMessages}${writeMessageListQuery({ ...query, offset })}`
      }
    />
  );
}

/** `/email/messages`: the outbox, server-driven; filters and paging live in the URL. */
export function EmailMessagesPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const query = readMessageListQuery(params);
  const queryKey = writeMessageListQuery(query);
  // The browser's zone (there is no shop time zone setting); read once per screen.
  const [timeZone] = useState(browserTimeZone);
  const request = listRequest(query, timeZone);
  // The template select: the registered keys. A failed read leaves the select with "any" and the current key.
  const templates = useResource((signal) => adminClient.listEmailTemplates({ signal }), []);
  const templateKeys =
    templates.status === "ready" ? templates.data.items.map((item) => item.key) : [];

  function apply(filters: MessageFilters) {
    setParams(writeMessageListQuery(withFilters(query, filters)));
  }

  return (
    <EmailFrame t={t} current="emailMessages" title={t("page.emailMessages.title")}>
      <p className="max-w-prose text-muted-foreground">{t("mail.list.intro")}</p>
      <MessagesScreen
        t={t}
        query={query}
        rangeError={request.ok ? null : { field: request.field, reason: request.reason }}
        templateKeys={templateKeys}
        onApply={apply}
        formKey={queryKey}
        results={
          request.ok ? (
            <MessageResults query={query} options={request.options} requestKey={queryKey} />
          ) : null
        }
      />
    </EmailFrame>
  );
}
