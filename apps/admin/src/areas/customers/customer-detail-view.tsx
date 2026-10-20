import type { AdminCustomer } from "@fluxkit/api-client";
import {
  Alert,
  Button,
  DescriptionList,
  StatusBadge,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { PATHS } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import type { CustomerAction } from "./customer-actions";
import { linkClass } from "./customer-parts";
import {
  customerOrdersHref,
  fullName,
  lockLabelKey,
  lockTone,
  statusLabelKey,
  statusTone,
} from "./customer-view";

/**
 * The customer detail (plan step 9): profile, account state, the link to the customer's orders and the actions.
 * Presentational: props in, markup out. Every personal text (email, names, phone) is rendered as text; nothing here is
 * HTML, and no personal text goes into a link (the orders link carries the id only).
 */

export interface CustomerDetailViewProps {
  t: Translator;
  uiLocale: string;
  customer: AdminCustomer;
  /** The actions to offer (hints, `offeredCustomerActions`); empty for a session without `customers.write`. */
  actions: readonly CustomerAction[];
  /** Whether the session may read orders: the "orders of this customer" link leads to a list that needs it. */
  canReadOrders: boolean;
  onAction: (action: CustomerAction) => void;
  /** Buttons are off while a write runs or the customer reloads. */
  busy: boolean;
  /** The status line (always rendered, a focus target after an action). */
  statusLine: ReactNode;
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

const ACTION_BUTTON: Record<
  CustomerAction,
  { label: string; hint: string; variant: "primary" | "secondary" | "danger" }
> = {
  deactivate: {
    label: "customer.action.deactivate",
    hint: "customer.action.deactivateHint",
    variant: "danger",
  },
  activate: {
    label: "customer.action.activate",
    hint: "customer.action.activateHint",
    variant: "primary",
  },
  unlock: {
    label: "customer.action.unlock",
    hint: "customer.action.unlockHint",
    variant: "secondary",
  },
};

export function CustomerDetailView({
  t,
  uiLocale,
  customer,
  actions,
  canReadOrders,
  onAction,
  busy,
  statusLine,
}: CustomerDetailViewProps) {
  const name = fullName(customer.firstName, customer.lastName);

  const profile: DescriptionListItem[] = [
    {
      id: "email",
      term: t("customer.detail.email"),
      description: <span className="break-all">{customer.email}</span>,
    },
    {
      id: "name",
      term: t("customer.detail.name"),
      description:
        name === "" ? (
          <span className="text-muted-foreground">{t("customer.detail.noName")}</span>
        ) : (
          <span className="break-words">{name}</span>
        ),
    },
    {
      id: "phone",
      term: t("customer.detail.phone"),
      description:
        customer.phone === null ? (
          <span className="text-muted-foreground">{t("customer.detail.noPhone")}</span>
        ) : (
          <span className="break-all">{customer.phone}</span>
        ),
    },
  ];

  const account: DescriptionListItem[] = [
    {
      id: "status",
      term: t("customer.detail.status"),
      description: (
        <StatusBadge
          tone={statusTone(customer.isActive)}
          label={t(statusLabelKey(customer.isActive))}
        />
      ),
    },
    {
      id: "lock",
      term: t("customer.detail.lock"),
      description: (
        <StatusBadge
          tone={lockTone(customer.isLocked)}
          label={t(lockLabelKey(customer.isLocked))}
        />
      ),
    },
    {
      id: "orders",
      term: t("customer.detail.orderCount"),
      description: (
        <span className="flex flex-col gap-1">
          <span>{new Intl.NumberFormat(uiLocale).format(customer.orderCount)}</span>
          {canReadOrders ? (
            <Link to={customerOrdersHref(customer.id)} className={linkClass}>
              {t("customer.detail.ordersLink")}
            </Link>
          ) : null}
        </span>
      ),
    },
    {
      id: "lastLogin",
      term: t("customer.detail.lastLogin"),
      description:
        customer.lastLoginAt === null ? (
          <span className="text-muted-foreground">{t("customer.detail.neverSignedIn")}</span>
        ) : (
          formatDateTime(customer.lastLoginAt, uiLocale)
        ),
    },
    {
      id: "created",
      term: t("customer.detail.createdAt"),
      description: formatDateTime(customer.createdAt, uiLocale),
    },
    {
      id: "updated",
      term: t("customer.detail.updatedAt"),
      description: formatDateTime(customer.updatedAt, uiLocale),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link to={PATHS.customers} className={linkClass}>
          {t("customer.detail.back")}
        </Link>
      </p>
      <PageHeading>{t("customer.detail.title")}</PageHeading>
      {statusLine}
      {customer.isLocked ? (
        <Alert variant="warning" title={t("customer.detail.lockedTitle")}>
          <p>{t("customer.detail.lockedAlert")}</p>
        </Alert>
      ) : null}
      <Section id="customer-profile" title={t("customer.detail.profileTitle")}>
        <DescriptionList items={profile} />
      </Section>
      <Section id="customer-account" title={t("customer.detail.accountTitle")}>
        <DescriptionList items={account} />
      </Section>
      {actions.length === 0 ? null : (
        <Section id="customer-actions" title={t("customer.detail.actionsTitle")}>
          <ul className="flex flex-col gap-4">
            {actions.map((action) => {
              const entry = ACTION_BUTTON[action];
              return (
                <li key={action} className="flex flex-col items-start gap-2">
                  <Button
                    variant={entry.variant}
                    disabled={busy}
                    aria-busy={busy || undefined}
                    onClick={() => onAction(action)}
                  >
                    {t(entry.label)}
                  </Button>
                  <p className="max-w-prose text-sm text-muted-foreground">{t(entry.hint)}</p>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}
