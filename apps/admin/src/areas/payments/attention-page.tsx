import type { AdminConfig, AdminPaymentPage } from "@fluxkit/api-client";
import { Button, LiveRegion } from "@fluxkit/ui";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { failureFromError } from "../../lib/failure";
import { describeFailure, type MessageDescriptor } from "../../lib/problem-messages";
import { useCrash } from "../../lib/use-crash";
import { useResource } from "../../lib/use-resource";
import { PageHeading, ResourceFallback } from "../../views/status-views";
import { useOrderConfig } from "../orders/order-parts";
import { AttentionMore, AttentionTable } from "./attention-view";
import {
  ATTENTION_PAGE_SIZE,
  appendPage,
  listFromPage,
  type AttentionList,
} from "./attention-list";

/**
 * `/payments`: the payments that need an admin (late or duplicate success, refund failed or unknown, amount mismatch,
 * unknown status, reconcile gave up), newest first, with "load more" over the API's keyset cursor. Read only: each row
 * links to the order, where the payment panel has the actions (check status, refund, close the item).
 */

function AttentionResults({ config, onRefresh }: { config: AdminConfig; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const crash = useCrash();
  const first = useResource(
    (signal) =>
      adminClient.listPayments({ needsAttention: true, limit: ATTENTION_PAGE_SIZE, signal }),
    [],
  );
  const [more, setMore] = useState<AttentionList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MessageDescriptor | null>(null);
  const running = useRef(false);

  if (first.status !== "ready") {
    return <ResourceFallback t={t} state={first} onRetry={first.reload} />;
  }
  const list = more ?? listFromPage(first.data);

  async function loadMore() {
    if (running.current || list.nextCursor === null) return;
    running.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await adminClient.listPayments({
        needsAttention: true,
        limit: ATTENTION_PAGE_SIZE,
        cursor: list.nextCursor,
      });
      if (result.ok) {
        const page: AdminPaymentPage = result.data;
        setMore((current) => appendPage(current ?? list, page));
      } else {
        setError(
          describeFailure({
            kind: "problem",
            status: result.status,
            problem: result.problem,
            retryAfter: result.retryAfter,
          }),
        );
      }
    } catch (thrown) {
      try {
        const failure = failureFromError(thrown);
        if (failure !== null) setError(describeFailure(failure));
      } catch (bug) {
        crash(bug);
      }
    } finally {
      running.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="secondary" onClick={onRefresh}>
          {t("payment.list.refresh")}
        </Button>
      </div>
      <LiveRegion>
        <AttentionTable t={t} uiLocale={locale} money={{ locale, config }} list={list} />
      </LiveRegion>
      <AttentionMore
        t={t}
        count={list.rows.length}
        hasMore={list.nextCursor !== null}
        loading={loading}
        error={error}
        onLoadMore={() => void loadMore()}
      />
    </div>
  );
}

/** `/payments`: the attention list. */
export function PaymentAttentionPage() {
  const { t } = useI18n();
  const config = useOrderConfig();
  // A new generation remounts the results, so a refresh starts again from the first page.
  const [generation, setGeneration] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeading>{t("page.payments.title")}</PageHeading>
      <p className="max-w-prose text-muted-foreground">{t("payment.list.intro")}</p>
      {config.status === "ready" ? (
        <AttentionResults
          key={generation}
          config={config.data}
          onRefresh={() => setGeneration((value) => value + 1)}
        />
      ) : (
        <ResourceFallback t={t} state={config} onRetry={config.reload} />
      )}
    </div>
  );
}
