import type {
  AdminOrder,
  AdminShipment,
  AdminShipmentHistoryEntry,
  ShipmentPayer,
} from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DataTable,
  DescriptionList,
  Field,
  Input,
  Select,
  StatusBadge,
  type DataTableColumn,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import { formatDateTime } from "../../lib/format";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { actorText } from "./order-detail-view";
import { DescriptorText, focusClass } from "./order-parts";
import { moneyText, snapshotText, type MoneyContext } from "./order-view";
import { SHIPMENT_LIMITS, type ShipmentFormValues, type ShipmentIssues } from "./shipment-form";
import type { ShipmentNotice } from "./shipment-outcome";
import {
  SHIPMENT_STATUS_TONES,
  STALE_PENDING_MS,
  payerLabelKey,
  shipmentActor,
  shipmentStatusLabelKey,
  showsCreateForm,
  type CreateGate,
  type ShipmentAction,
} from "./shipment-view";

/**
 * The delivery part of the order detail (shipping plan step 11): the shipping snapshot of the checkout, the order's
 * waybills with their status journals and actions, and the create-waybill form. Presentational: props in, markup out.
 * Every text of the carrier and of the order is rendered as text; the label is never a link to the API.
 */

const ACTION_BUTTONS: Record<
  ShipmentAction,
  { key: string; variant: "primary" | "secondary" | "danger" }
> = {
  refresh: { key: "shipment.action.refresh", variant: "secondary" },
  cancel: { key: "shipment.action.cancel", variant: "danger" },
  label: { key: "shipment.action.label", variant: "secondary" },
  reconcile: { key: "shipment.action.reconcile", variant: "primary" },
};

export function ShipmentNoticeView({
  t,
  notice,
}: {
  t: Translator;
  notice: ShipmentNotice | null;
}) {
  if (notice === null) return null;
  switch (notice.kind) {
    case "created":
      return (
        <Alert variant="success">
          {notice.trackingNumber === null
            ? t("shipment.notice.createdNoNumber")
            : t("shipment.notice.created", { tracking: notice.trackingNumber })}
        </Alert>
      );
    case "failed":
      return (
        <Alert variant="danger" title={t("shipment.notice.failedTitle")}>
          <p>{t(`shipment.notice.failed.${notice.reason}`)}</p>
          {notice.providerCodes.length === 0 ? null : (
            <p className="text-sm">
              {t("shipment.notice.codes")}{" "}
              <span className="break-all font-mono">{notice.providerCodes.join(", ")}</span>
            </p>
          )}
        </Alert>
      );
    case "unknownCreate":
      return (
        <Alert variant="warning" title={t("shipment.notice.unknownTitle")}>
          <p>{t("shipment.notice.unknownCreate")}</p>
        </Alert>
      );
    case "lostCreate":
      return (
        <Alert variant="warning" title={t("shipment.notice.unknownTitle")}>
          <p>{t("shipment.notice.lostCreate")}</p>
        </Alert>
      );
    case "reconciled":
      return (
        <Alert variant={notice.found ? "success" : "info"}>
          {t(notice.found ? "shipment.notice.reconciledFound" : "shipment.notice.reconciledNone")}
        </Alert>
      );
    case "refreshed":
      return <Alert variant="success">{t("shipment.notice.refreshed")}</Alert>;
    case "cancelled":
      return <Alert variant="success">{t("shipment.notice.cancelled")}</Alert>;
    case "labelReady":
      return <Alert variant="success">{t("shipment.notice.labelReady")}</Alert>;
    case "lost":
      return (
        <Alert variant="warning" title={t("shipment.notice.unknownTitle")}>
          <p>{t(`shipment.notice.lost.${notice.action}`)}</p>
        </Alert>
      );
  }
}

/** The shipping snapshot of the checkout: the method, the price charged, who pays, and the pickup point. */
export function ShippingSnapshot({
  t,
  uiLocale,
  order,
  money,
}: {
  t: Translator;
  uiLocale: string;
  order: AdminOrder;
  money: MoneyContext;
}) {
  const shipping = order.shipping;
  if (shipping === null) {
    return <p className="text-muted-foreground">{t("shipment.snapshot.none")}</p>;
  }
  const items: DescriptionListItem[] = [
    {
      id: "method",
      term: t("shipment.snapshot.method"),
      description: (
        <span className="break-words">
          {snapshotText(shipping.title, uiLocale, order.locale) || shipping.methodCode}
        </span>
      ),
    },
    {
      id: "kind",
      term: t("shipment.snapshot.kind"),
      description: t(`shipment.kind.${shipping.kind}`),
    },
    {
      id: "carrier",
      term: t("shipment.snapshot.carrier"),
      description:
        shipping.providerCode === null ? (
          <span className="text-muted-foreground">{t("shipment.snapshot.noCarrier")}</span>
        ) : (
          <span className="break-all">
            {shipping.providerService === null
              ? shipping.providerCode
              : `${shipping.providerCode} / ${shipping.providerService}`}
          </span>
        ),
    },
    {
      id: "price",
      term: t("shipment.snapshot.price"),
      description: moneyText(shipping.amount, money),
    },
    {
      id: "payer",
      term: t("shipment.snapshot.payer"),
      description: t(payerLabelKey(shipping.payer)),
    },
  ];
  if (shipping.estimatedCarrierAmount !== null) {
    items.push({
      id: "estimate",
      term: t("shipment.snapshot.estimate"),
      description: moneyText(shipping.estimatedCarrierAmount, money),
    });
  }
  if (shipping.destination !== null) {
    const point = shipping.destination;
    items.push({
      id: "destination",
      term: t("shipment.snapshot.destination"),
      description: (
        <span className="break-words">
          {t("shipment.snapshot.destinationValue", {
            kind: t(`shipment.pickupKind.${point.kind}`),
            number: point.number,
            city: point.cityName,
            description: point.description,
          })}
        </span>
      ),
    });
  }
  return <DescriptionList items={items} />;
}

export interface ShipmentCardProps {
  t: Translator;
  uiLocale: string;
  order: AdminOrder;
  shipment: AdminShipment;
  money: MoneyContext;
  actions: readonly ShipmentAction[];
  onAction: (shipment: AdminShipment, action: ShipmentAction) => void;
  busy: boolean;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
  now: Date;
}

function actorOf(
  t: Translator,
  entry: Pick<AdminShipmentHistoryEntry, "actorType" | "actorAdminId">,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): string {
  return actorText(t, shipmentActor(entry, meId, emails));
}

function ShipmentCard({
  t,
  uiLocale,
  order,
  shipment,
  money,
  actions,
  onAction,
  busy,
  meId,
  emails,
  now,
}: ShipmentCardProps) {
  const tracking = shipment.trackingNumber;
  const headingId = `shipment-${shipment.id}`;
  const date = (value: string) => formatDateTime(value, uiLocale);
  const items: DescriptionListItem[] = [
    {
      id: "status",
      term: t("shipment.field.status"),
      description: (
        <StatusBadge
          tone={SHIPMENT_STATUS_TONES[shipment.status]}
          label={t(shipmentStatusLabelKey(shipment.status))}
        />
      ),
    },
    {
      id: "carrier",
      term: t("shipment.field.carrier"),
      description: (
        <span className="break-all">
          {shipment.providerService === null
            ? shipment.providerCode
            : `${shipment.providerCode} / ${shipment.providerService}`}
        </span>
      ),
    },
    {
      id: "tracking",
      term: t("shipment.field.tracking"),
      description:
        tracking === null ? (
          <span className="text-muted-foreground">{t("shipment.field.noTracking")}</span>
        ) : (
          <span className="break-all">{tracking}</span>
        ),
    },
  ];
  if (shipment.carrierStatusCode !== null) {
    items.push({
      id: "carrierStatus",
      term: t("shipment.field.carrierStatus"),
      description: (
        <span className="break-all">
          {shipment.carrierStatusAt === null
            ? shipment.carrierStatusCode
            : t("shipment.field.carrierStatusAt", {
                code: shipment.carrierStatusCode,
                at: date(shipment.carrierStatusAt),
              })}
        </span>
      ),
    });
  }
  items.push(
    {
      id: "declared",
      term: t("shipment.field.declared"),
      description: moneyText(shipment.declaredValue, money),
    },
    {
      id: "payer",
      term: t("shipment.field.payer"),
      description: t(`shipment.field.payer.${shipment.payer}`),
    },
    {
      id: "parcel",
      term: t("shipment.field.parcel"),
      description: t("shipment.field.parcelValue", {
        weight: shipment.weightGrams,
        length: shipment.lengthMm,
        width: shipment.widthMm,
        height: shipment.heightMm,
      }),
    },
  );
  if (shipment.carrierCost !== null) {
    items.push({
      id: "cost",
      term: t("shipment.field.cost"),
      description: moneyText(shipment.carrierCost, money),
    });
  }
  items.push({
    id: "created",
    term: t("shipment.field.created"),
    description: (
      <span className="break-words">
        {shipment.createdBy === null
          ? date(shipment.createdAt)
          : t("shipment.field.createdBy", {
              at: date(shipment.createdAt),
              actor: actorOf(
                t,
                { actorType: "admin", actorAdminId: shipment.createdBy },
                meId,
                emails,
              ),
            })}
      </span>
    ),
  });
  if (shipment.deliveredAt !== null) {
    items.push({
      id: "delivered",
      term: t("shipment.field.delivered"),
      description: date(shipment.deliveredAt),
    });
  }
  if (shipment.cancelledAt !== null) {
    items.push({
      id: "cancelledAt",
      term: t("shipment.field.cancelledAt"),
      description: date(shipment.cancelledAt),
    });
  }

  const journal: AdminShipmentHistoryEntry[] = shipment.history;
  const journalColumns: DataTableColumn<AdminShipmentHistoryEntry>[] = [
    { id: "at", header: t("shipment.journal.at"), cell: (row) => date(row.at) },
    {
      id: "change",
      header: t("shipment.journal.change"),
      cell: (row) =>
        row.fromStatus === null
          ? t("shipment.journal.first", { to: t(shipmentStatusLabelKey(row.toStatus)) })
          : t("shipment.journal.changed", {
              from: t(shipmentStatusLabelKey(row.fromStatus)),
              to: t(shipmentStatusLabelKey(row.toStatus)),
            }),
    },
    {
      id: "code",
      header: t("shipment.journal.code"),
      cell: (row) =>
        row.carrierStatusCode === null ? (
          <span className="text-muted-foreground">{t("shipment.journal.noCode")}</span>
        ) : (
          <span className="break-all">{row.carrierStatusCode}</span>
        ),
    },
    {
      id: "actor",
      header: t("shipment.journal.actor"),
      cell: (row) => <span className="break-all">{actorOf(t, row, meId, emails)}</span>,
    },
  ];
  const stalePending =
    shipment.status === "pending" &&
    now.getTime() - new Date(shipment.createdAt).getTime() >= STALE_PENDING_MS;

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-md border border-border p-4"
    >
      <h3 id={headingId} className="text-base font-semibold text-foreground">
        {tracking === null ? t("shipment.card.noNumber") : t("shipment.card.title", { tracking })}
      </h3>
      {shipment.status === "unknown" ? (
        <Alert variant="warning" title={t("shipment.card.unknownTitle")}>
          <p>{t("shipment.card.unknownBody")}</p>
        </Alert>
      ) : shipment.status === "pending" ? (
        <Alert variant="warning" title={t("shipment.card.pendingTitle")}>
          <p>{t(stalePending ? "shipment.card.pendingStaleBody" : "shipment.card.pendingBody")}</p>
        </Alert>
      ) : shipment.status === "failed" ? (
        <p className="text-muted-foreground">{t("shipment.card.failedBody")}</p>
      ) : null}
      <DescriptionList items={items} />
      {actions.length === 0 ? null : (
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <Button
              key={action}
              variant={ACTION_BUTTONS[action].variant}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => onAction(shipment, action)}
            >
              {t(ACTION_BUTTONS[action].key)}
            </Button>
          ))}
        </div>
      )}
      <DataTable
        caption={t("shipment.journal.caption", { number: order.number })}
        captionHidden
        columns={journalColumns}
        rows={journal}
        rowKey={(row) => String(journal.indexOf(row))}
        emptyMessage={t("shipment.journal.empty")}
      />
    </article>
  );
}

export interface CreateWaybillFormProps {
  t: Translator;
  gate: CreateGate;
  carrier: string | null;
  currency: string;
  exponent: number;
  values: ShipmentFormValues;
  onChange: (values: ShipmentFormValues) => void;
  issues: ShipmentIssues;
  summary: readonly MessageDescriptor[];
  summaryRef?: Ref<HTMLDivElement>;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function NumberField({
  t,
  id,
  label,
  hint,
  value,
  issue,
  inputMode,
  onChange,
}: {
  t: Translator;
  id: string;
  label: string;
  hint: string;
  value: string;
  issue: MessageDescriptor | undefined;
  inputMode: "numeric" | "decimal";
  onChange: (value: string) => void;
}) {
  return (
    <Field
      id={id}
      label={label}
      hint={hint}
      error={issue === undefined ? undefined : <DescriptorText t={t} descriptor={issue} />}
      required
      requiredIndicator={t("order.dialog.requiredMark")}
    >
      {(control) => (
        <Input
          {...control}
          name={id}
          inputMode={inputMode}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/**
 * The create-waybill form. It is off (a disabled fieldset, with the reason in words) until the order is paid; it is not
 * shown for an order past shipping or without a carrier, nor while a waybill is active. A refused or lost create is never
 * repeated by the screen: the outcome is shown and the admin decides.
 */
export function CreateWaybillForm({
  t,
  gate,
  carrier,
  currency,
  exponent,
  values,
  onChange,
  issues,
  summary,
  summaryRef,
  busy,
  onSubmit,
}: CreateWaybillFormProps) {
  if (gate.kind === "hidden") return null;
  const reason: ReactNode =
    gate.kind === "no_carrier" ? (
      <p className="text-muted-foreground">{t("shipment.create.noCarrier")}</p>
    ) : gate.kind === "exists" ? (
      <p className="text-muted-foreground">
        {t("shipment.create.exists", { status: t(shipmentStatusLabelKey(gate.shipment.status)) })}
      </p>
    ) : gate.kind === "not_paid" ? (
      <p id="shipment-gate-hint" className="text-muted-foreground">
        {gate.status === "awaiting_payment"
          ? t("shipment.create.notPaidYet")
          : t("shipment.create.notShippable", { status: t(`order.status.${gate.status}`) })}
      </p>
    ) : null;
  const heading = (
    <h3 id="shipment-create-title" className="text-base font-semibold text-foreground">
      {t("shipment.create.title")}
    </h3>
  );
  if (!showsCreateForm(gate)) {
    return (
      <section aria-labelledby="shipment-create-title" className="flex flex-col gap-2">
        {heading}
        {reason}
      </section>
    );
  }
  const ready = gate.kind === "ready";
  const set = (patch: Partial<ShipmentFormValues>) => onChange({ ...values, ...patch });
  const whole = (limit: { min: number; max: number }) =>
    t("shipment.create.wholeHint", { min: limit.min, max: limit.max });
  return (
    <section aria-labelledby="shipment-create-title" className="flex flex-col gap-3">
      {heading}
      {reason}
      {ready ? (
        <p className="max-w-prose text-muted-foreground">
          {t("shipment.create.intro", { carrier: carrier ?? "" })}
        </p>
      ) : null}
      <form
        id="shipment-create"
        method="post"
        onSubmit={onSubmit}
        noValidate
        className="flex max-w-2xl flex-col gap-4"
        aria-busy={busy || undefined}
      >
        {summary.length === 0 ? null : (
          <div ref={summaryRef} tabIndex={-1} className={focusClass}>
            <Alert variant="danger">
              <ul className="flex flex-col gap-1">
                {summary.map((descriptor, index) => (
                  <li key={`${descriptor.key}-${String(index)}`}>
                    <DescriptorText t={t} descriptor={descriptor} />
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        <fieldset disabled={!ready || busy} className="flex min-w-0 flex-col gap-4">
          <legend className="sr-only">{t("shipment.create.title")}</legend>
          <NumberField
            t={t}
            id="shipment-weight"
            label={t("shipment.create.weight")}
            hint={whole(SHIPMENT_LIMITS.weightGrams)}
            value={values.weightGrams}
            issue={issues.weightGrams}
            inputMode="numeric"
            onChange={(weightGrams) => set({ weightGrams })}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              t={t}
              id="shipment-length"
              label={t("shipment.create.length")}
              hint={whole(SHIPMENT_LIMITS.dimensionMm)}
              value={values.lengthMm}
              issue={issues.lengthMm}
              inputMode="numeric"
              onChange={(lengthMm) => set({ lengthMm })}
            />
            <NumberField
              t={t}
              id="shipment-width"
              label={t("shipment.create.width")}
              hint={whole(SHIPMENT_LIMITS.dimensionMm)}
              value={values.widthMm}
              issue={issues.widthMm}
              inputMode="numeric"
              onChange={(widthMm) => set({ widthMm })}
            />
            <NumberField
              t={t}
              id="shipment-height"
              label={t("shipment.create.height")}
              hint={whole(SHIPMENT_LIMITS.dimensionMm)}
              value={values.heightMm}
              issue={issues.heightMm}
              inputMode="numeric"
              onChange={(heightMm) => set({ heightMm })}
            />
          </div>
          <NumberField
            t={t}
            id="shipment-declared"
            label={t("shipment.create.declared", { currency })}
            hint={t("shipment.create.declaredHint", { decimals: exponent })}
            value={values.declaredValue}
            issue={issues.declaredValue}
            inputMode="decimal"
            onChange={(declaredValue) => set({ declaredValue })}
          />
          <Field
            id="shipment-payer"
            label={t("shipment.create.payer")}
            hint={t("shipment.create.payerHint")}
            error={
              issues.payer === undefined ? undefined : (
                <DescriptorText t={t} descriptor={issues.payer} />
              )
            }
          >
            {(control) => (
              <Select
                {...control}
                name="payer"
                value={values.payer}
                onChange={(event) => set({ payer: event.target.value as ShipmentPayer })}
              >
                <option value="sender">{t("shipment.field.payer.sender")}</option>
                <option value="recipient">{t("shipment.field.payer.recipient")}</option>
              </Select>
            )}
          </Field>
          <Field
            id="shipment-description"
            label={t("shipment.create.description")}
            hint={t("shipment.create.descriptionHint", { max: SHIPMENT_LIMITS.descriptionMax })}
            error={
              issues.description === undefined ? undefined : (
                <DescriptorText t={t} descriptor={issues.description} />
              )
            }
            required
            requiredIndicator={t("order.dialog.requiredMark")}
          >
            {(control) => (
              <Input
                {...control}
                name="description"
                autoComplete="off"
                maxLength={SHIPMENT_LIMITS.descriptionMax}
                value={values.description}
                onChange={(event) => set({ description: event.target.value })}
              />
            )}
          </Field>
          <div>
            <Button
              type="submit"
              aria-busy={busy || undefined}
              {...(ready ? {} : { "aria-describedby": "shipment-gate-hint" })}
            >
              {busy ? t("order.dialog.sending") : t("shipment.create.submit")}
            </Button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

export interface ShipmentPanelProps {
  t: Translator;
  uiLocale: string;
  order: AdminOrder;
  money: MoneyContext;
  shipments: readonly AdminShipment[];
  /** The actions offered for each shipment (`offeredShipmentActions`). */
  actionsFor: (shipment: AdminShipment) => readonly ShipmentAction[];
  onAction: (shipment: AdminShipment, action: ShipmentAction) => void;
  busy: boolean;
  meId: string;
  emails: ReadonlyMap<string, string> | null;
  now: Date;
  /** The status line (always rendered, a focus target after an action) and the form of the create gate. */
  statusLine: ReactNode;
  createForm: ReactNode;
}

export function ShipmentPanel({
  t,
  uiLocale,
  order,
  money,
  shipments,
  actionsFor,
  onAction,
  busy,
  meId,
  emails,
  now,
  statusLine,
  createForm,
}: ShipmentPanelProps) {
  return (
    <section aria-labelledby="order-delivery" className="flex flex-col gap-4">
      <h2 id="order-delivery" className="text-lg font-semibold text-foreground">
        {t("shipment.title")}
      </h2>
      <ShippingSnapshot t={t} uiLocale={uiLocale} order={order} money={money} />
      {statusLine}
      {shipments.length === 0 ? (
        order.shipping?.providerCode === null || order.shipping === null ? null : (
          <p className="text-muted-foreground">{t("shipment.list.none")}</p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {shipments.map((shipment) => (
            <ShipmentCard
              key={shipment.id}
              t={t}
              uiLocale={uiLocale}
              order={order}
              shipment={shipment}
              money={money}
              actions={actionsFor(shipment)}
              onAction={onAction}
              busy={busy}
              meId={meId}
              emails={emails}
              now={now}
            />
          ))}
        </div>
      )}
      {createForm}
    </section>
  );
}
