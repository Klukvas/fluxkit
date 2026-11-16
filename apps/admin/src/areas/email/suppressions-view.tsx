import type { AdminEmailSuppression, AdminEmailSuppressionList } from "@fluxkit/api-client";
import { Button, DataTable, EmptyState, type DataTableColumn, type Translator } from "@fluxkit/ui";
import { Link } from "react-router";
import { useState } from "react";
import { formatDateTime } from "../../lib/format";
import type { ResourceState } from "../../lib/use-resource";
import { standaloneLinkClass } from "../../views/links";
import { ResourceFallback } from "../../views/status-views";
import { MessagePager } from "./messages-view";

export const SUPPRESSION_REASONS = ["hard_bounce", "complaint", "unsubscribe", "blocked"] as const;

export type SuppressionsState = Exclude<
  ResourceState<AdminEmailSuppressionList>,
  { status: "crashed" }
>;

/** email.manage exposes full recipients like messages; each row stays masked until shown. */
export function SuppressionsView({
  t,
  uiLocale,
  state,
  limit,
  offset,
  canManage,
  busy,
  onRetry,
  onRemove,
  hrefForOffset,
}: {
  t: Translator;
  uiLocale: string;
  state: SuppressionsState;
  limit: number;
  offset: number;
  canManage: boolean;
  busy: boolean;
  onRetry: () => void;
  onRemove: (entry: AdminEmailSuppression) => void;
  hrefForOffset: (offset: number) => string;
}) {
  const columns: DataTableColumn<AdminEmailSuppression>[] = [
    {
      id: "recipient",
      header: t("mail.suppressions.recipient"),
      cell: (row) => <SuppressionRecipient key={row.id} entry={row} t={t} />,
    },
    {
      id: "reason",
      header: t("mail.suppressions.reason"),
      cell: (row) => t(`mail.suppressions.reason.${row.reason}`),
    },
    { id: "source", header: t("mail.suppressions.source"), cell: (row) => row.sourceProvider },
    {
      id: "first",
      header: t("mail.suppressions.firstSeen"),
      cell: (row) => (
        <span className="tabular-nums">{formatDateTime(row.firstSeenAt, uiLocale)}</span>
      ),
    },
    {
      id: "last",
      header: t("mail.suppressions.lastSeen"),
      cell: (row) => (
        <span className="tabular-nums">{formatDateTime(row.lastSeenAt, uiLocale)}</span>
      ),
    },
  ];
  if (state.status !== "loading" && state.status !== "ready") {
    return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  }
  if (state.status === "ready" && state.data.items.length === 0) {
    return offset > 0 ? (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground">{t("mail.list.pastEnd")}</p>
        <Link to={hrefForOffset(0)} className={standaloneLinkClass}>
          {t("mail.list.firstPage")}
        </Link>
      </div>
    ) : (
      <EmptyState
        title={t("mail.suppressions.emptyTitle")}
        description={t("mail.suppressions.emptyBody")}
      />
    );
  }
  return (
    <>
      <DataTable
        caption={t("mail.suppressions.caption")}
        captionHidden
        columns={columns}
        rows={state.status === "ready" ? state.data.items : []}
        rowKey={(row) => row.id}
        emptyMessage={null}
        loading={state.status === "loading"}
        loadingLabel={t("status.loading")}
        actions={
          canManage
            ? {
                header: t("mail.suppressions.actions"),
                render: (row) => (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={t("mail.suppressions.removeLabel", {
                      address: row.toAddressMasked,
                    })}
                    onClick={() => onRemove(row)}
                  >
                    {t("mail.suppressions.remove")}
                  </Button>
                ),
              }
            : undefined
        }
      />
      {state.status === "ready" ? (
        <MessagePager
          t={t}
          total={state.data.total}
          limit={limit}
          offset={offset}
          count={state.data.items.length}
          hrefForOffset={hrefForOffset}
        />
      ) : null}
    </>
  );
}

function SuppressionRecipient({ entry, t }: { entry: AdminEmailSuppression; t: Translator }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <span className="break-all">{shown ? entry.toAddress : entry.toAddressMasked}</span>
      <Button
        variant="secondary"
        aria-pressed={shown}
        aria-label={t(shown ? "mail.suppressions.hideLabel" : "mail.suppressions.showLabel", {
          address: entry.toAddressMasked,
        })}
        onClick={() => setShown((current) => !current)}
      >
        {t(shown ? "mail.suppressions.hide" : "mail.suppressions.show")}
      </Button>
    </div>
  );
}
