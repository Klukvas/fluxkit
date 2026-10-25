import type { AdminConfig, AdminShippingMethod } from "@fluxkit/api-client";
import {
  DataTable,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
  type Translator,
} from "@fluxkit/ui";
import { Link, useSearchParams } from "react-router";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import { useResource } from "../../lib/use-resource";
import { PATHS } from "../../router/paths";
import { readPaging, writeQuery } from "../../router/query";
import { ResourceFallback, type ResourceFallbackState } from "../../views/status-views";
import { ConfigGate, useAdminConfig } from "../catalog-dictionaries/config-gate";
import { linkClass, primaryLinkClass } from "../catalog-dictionaries/dictionary-frame";
import { ListPager } from "../catalog-dictionaries/list-screen";
import {
  METHOD_STATUS_TONES,
  carrierText,
  kindLabelKey,
  methodHref,
  methodStatusLabelKey,
  methodTitle,
  pricingSummary,
} from "./method-view";
import { ShippingFrame } from "./shipping-frame";
import { useCanManageShipping } from "./shipping-permissions";

export const METHODS_PAGE_SIZE = 50;

export type MethodListState =
  | { status: "loading" }
  | { status: "ready"; data: { items: AdminShippingMethod[]; total: number } }
  | Exclude<ResourceFallbackState, { status: "ready" | "loading" }>;

export interface MethodsViewProps {
  t: Translator;
  uiLocale: string;
  defaultLocale: string;
  config: AdminConfig;
  canManage: boolean;
  state: MethodListState;
  onRetry: () => void;
  limit: number;
  offset: number;
  hrefForOffset: (offset: number) => string;
}

/** The delivery methods: loading rows, the failure with a retry, an empty state, or the table (status, kind, carrier, price) and its pager. */
export function MethodsView({
  t,
  uiLocale,
  defaultLocale,
  config,
  canManage,
  state,
  onRetry,
  limit,
  offset,
  hrefForOffset,
}: MethodsViewProps) {
  const columns: DataTableColumn<AdminShippingMethod>[] = [
    {
      id: "code",
      header: t("ship.list.columnCode"),
      cell: (row) => (
        <Link to={methodHref(row.id)} className={`${linkClass} break-all`}>
          {row.code}
        </Link>
      ),
    },
    {
      id: "title",
      header: t("ship.list.columnTitle"),
      cell: (row) => (
        <span className="break-words">{methodTitle(row, uiLocale, defaultLocale)}</span>
      ),
    },
    { id: "kind", header: t("ship.list.columnKind"), cell: (row) => t(kindLabelKey(row.kind)) },
    {
      id: "carrier",
      header: t("ship.list.columnCarrier"),
      cell: (row) => {
        const text = carrierText(row);
        return text === null ? (
          <span className="text-muted-foreground">{t("ship.list.noCarrier")}</span>
        ) : (
          <span className="break-all">{text}</span>
        );
      },
    },
    {
      id: "price",
      header: t("ship.list.columnPrice"),
      cell: (row) => pricingSummary(t, row.pricing, row.currency, config, uiLocale),
    },
    {
      id: "status",
      header: t("ship.list.columnStatus"),
      cell: (row) => (
        <StatusBadge
          tone={METHOD_STATUS_TONES[row.isActive ? "active" : "inactive"]}
          label={t(methodStatusLabelKey(row.isActive))}
        />
      ),
    },
  ];
  const caption = t("ship.list.caption");
  if (state.status === "loading") {
    return (
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        emptyMessage={null}
        loading
        loadingLabel={t("status.loading")}
      />
    );
  }
  if (state.status !== "ready") return <ResourceFallback t={t} state={state} onRetry={onRetry} />;
  if (state.data.items.length === 0) {
    if (offset > 0) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">{t("dict.list.pastEnd")}</p>
          <Link to={hrefForOffset(0)} className={linkClass}>
            {t("dict.list.firstPage")}
          </Link>
        </div>
      );
    }
    return (
      <EmptyState
        title={t("ship.list.emptyTitle")}
        description={t("ship.list.emptyBody")}
        action={
          canManage ? (
            <Link to={PATHS.shippingMethodNew} className={primaryLinkClass}>
              {t("ship.list.create")}
            </Link>
          ) : undefined
        }
      />
    );
  }
  return (
    <>
      <DataTable
        caption={caption}
        captionHidden
        columns={columns}
        rows={state.data.items}
        rowKey={(row) => row.id}
        emptyMessage={null}
      />
      <ListPager
        t={t}
        total={state.data.total}
        limit={limit}
        offset={offset}
        count={state.data.items.length}
        hrefForOffset={hrefForOffset}
      />
    </>
  );
}

function MethodsList() {
  const { t, locale } = useI18n();
  const config = useAdminConfig();
  const canManage = useCanManageShipping();
  const [params] = useSearchParams();
  const { limit, offset } = readPaging(params, { defaultLimit: METHODS_PAGE_SIZE });
  const resource = useResource(
    (signal) => adminClient.listShippingMethods({ limit, offset, signal }),
    [limit, offset],
  );
  return (
    <ShippingFrame
      t={t}
      current="shipping"
      title={t("page.shipping.title")}
      actions={
        canManage ? (
          <Link to={PATHS.shippingMethodNew} className={primaryLinkClass}>
            {t("ship.list.create")}
          </Link>
        ) : null
      }
    >
      <p className="max-w-prose text-muted-foreground">{t("ship.list.intro")}</p>
      <MethodsView
        t={t}
        uiLocale={locale}
        defaultLocale={config.defaultLocale}
        config={config}
        canManage={canManage}
        state={resource}
        onRetry={resource.reload}
        limit={limit}
        offset={offset}
        hrefForOffset={(next) =>
          `${PATHS.shipping}${writeQuery({ limit, offset: next }, { limit: METHODS_PAGE_SIZE, offset: 0 })}`
        }
      />
    </ShippingFrame>
  );
}

/** `/shipping`: the delivery methods (server-driven list; the paging lives in the URL). */
export function ShippingPage() {
  return (
    <ConfigGate>
      <MethodsList />
    </ConfigGate>
  );
}
