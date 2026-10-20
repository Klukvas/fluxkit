import type {
  AdminLocation,
  AdminProduct,
  AdminProductInventory,
  AdminReservation,
  AdminResult,
  AdminStockMovement,
  AdminVariant,
  AdminVariantInventory,
  AdminReservationList,
  ReservationStatus,
} from "@fluxkit/api-client";
import {
  Alert,
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  LiveRegion,
  Select,
  StatusBadge,
  type Translator,
} from "@fluxkit/ui";
import { useCallback, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { Link } from "react-router";
import { useI18n } from "../../../i18n/i18n-context";
import { adminClient } from "../../../lib/api";
import { formatDateTime } from "../../../lib/format";
import type { MessageDescriptor } from "../../../lib/problem-messages";
import { runWrite } from "../../../lib/run-write";
import { createSingleFlight } from "../../../lib/single-flight";
import { useRefreshingResource } from "../../../lib/use-refreshing-resource";
import { useResource } from "../../../lib/use-resource";
import { PATHS } from "../../../router/paths";
import { useUnsavedChangesGuard } from "../../../router/unsaved-changes";
import { UnsavedChangesDialog } from "../../../router/unsaved-changes-dialog";
import { useSession } from "../../../session/session-context";
import { FailureMessage, ResourceFallback } from "../../../views/status-views";
import { useAdminConfig } from "../../catalog-dictionaries/config-gate";
import {
  FormErrorSummary,
  TextField,
  UnknownResultNotice,
  describe,
} from "../../catalog-dictionaries/form-parts";
import { useFormSubmit } from "../../catalog-dictionaries/use-form-submit";
import { stockVariantFocusId } from "../field-ids";
import { useReportDirty, type ProductTabProps } from "../tab-props";
import { optionValuesText, type VariantNaming } from "../tabs/variants-tab";
import { useOptionDefinitions } from "../use-option-definitions";
import {
  ADJUSTMENT_KINDS,
  REASON_MAX_LENGTH,
  REFERENCE_MAX_LENGTH,
  adjustmentErrorsFromProblem,
  modesFor,
  newAdjustmentValues,
  planAdjustment,
  withKind,
  type AdjustmentPlan,
  type AdjustmentValues,
} from "./stock-adjustment";
import { runAdjustment, stockSections } from "./stock-access";
import {
  STOCK_STATE_TONE,
  actorLabel,
  adjustmentCheck,
  levelAt,
  levelTotals,
  stockState,
  type ActorLabel,
  type AdjustmentCheck,
} from "./stock-view";

/** Journal and reservation pages: small, the newest first. */
export const STOCK_PAGE_SIZE = 20;
/** The users list is read only for owners (`users.manage`): at most this many pages of 100 (owner answer 11). */
const MAX_USER_PAGES = 10;
const USERS_PAGE_SIZE = 100;

export const RESERVATION_STATUSES: readonly ReservationStatus[] = [
  "active",
  "committed",
  "released",
  "expired",
];

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function quantity(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function signed(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value);
}

export function actorText(t: Translator, label: ActorLabel): string {
  switch (label.kind) {
    case "you":
      return t("products.stock.actor.you");
    case "email":
      return label.email;
    case "other":
      return t("products.stock.actor.another", { id: label.shortId });
    case "system":
      return t("products.stock.actor.system");
  }
}

function locationLabel(
  locations: readonly AdminLocation[],
  locationId: string,
  code: string,
): string {
  const found = locations.find((location) => location.id === locationId);
  return found === undefined ? code : `${found.name} (${found.code})`;
}

// ------------------------------------------------------------------ views (props in, markup out)

export interface StockSummaryViewProps {
  t: Translator;
  uiLocale: string;
  naming: VariantNaming;
  product: AdminProduct;
  inventory: ReadonlyMap<string, AdminVariantInventory>;
  lowStockThreshold: number;
  selected: string | null;
  busy: boolean;
  onSelect: (variantId: string) => void;
}

/** Every variant's stock in one table (one product-level read): state as text and tone, on hand, reserved, available. */
export function StockSummaryView({
  t,
  uiLocale,
  naming,
  product,
  inventory,
  lowStockThreshold,
  selected,
  busy,
  onSelect,
}: StockSummaryViewProps) {
  return (
    <DataTable
      caption={t("products.stock.caption", { count: product.variants.length })}
      columns={[
        {
          id: "sku",
          header: t("products.stock.columnVariant"),
          cell: (variant: AdminVariant) => (
            <span className="flex flex-col gap-1">
              <span className="font-medium">{variant.sku}</span>
              {variant.optionValues.length === 0 ? null : (
                <span className="text-sm text-muted-foreground">
                  {optionValuesText(naming, variant)}
                </span>
              )}
            </span>
          ),
        },
        {
          id: "state",
          header: t("products.stock.columnState"),
          cell: (variant: AdminVariant) => {
            const stock = inventory.get(variant.id);
            if (stock === undefined) return null;
            const state = stockState(stock, lowStockThreshold);
            return (
              <StatusBadge
                tone={STOCK_STATE_TONE[state]}
                label={t(`products.stock.state.${state}`)}
              />
            );
          },
        },
        ...(["onHand", "reserved", "available"] as const).map((column) => ({
          id: column,
          header: t(`products.stock.column.${column}`),
          align: "end" as const,
          cell: (variant: AdminVariant) => {
            const stock = inventory.get(variant.id);
            return stock === undefined ? "" : quantity(levelTotals(stock)[column], uiLocale);
          },
        })),
      ]}
      rows={product.variants}
      rowKey={(variant) => variant.id}
      rowHeaderColumnId="sku"
      emptyMessage={t("products.variants.none")}
      actions={{
        header: t("products.stock.columnActions"),
        render: (variant) => (
          <Button
            variant={selected === variant.id ? "primary" : "secondary"}
            disabled={busy || selected === variant.id}
            aria-label={t("products.stock.openLabel", { sku: variant.sku })}
            onClick={() => onSelect(variant.id)}
          >
            {t(selected === variant.id ? "products.stock.opened" : "products.stock.open")}
          </Button>
        ),
      }}
    />
  );
}

/** The levels of one variant per location (only locations with a level row; the first change creates one). */
export function LevelsView({
  t,
  uiLocale,
  sku,
  locations,
  stock,
}: {
  t: Translator;
  uiLocale: string;
  sku: string;
  locations: readonly AdminLocation[];
  stock: AdminVariantInventory | undefined;
}) {
  const levels = stock?.levels ?? [];
  return (
    <DataTable
      caption={t("products.stock.levelsCaption", { sku })}
      columns={[
        {
          id: "location",
          header: t("products.stock.columnLocation"),
          cell: (level: (typeof levels)[number]) =>
            locationLabel(locations, level.locationId, level.locationCode),
        },
        ...(["onHand", "reserved", "available"] as const).map((column) => ({
          id: column,
          header: t(`products.stock.column.${column}`),
          align: "end" as const,
          cell: (level: (typeof levels)[number]) => quantity(level[column], uiLocale),
        })),
      ]}
      rows={levels}
      rowKey={(level) => level.locationId}
      rowHeaderColumnId="location"
      emptyMessage={t("products.stock.noLevels")}
    />
  );
}

export interface AdjustmentFormViewProps {
  t: Translator;
  uiLocale: string;
  sku: string;
  values: AdjustmentValues;
  locations: readonly AdminLocation[];
  current: { onHand: number; reserved: number };
  issues: Partial<Record<string, MessageDescriptor>>;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  /** The newest movement is being read: sending waits for it (a lost answer is judged against it). */
  waiting?: boolean;
  onChange: (next: AdjustmentValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

/**
 * One adjustment: kind (the API's three), a change or (for a correction) the counted quantity, the location (a picker only
 * when there is more than one), reason and reference. The current level at the chosen location is shown next to it, so a
 * refusal such as `below_reserved` has its numbers in view.
 */
export function AdjustmentFormView({
  t,
  uiLocale,
  sku,
  values,
  locations,
  current,
  issues,
  summary,
  summaryRef,
  busy,
  waiting = false,
  onChange,
  onSubmit,
}: AdjustmentFormViewProps) {
  const modes = modesFor(values.kind);
  const quantityError = issues["quantity"];
  return (
    <section aria-labelledby="product-stock-adjust" className="flex flex-col gap-4">
      <h3 id="product-stock-adjust" className="text-lg font-semibold">
        {t("products.stock.adjustTitle", { sku })}
      </h3>
      <form method="post" onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-4" noValidate>
        <FormErrorSummary t={t} summary={summary} summaryRef={summaryRef} />
        <Field
          id="stock-kind"
          label={t("products.stock.kind")}
          hint={t(`products.stock.kindHint.${values.kind}`)}
        >
          {(control) => (
            <Select
              {...control}
              name="kind"
              value={values.kind}
              disabled={busy}
              onChange={(event) => {
                const kind = ADJUSTMENT_KINDS.find((entry) => entry === event.target.value);
                if (kind !== undefined) onChange(withKind(values, kind));
              }}
            >
              {ADJUSTMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`products.stock.kindLabel.${kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {modes.length > 1 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t("products.stock.mode")}</legend>
            {modes.map((mode) => (
              <label key={mode} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="stock-mode"
                  value={mode}
                  checked={values.mode === mode}
                  disabled={busy}
                  className={focusClass}
                  onChange={() => onChange({ ...values, mode })}
                />
                {t(`products.stock.modeLabel.${mode}`)}
              </label>
            ))}
          </fieldset>
        ) : null}
        {locations.length > 1 ? (
          <Field
            id="stock-location"
            label={t("products.stock.location")}
            error={
              issues["locationId"] === undefined ? undefined : describe(t, issues["locationId"])
            }
          >
            {(control) => (
              <Select
                {...control}
                name="locationId"
                value={values.locationId}
                disabled={busy}
                onChange={(event) => onChange({ ...values, locationId: event.target.value })}
              >
                <option value="">{t("products.stock.chooseLocation")}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {locationLabel(locations, location.id, location.code)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {t("products.stock.currentLevel", {
            onHand: quantity(current.onHand, uiLocale),
            reserved: quantity(current.reserved, uiLocale),
          })}
        </p>
        <TextField
          t={t}
          id="stock-quantity"
          name="quantity"
          label={t(
            values.mode === "setOnHand"
              ? "products.stock.countedQuantity"
              : values.kind === "adjustment"
                ? "products.stock.change"
                : "products.stock.addedQuantity",
          )}
          hint={t(
            values.mode === "setOnHand"
              ? "products.stock.countedHint"
              : values.kind === "adjustment"
                ? "products.stock.changeHint"
                : "products.stock.addedHint",
          )}
          value={values.quantity}
          inputMode={values.kind === "adjustment" && values.mode === "delta" ? "text" : "numeric"}
          maxLength={16}
          required
          readOnly={busy}
          error={quantityError}
          onChange={(text) => onChange({ ...values, quantity: text })}
        />
        <TextField
          t={t}
          id="stock-reason"
          name="reason"
          label={t("products.stock.reason")}
          hint={t("products.stock.reasonHint", { max: REASON_MAX_LENGTH })}
          value={values.reason}
          maxLength={REASON_MAX_LENGTH}
          readOnly={busy}
          error={issues["reason"]}
          onChange={(reason) => onChange({ ...values, reason })}
        />
        <TextField
          t={t}
          id="stock-reference"
          name="reference"
          label={t("products.stock.reference")}
          hint={t("products.stock.referenceHint", { max: REFERENCE_MAX_LENGTH })}
          value={values.reference}
          maxLength={REFERENCE_MAX_LENGTH}
          readOnly={busy}
          error={issues["reference"]}
          onChange={(reference) => onChange({ ...values, reference })}
        />
        <div>
          <Button type="submit" disabled={busy || waiting} aria-busy={busy || undefined}>
            {busy ? t("products.stock.sending") : t("products.stock.send")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The confirmation of a change that lowers stock or replaces it with a counted quantity. */
export function adjustmentConfirmation(
  t: Translator,
  uiLocale: string,
  plan: Extract<AdjustmentPlan, { ok: true }>,
  sku: string,
  location: string,
): { title: string; description: string } {
  const values = {
    sku,
    location,
    before: quantity(plan.change.before, uiLocale),
    after: quantity(plan.change.after, uiLocale),
    delta: signed(plan.change.delta, uiLocale),
  };
  return plan.confirm === "set"
    ? {
        title: t("products.stock.confirmSetTitle", values),
        description: t("products.stock.confirmSetBody", values),
      }
    : {
        title: t("products.stock.confirmLowerTitle", values),
        description: t("products.stock.confirmLowerBody", values),
      };
}

export interface MovementRow {
  movement: AdminStockMovement;
  actor: ActorLabel;
}

function movementSummary(t: Translator, uiLocale: string, row: MovementRow): string {
  return t("products.stock.movementLine", {
    kind: t(`products.stock.kindLabel.${row.movement.kind}`),
    delta: signed(row.movement.delta, uiLocale),
    after: quantity(row.movement.onHandAfter, uiLocale),
    location: row.movement.locationCode,
    when: formatDateTime(row.movement.createdAt, uiLocale),
    actor: actorText(t, row.actor),
  });
}

/**
 * What happened to the last adjustment, from the server only: its answer, or, when there was none, what the reloaded
 * journal shows (a new movement by you, by someone else, or none). Never a value computed before the answer.
 */
export function AdjustmentResultView({
  t,
  uiLocale,
  result,
}: {
  t: Translator;
  uiLocale: string;
  result: AdjustmentResult | null;
}) {
  return (
    <LiveRegion>
      {result === null ? null : result.kind === "ok" ? (
        <Alert variant="success" title={t("products.stock.result.okTitle")}>
          <p>{movementSummary(t, uiLocale, result.row)}</p>
        </Alert>
      ) : result.kind === "refused" ? (
        <Alert variant="warning" title={t("products.stock.result.refusedTitle")}>
          <p>{t("products.stock.result.refusedBody")}</p>
        </Alert>
      ) : (
        <UnknownResultNotice t={t}>
          <p className="mt-2">{t(`products.stock.result.${result.check}`)}</p>
          {result.latest === null ? null : (
            <p className="mt-2 font-medium">
              {t("products.stock.lastMovement", {
                line: movementSummary(t, uiLocale, result.latest),
              })}
            </p>
          )}
        </UnknownResultNotice>
      )}
    </LiveRegion>
  );
}

/** The newest movement of the variant (a read of one), shown under the form so the admin sees what the server holds. */
export function LastMovementView({
  t,
  uiLocale,
  last,
}: {
  t: Translator;
  uiLocale: string;
  last: MovementRow | null | "loading";
}) {
  if (last === "loading") return null;
  return (
    <p className="text-sm">
      {last === null
        ? t("products.stock.noMovements")
        : t("products.stock.lastMovement", { line: movementSummary(t, uiLocale, last) })}
    </p>
  );
}

function Pager({
  t,
  label,
  offset,
  total,
  count,
  busy,
  onOffset,
}: {
  t: Translator;
  label: string;
  offset: number;
  total: number;
  count: number;
  busy: boolean;
  onOffset: (offset: number) => void;
}) {
  if (total <= STOCK_PAGE_SIZE && offset === 0) return null;
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        disabled={busy || offset === 0}
        onClick={() => onOffset(Math.max(0, offset - STOCK_PAGE_SIZE))}
      >
        {t("products.stock.newer")}
      </Button>
      <span className="text-sm text-muted-foreground">
        {t("products.stock.pageRange", {
          from: count === 0 ? 0 : offset + 1,
          to: offset + count,
          total,
        })}
      </span>
      <Button
        variant="secondary"
        disabled={busy || offset + count >= total}
        onClick={() => onOffset(offset + STOCK_PAGE_SIZE)}
      >
        {t("products.stock.older")}
      </Button>
    </nav>
  );
}

/** The stock journal of one variant, newest first, paged (20 a page). */
export function JournalView({
  t,
  uiLocale,
  sku,
  rows,
  offset,
  total,
  busy,
  onOffset,
}: {
  t: Translator;
  uiLocale: string;
  sku: string;
  rows: readonly MovementRow[];
  offset: number;
  total: number;
  busy: boolean;
  onOffset: (offset: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={t("products.stock.journalCaption", { sku })}
        columns={[
          {
            id: "when",
            header: t("products.stock.columnWhen"),
            cell: (row: MovementRow) => formatDateTime(row.movement.createdAt, uiLocale),
          },
          {
            id: "kind",
            header: t("products.stock.columnKind"),
            cell: (row: MovementRow) => t(`products.stock.kindLabel.${row.movement.kind}`),
          },
          {
            id: "delta",
            header: t("products.stock.columnDelta"),
            align: "end",
            cell: (row: MovementRow) => signed(row.movement.delta, uiLocale),
          },
          {
            id: "after",
            header: t("products.stock.columnAfter"),
            align: "end",
            cell: (row: MovementRow) => quantity(row.movement.onHandAfter, uiLocale),
          },
          {
            id: "location",
            header: t("products.stock.columnLocation"),
            cell: (row: MovementRow) => row.movement.locationCode,
          },
          {
            id: "reason",
            header: t("products.stock.columnReason"),
            cell: (row: MovementRow) => (
              <span className="flex flex-col gap-1">
                {row.movement.reason === null ? null : <span>{row.movement.reason}</span>}
                {row.movement.reference === null ? null : (
                  <span className="text-sm text-muted-foreground">
                    {t("products.stock.referenceValue", { reference: row.movement.reference })}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: "actor",
            header: t("products.stock.columnActor"),
            cell: (row: MovementRow) => actorText(t, row.actor),
          },
        ]}
        rows={rows}
        rowKey={(row) => row.movement.id}
        rowHeaderColumnId="when"
        emptyMessage={t("products.stock.noMovements")}
      />
      <Pager
        t={t}
        label={t("products.stock.journalPages")}
        offset={offset}
        total={total}
        count={rows.length}
        busy={busy}
        onOffset={onOffset}
      />
    </div>
  );
}

/** The link of a reservation's order: the order list searched by its number (`q`), or the id when no number is known. */
export function reservationOrderLink(reservation: AdminReservation): string | null {
  const search = reservation.reference ?? reservation.orderId;
  if (search === null) return null;
  return `${PATHS.orders}?q=${encodeURIComponent(search)}`;
}

/** The reservations of one variant in one status (needs `orders.read`), newest first, paged; links to the orders. */
export function ReservationsView({
  t,
  uiLocale,
  sku,
  status,
  rows,
  offset,
  total,
  busy,
  onStatus,
  onOffset,
}: {
  t: Translator;
  uiLocale: string;
  sku: string;
  status: ReservationStatus;
  rows: readonly AdminReservation[];
  offset: number;
  total: number;
  busy: boolean;
  onStatus: (status: ReservationStatus) => void;
  onOffset: (offset: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field id="stock-reservation-status" label={t("products.stock.reservationStatus")}>
        {(control) => (
          <Select
            {...control}
            value={status}
            disabled={busy}
            onChange={(event) => {
              const next = RESERVATION_STATUSES.find((entry) => entry === event.target.value);
              if (next !== undefined) onStatus(next);
            }}
          >
            {RESERVATION_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {t(`products.stock.reservation.${entry}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <DataTable
        caption={t("products.stock.reservationsCaption", { sku })}
        columns={[
          {
            id: "order",
            header: t("products.stock.columnOrder"),
            cell: (row: AdminReservation) => {
              const to = reservationOrderLink(row);
              const text =
                row.reference ??
                (row.orderId === null ? t("products.stock.noOrder") : row.orderId.slice(0, 8));
              return to === null ? (
                text
              ) : (
                <Link to={to} className="font-medium underline underline-offset-4">
                  {text}
                </Link>
              );
            },
          },
          {
            id: "quantity",
            header: t("products.stock.columnQuantity"),
            align: "end",
            cell: (row: AdminReservation) => quantity(row.quantity, uiLocale),
          },
          {
            id: "location",
            header: t("products.stock.columnLocation"),
            cell: (row: AdminReservation) => row.locationCode,
          },
          {
            id: "expires",
            header: t("products.stock.columnExpires"),
            cell: (row: AdminReservation) => formatDateTime(row.expiresAt, uiLocale),
          },
          {
            id: "created",
            header: t("products.stock.columnCreated"),
            cell: (row: AdminReservation) => formatDateTime(row.createdAt, uiLocale),
          },
        ]}
        rows={rows}
        rowKey={(row) =>
          `${row.createdAt}-${row.orderId ?? ""}-${row.reference ?? ""}-${row.locationCode}`
        }
        rowHeaderColumnId="order"
        emptyMessage={t(`products.stock.noReservations.${status}`)}
      />
      <Pager
        t={t}
        label={t("products.stock.reservationPages")}
        offset={offset}
        total={total}
        count={rows.length}
        busy={busy}
        onOffset={onOffset}
      />
    </div>
  );
}

// ------------------------------------------------------------------ data and writes

/** How the last adjustment ended; the numbers always come from the server. */
export type AdjustmentResult =
  | { kind: "ok"; row: MovementRow }
  | { kind: "refused" }
  | { kind: "unknown"; check: AdjustmentCheck | "unreadable"; latest: MovementRow | null };

/** The emails of the admin users, only for a session that may read them (owners); `null` otherwise (no request). */
function useAdminEmails(enabled: boolean): ReadonlyMap<string, string> | null {
  const users = useResource(
    async (signal): Promise<AdminResult<ReadonlyMap<string, string> | null>> => {
      if (!enabled) return { ok: true, status: 200, data: null };
      const emails = new Map<string, string>();
      for (let page = 0; page < MAX_USER_PAGES; page += 1) {
        const result = await adminClient.listUsers({
          limit: USERS_PAGE_SIZE,
          offset: page * USERS_PAGE_SIZE,
          signal,
        });
        if (!result.ok) return result;
        for (const user of result.data.items) emails.set(user.id, user.email);
        if (emails.size >= result.data.total || result.data.items.length === 0) break;
      }
      return { ok: true, status: 200, data: emails };
    },
    [enabled],
  );
  return users.status === "ready" ? users.data : null;
}

interface StockData {
  locations: AdminLocation[];
  inventory: AdminProductInventory;
}

async function loadStock(productId: string, signal: AbortSignal): Promise<AdminResult<StockData>> {
  const [locations, inventory] = await Promise.all([
    adminClient.listLocations({ signal }),
    adminClient.getProductInventory(productId, { signal }),
  ]);
  if (!locations.ok) return locations;
  if (!inventory.ok) return inventory;
  return {
    ok: true,
    status: 200,
    data: { locations: locations.data.items, inventory: inventory.data },
  };
}

/** One variant's stock: levels, the adjustment form (writers), the last movement, the journal and the reservations. */
function VariantStock({
  product,
  variant,
  locations,
  stock,
  meId,
  emails,
  onReloadLevels,
  onDirtyChange,
  onBusyChange,
}: {
  product: AdminProduct;
  variant: AdminVariant;
  locations: readonly AdminLocation[];
  stock: AdminVariantInventory | undefined;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
  onReloadLevels: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const session = useSession();
  const sections = stockSections(session.state.me?.permissions ?? null);
  const canAdjust = sections.adjust;
  const canReservations = sections.reservations;
  const defaultLocation = locations.find((location) => location.isDefault) ?? locations[0];
  const initial = useMemo(
    () => newAdjustmentValues(defaultLocation?.id ?? ""),
    [defaultLocation?.id],
  );
  const [values, setValues] = useState(initial);
  const [confirming, setConfirming] = useState<Extract<AdjustmentPlan, { ok: true }> | null>(null);
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [journalOffset, setJournalOffset] = useState(0);
  const [journalRevision, setJournalRevision] = useState(0);
  const [reservationStatus, setReservationStatus] = useState<ReservationStatus>("active");
  const [reservationOffset, setReservationOffset] = useState(0);
  const flight = useRef(createSingleFlight());
  const resultRef = useRef<HTMLDivElement>(null);
  const form = useFormSubmit(["quantity", "locationId", "reason", "reference"], (problem, status) =>
    adjustmentErrorsFromProblem(problem, status),
  );
  const busy = form.state.busy;
  const dirty =
    (values.quantity !== initial.quantity ||
      values.reason !== initial.reason ||
      values.reference !== initial.reference) &&
    !busy;
  const blocker = useUnsavedChangesGuard(dirty);
  useReportDirty(dirty, onDirtyChange);

  const last = useResource(
    (signal) =>
      adminClient.listStockMovements(product.id, variant.id, { limit: 1, offset: 0, signal }),
    [product.id, variant.id, journalRevision],
  );
  const journal = useRefreshingResource(
    (signal) =>
      adminClient.listStockMovements(product.id, variant.id, {
        limit: STOCK_PAGE_SIZE,
        offset: journalOffset,
        signal,
      }),
    [product.id, variant.id, journalOffset, journalRevision],
  );
  const reservations = useRefreshingResource(
    async (signal): Promise<AdminResult<AdminReservationList | null>> =>
      canReservations
        ? adminClient.listReservations(product.id, variant.id, {
            status: reservationStatus,
            limit: STOCK_PAGE_SIZE,
            offset: reservationOffset,
            signal,
          })
        : { ok: true, status: 200, data: null },
    [
      product.id,
      variant.id,
      canReservations,
      reservationStatus,
      reservationOffset,
      journalRevision,
    ],
  );

  const top = last.status === "ready" ? (last.data.items[0] ?? null) : null;
  const lastRow: MovementRow | null | "loading" =
    last.status !== "ready"
      ? "loading"
      : top === null
        ? null
        : { movement: top, actor: actorLabel(top.actorId, meId, emails) };
  // The form waits for the newest movement: a lost answer is judged against it.
  const waiting = last.status !== "ready";

  const current = levelAt(stock, values.locationId);
  const locationText = (id: string) =>
    locationLabel(locations, id, locations.find((location) => location.id === id)?.code ?? "");

  function reloadAll() {
    // Every answer (accepted, refused or lost) reloads the levels, the newest movement and the journal's first page.
    onReloadLevels();
    setJournalOffset(0);
    setJournalRevision((revision) => revision + 1);
  }

  async function send(plan: Extract<AdjustmentPlan, { ok: true }>) {
    const previousTopId = top?.id ?? null;
    onBusyChange(true);
    const outcome = await runAdjustment(
      form.submit,
      () => adminClient.adjustInventory(product.id, variant.id, plan.body),
      reloadAll,
    );
    onBusyChange(false);
    setConfirming(null);
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "ok") {
      setResult({
        kind: "ok",
        row: {
          movement: outcome.data.movement,
          actor: actorLabel(outcome.data.movement.actorId, meId, emails),
        },
      });
      setValues(initial);
    } else if (outcome.kind === "problem") {
      setResult({ kind: "refused" });
    } else {
      setResult(await checkJournal(previousTopId));
    }
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  /**
   * After a lost answer: one read of the newest movement (never a retry of the write) tells whether a movement by this
   * admin appeared since the one seen before sending.
   */
  async function checkJournal(previousTopId: string | null): Promise<AdjustmentResult> {
    const read = await runWrite(() =>
      adminClient.listStockMovements(product.id, variant.id, { limit: 1, offset: 0 }),
    );
    if (read.kind !== "ok") return { kind: "unknown", check: "unreadable", latest: null };
    const newest = read.data.items[0] ?? null;
    return {
      kind: "unknown",
      check: adjustmentCheck(previousTopId, newest, meId),
      latest:
        newest === null
          ? null
          : { movement: newest, actor: actorLabel(newest.actorId, meId, emails) },
    };
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flight.current.pending() || busy || waiting) return;
    const plan = planAdjustment(values, current, { locationCount: locations.length });
    if (!plan.ok) {
      const issues: Partial<Record<string, MessageDescriptor>> = {};
      for (const [field, issue] of Object.entries(plan.issues)) {
        issues[field] = { key: `products.stock.issue.${issue}` };
      }
      form.showIssues(issues);
      return;
    }
    setResult(null);
    if (plan.confirm !== null) {
      setConfirming(plan);
      return;
    }
    void flight.current.run(() => send(plan));
  }

  const journalRows: MovementRow[] =
    journal.data?.items.map((movement) => ({
      movement,
      actor: actorLabel(movement.actorId, meId, emails),
    })) ?? [];
  const confirmation =
    confirming === null
      ? null
      : adjustmentConfirmation(t, locale, confirming, variant.sku, locationText(values.locationId));

  return (
    <section
      id={stockVariantFocusId(variant.id)}
      tabIndex={-1}
      aria-labelledby={`${stockVariantFocusId(variant.id)}-heading`}
      className={`flex flex-col gap-6 rounded-md border border-border p-4 ${focusClass}`}
    >
      <h2 id={`${stockVariantFocusId(variant.id)}-heading`} className="text-lg font-semibold">
        {t("products.stock.variantTitle", { sku: variant.sku })}
      </h2>
      {variant.trackInventory ? null : (
        <p className="text-muted-foreground">{t("products.stock.notTracked")}</p>
      )}
      {variant.trackInventory && variant.allowBackorder ? (
        <p className="text-muted-foreground">{t("products.stock.backorderNote")}</p>
      ) : null}
      <LevelsView t={t} uiLocale={locale} sku={variant.sku} locations={locations} stock={stock} />
      <div ref={resultRef} tabIndex={-1} className={focusClass}>
        <AdjustmentResultView t={t} uiLocale={locale} result={result} />
      </div>
      {canAdjust ? (
        <AdjustmentFormView
          t={t}
          uiLocale={locale}
          sku={variant.sku}
          values={values}
          locations={locations}
          current={current}
          issues={form.state.fieldErrors}
          summary={form.state.summary}
          summaryRef={form.summaryRef}
          busy={busy}
          waiting={waiting}
          onChange={(next) => {
            form.clear();
            setValues(next);
          }}
          onSubmit={submit}
        />
      ) : null}
      <section aria-labelledby="product-stock-journal" className="flex flex-col gap-3">
        <h3 id="product-stock-journal" className="text-lg font-semibold">
          {t("products.stock.journalTitle")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("products.stock.journalHint")}</p>
        <LastMovementView t={t} uiLocale={locale} last={lastRow} />
        {journal.fallback !== null ? (
          <ResourceFallback t={t} state={journal.fallback} onRetry={journal.reload} />
        ) : journal.data === null ? null : (
          <JournalView
            t={t}
            uiLocale={locale}
            sku={variant.sku}
            rows={journalRows}
            offset={journalOffset}
            total={journal.data.total}
            busy={journal.refreshing}
            onOffset={setJournalOffset}
          />
        )}
      </section>
      {canReservations ? (
        <section aria-labelledby="product-stock-reservations" className="flex flex-col gap-3">
          <h3 id="product-stock-reservations" className="text-lg font-semibold">
            {t("products.stock.reservationsTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("products.stock.reservationsHint")}</p>
          {reservations.fallback !== null ? (
            <ResourceFallback t={t} state={reservations.fallback} onRetry={reservations.reload} />
          ) : reservations.data === null ? null : (
            <ReservationsView
              t={t}
              uiLocale={locale}
              sku={variant.sku}
              status={reservationStatus}
              rows={reservations.data.items}
              offset={reservationOffset}
              total={reservations.data.total}
              busy={reservations.refreshing}
              onStatus={(status) => {
                setReservationStatus(status);
                setReservationOffset(0);
              }}
              onOffset={setReservationOffset}
            />
          )}
        </section>
      ) : null}
      {confirming === null || confirmation === null ? null : (
        <ConfirmDialog
          open
          tone="danger"
          busy={busy}
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={t("products.stock.confirm")}
          cancelLabel={t("dict.form.cancel")}
          onClose={() => setConfirming(null)}
          onConfirm={() => void flight.current.run(() => send(confirming))}
        />
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </section>
  );
}

/**
 * Stock: the locations and the product-level inventory (two reads, whatever the number of variants), a summary of every
 * variant, and one open variant at a time with its levels, adjustment form, newest movement, journal and reservations
 * (each a bounded, paged read of that variant). An adjustment is sent once (a second click while it runs sends nothing),
 * never retried and never shown before the server answered; after any answer the levels and the journal are read again
 * (owner answer 12).
 */
export function StockTab({ product, content, onDirtyChange }: ProductTabProps) {
  const { t, locale } = useI18n();
  const config = useAdminConfig();
  const session = useSession();
  const meId = session.state.me?.user.id ?? "";
  const emails = useAdminEmails(stockSections(session.state.me?.permissions ?? null).userEmails);
  const definitions = useOptionDefinitions(product.options.map((option) => option.optionId));
  const naming: VariantNaming = { uiLocale: locale, content, options: definitions.byId };
  const resource = useRefreshingResource((signal) => loadStock(product.id, signal), [product.id]);
  const [selected, setSelected] = useState<string | null>(product.variants[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const reportDirty = useCallback(
    (next: boolean) => {
      setDirty(next);
      onDirtyChange(next);
    },
    [onDirtyChange],
  );

  const data = resource.data;
  const inventory = useMemo(
    () => new Map((data?.inventory.items ?? []).map((item) => [item.variantId, item])),
    [data],
  );
  const variant = product.variants.find((entry) => entry.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-6" aria-busy={resource.refreshing || undefined}>
      <div className="flex flex-col gap-2 text-muted-foreground">
        <p>{t("products.stock.intro", { threshold: config.lowStockThreshold })}</p>
        <p>{t("products.stock.serverDecides")}</p>
      </div>
      {resource.fallback !== null || data === null ? (
        resource.fallback === null ? null : (
          <ResourceFallback t={t} state={resource.fallback} onRetry={resource.reload} />
        )
      ) : (
        <>
          {data.locations.length === 0 ? (
            <FailureMessage t={t} descriptor={{ key: "products.stock.noLocations" }} />
          ) : null}
          <StockSummaryView
            t={t}
            uiLocale={locale}
            naming={naming}
            product={product}
            inventory={inventory}
            lowStockThreshold={config.lowStockThreshold}
            selected={selected}
            busy={busy || dirty}
            onSelect={setSelected}
          />
          {dirty ? (
            <p className="text-sm text-muted-foreground">{t("products.stock.switchWhileDirty")}</p>
          ) : null}
          {variant === null || data.locations.length === 0 ? null : (
            <VariantStock
              key={variant.id}
              product={product}
              variant={variant}
              locations={data.locations}
              stock={inventory.get(variant.id)}
              meId={meId}
              emails={emails}
              onReloadLevels={resource.reload}
              onDirtyChange={reportDirty}
              onBusyChange={setBusy}
            />
          )}
        </>
      )}
    </div>
  );
}
