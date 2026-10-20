import type { AdminRole, AdminUser } from "@fluxkit/api-client";
import {
  Alert,
  Badge,
  Button,
  DescriptionList,
  type DescriptionListItem,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { PATHS } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import type { UserAction } from "./user-actions";
import { ActivityBadge, RoleBadge, RoleChoices, linkClass } from "./user-parts";

/**
 * The user detail (plan step 10): the stored user, the role change, the activity and the password reset. Presentational:
 * props in, markup out. The email is rendered as text; no link carries anything but the id.
 */

export interface UserDetailViewProps {
  t: Translator;
  uiLocale: string;
  user: AdminUser;
  /** The user is the signed-in admin (by id from `me`). */
  self: boolean;
  /** The actions to offer (hints, `offeredUserActions`); empty without `users.manage`. */
  actions: readonly UserAction[];
  /** The role chosen in the role form (the stored role until the owner picks another). */
  selectedRole: AdminRole;
  onSelectRole: (role: AdminRole) => void;
  onAction: (action: UserAction) => void;
  /** Buttons are off while a write runs or the user reloads. */
  busy: boolean;
  statusLine: ReactNode;
  /** The password reset form (it owns the typed password). */
  resetForm: ReactNode;
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

export function UserDetailView({
  t,
  uiLocale,
  user,
  self,
  actions,
  selectedRole,
  onSelectRole,
  onAction,
  busy,
  statusLine,
  resetForm,
}: UserDetailViewProps) {
  const items: DescriptionListItem[] = [
    {
      id: "email",
      term: t("user.detail.email"),
      description: (
        <span className="flex flex-wrap items-center gap-2">
          <span className="break-all">{user.email}</span>
          {self ? <Badge>{t("user.you")}</Badge> : null}
        </span>
      ),
    },
    { id: "role", term: t("user.detail.role"), description: <RoleBadge t={t} role={user.role} /> },
    {
      id: "status",
      term: t("user.detail.status"),
      description: <ActivityBadge t={t} isActive={user.isActive} />,
    },
    {
      id: "lastLogin",
      term: t("user.detail.lastLogin"),
      description:
        user.lastLoginAt === null ? (
          <span className="text-muted-foreground">{t("user.neverSignedIn")}</span>
        ) : (
          formatDateTime(user.lastLoginAt, uiLocale)
        ),
    },
    {
      id: "created",
      term: t("user.detail.createdAt"),
      description: formatDateTime(user.createdAt, uiLocale),
    },
    {
      id: "updated",
      term: t("user.detail.updatedAt"),
      description: formatDateTime(user.updatedAt, uiLocale),
    },
  ];
  const activity = actions.find((action) => action === "deactivate" || action === "activate");

  return (
    <div className="flex flex-col gap-8">
      <p>
        <Link to={PATHS.users} className={linkClass}>
          {t("user.back")}
        </Link>
      </p>
      <PageHeading>{t("user.detail.title")}</PageHeading>
      {statusLine}
      {self ? (
        <Alert variant="warning" title={t("user.detail.selfTitle")}>
          <p>{t("user.detail.selfBody")}</p>
        </Alert>
      ) : null}
      <Section id="user-summary" title={t("user.detail.summaryTitle")}>
        <DescriptionList items={items} />
      </Section>
      {actions.includes("changeRole") ? (
        <Section id="user-role-section" title={t("user.role.title")}>
          <p className="max-w-prose text-sm text-muted-foreground">{t("user.role.hint")}</p>
          <RoleChoices
            t={t}
            idPrefix="user-role-change"
            legend={t("user.role.legend")}
            value={selectedRole}
            disabled={busy}
            onChange={onSelectRole}
          />
          <div>
            <Button
              disabled={busy || selectedRole === user.role}
              aria-busy={busy || undefined}
              onClick={() => onAction("changeRole")}
            >
              {t("user.role.submit")}
            </Button>
          </div>
          {selectedRole === user.role ? (
            <p className="text-sm text-muted-foreground">{t("user.role.unchanged")}</p>
          ) : null}
        </Section>
      ) : null}
      {activity === undefined ? null : (
        <Section id="user-activity-section" title={t("user.activity.title")}>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t(
              activity === "deactivate"
                ? "user.activity.deactivateHint"
                : "user.activity.activateHint",
            )}
          </p>
          <div>
            <Button
              variant={activity === "deactivate" ? "danger" : "primary"}
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => onAction(activity)}
            >
              {t(activity === "deactivate" ? "user.action.deactivate" : "user.action.activate")}
            </Button>
          </div>
        </Section>
      )}
      {actions.includes("resetPassword") ? (
        <Section id="user-reset-section" title={t("user.reset.title")}>
          {resetForm}
        </Section>
      ) : null}
    </div>
  );
}
