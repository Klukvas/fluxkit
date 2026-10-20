import type { AdminPermission, AdminRole } from "@fluxkit/api-client";
import {
  Button,
  Dialog,
  Field,
  Input,
  LiveRegion,
  StatusBadge,
  type Translator,
} from "@fluxkit/ui";
import type { ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { mayConfirm, type Confirmation } from "./user-actions";
import { passwordFeedback } from "./password-policy";
import {
  USER_ROLES,
  USER_ROLE_PERMISSIONS,
  permissionLabelKey,
  roleLabelKey,
  roleTone,
  statusLabelKey,
  statusTone,
} from "./user-view";

/** Presentational helpers of the users area: props in, markup out, every word from the translator. */

export const linkClass = "font-medium text-foreground underline underline-offset-4";
export const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A message with the unknown code in small print (admins need it for support). */
export function DescriptorText({
  t,
  descriptor,
}: {
  t: Translator;
  descriptor: MessageDescriptor;
}) {
  return (
    <>
      {t(descriptor.key, descriptor.values)}
      {descriptor.code === undefined ? null : (
        <small className="ms-2 text-muted-foreground">
          {t("errors.reference", { code: descriptor.code })}
        </small>
      )}
    </>
  );
}

/**
 * The status line of a screen: always in the page (a live region announces changes of a region that was already there),
 * focusable so the focus can move to it after an answer.
 */
export function StatusLine({
  innerRef,
  children,
}: {
  innerRef?: Ref<HTMLDivElement>;
  children?: ReactNode;
}) {
  return (
    <div ref={innerRef} tabIndex={-1} className={focusClass}>
      <LiveRegion>{children}</LiveRegion>
    </div>
  );
}

export function RoleBadge({ t, role }: { t: Translator; role: AdminRole }) {
  return <StatusBadge tone={roleTone(role)} label={t(roleLabelKey(role))} />;
}

export function ActivityBadge({ t, isActive }: { t: Translator; isActive: boolean }) {
  return <StatusBadge tone={statusTone(isActive)} label={t(statusLabelKey(isActive))} />;
}

/** What a role may do: exactly its permissions (ADR 0009), as words. */
export function RolePermissions({ t, role }: { t: Translator; role: AdminRole }) {
  return (
    <ul className="ms-7 list-disc text-sm text-muted-foreground">
      {USER_ROLE_PERMISSIONS[role].map((permission: AdminPermission) => (
        <li key={permission}>{t(permissionLabelKey(permission))}</li>
      ))}
    </ul>
  );
}

/**
 * The role as a radio group, each role with the list of what it may do. Used by the create form and the role change.
 * `readOnly` shows the choice without letting it change (while a request runs).
 */
export function RoleChoices({
  t,
  idPrefix,
  legend,
  value,
  disabled,
  error,
  onChange,
}: {
  t: Translator;
  idPrefix: string;
  legend: string;
  value: AdminRole;
  disabled: boolean;
  error?: ReactNode;
  onChange: (role: AdminRole) => void;
}) {
  const errorId = `${idPrefix}-error`;
  return (
    <fieldset
      className="flex flex-col gap-3"
      aria-describedby={error === undefined ? undefined : errorId}
    >
      <legend className="mb-2 font-medium text-foreground">{legend}</legend>
      {USER_ROLES.map((role) => {
        const id = `${idPrefix}-${role}`;
        return (
          <div key={role} className="flex flex-col gap-1">
            <label htmlFor={id} className="inline-flex min-h-11 items-center gap-2 text-foreground">
              <input
                id={id}
                type="radio"
                name={idPrefix}
                value={role}
                checked={value === role}
                disabled={disabled}
                onChange={() => onChange(role)}
                className={`size-5 accent-primary ${focusClass}`}
              />
              <span className="font-medium">{t(roleLabelKey(role))}</span>
            </label>
            <RolePermissions t={t} role={role} />
          </div>
        );
      })}
      {error === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A new password field: `type="password"` unless the owner shows it on purpose, `autocomplete="new-password"` (a password
 * manager offers to generate one and never fills a stored one), no spell check. The live feedback under it says each rule
 * as met or not met in words; the field's value never leaves the form that owns it.
 */
export function NewPasswordField({
  t,
  id,
  name,
  label,
  value,
  email,
  visible,
  generated,
  error,
  disabled,
  onChange,
  onToggleVisible,
  onGenerate,
}: {
  t: Translator;
  id: string;
  name: "password" | "newPassword";
  label: string;
  value: string;
  /** The account's email: the password must not equal it. */
  email: string;
  visible: boolean;
  /** The field holds a generated password, shown once. */
  generated: boolean;
  error?: MessageDescriptor;
  disabled: boolean;
  onChange: (value: string) => void;
  onToggleVisible: () => void;
  onGenerate: () => void;
}) {
  const feedback = passwordFeedback(value, email);
  const policyId = `${id}-policy`;
  return (
    <div className="flex flex-col gap-2">
      <Field
        id={id}
        label={label}
        hint={t("user.password.hint", { min: feedback.min, max: feedback.max })}
        error={error === undefined ? undefined : <DescriptorText t={t} descriptor={error} />}
        required
      >
        {(control) => (
          <Input
            {...control}
            aria-describedby={[control["aria-describedby"], policyId].filter(Boolean).join(" ")}
            type={visible ? "text" : "password"}
            name={name}
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={1024}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </Field>
      <ul id={policyId} className="flex flex-col gap-1 text-sm">
        {feedback.rules.map((rule) => (
          <li key={rule.id} className={rule.met ? "text-foreground" : "text-muted-foreground"}>
            <span className="font-medium">
              {t(rule.met ? "user.password.met" : "user.password.notMet")}
            </span>{" "}
            {rule.id === "length"
              ? t("user.password.ruleLength", {
                  min: feedback.min,
                  max: feedback.max,
                  count: feedback.length,
                })
              : t("user.password.ruleNotEmail")}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          onClick={onToggleVisible}
        >
          {t(visible ? "user.password.hide" : "user.password.show")}
        </Button>
        <Button variant="secondary" disabled={disabled} onClick={onGenerate}>
          {t("user.password.generate")}
        </Button>
      </div>
      {generated ? (
        <p className="max-w-prose text-sm text-muted-foreground">
          {t("user.password.generatedNote")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The confirmation of a user action: an alert dialog with the consequences spelled out, cancel first (the safe choice,
 * focused), and for an owner acting on their own account an explicit tick before the confirm button works. A refusal
 * (for example the last-owner rule) is explained inside the dialog. Escape and the buttons do nothing while sending.
 */
export function UserConfirmDialog({
  t,
  open,
  busy,
  title,
  confirmation,
  selfTicked,
  selfCheckLabel,
  refusal,
  confirmLabel,
  onSelfTick,
  onConfirm,
  onClose,
  children,
}: {
  t: Translator;
  open: boolean;
  busy: boolean;
  title: string;
  confirmation: Confirmation;
  selfTicked: boolean;
  selfCheckLabel: string;
  refusal: MessageDescriptor | null;
  confirmLabel: string;
  onSelfTick: (ticked: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
  /** The consequences, as paragraphs. */
  children: ReactNode;
}) {
  const allowed = mayConfirm(confirmation, selfTicked);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={title}
      role="alertdialog"
      aria-busy={busy || undefined}
      footer={
        <>
          <Button
            variant="secondary"
            data-autofocus=""
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={onClose}
          >
            {t("user.dialog.cancel")}
          </Button>
          <Button
            variant={confirmation.tone === "danger" ? "danger" : "primary"}
            disabled={busy || !allowed}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy ? t("user.dialog.sending") : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {children}
        {confirmation.selfCheck ? (
          <label
            htmlFor="user-self-check"
            className="inline-flex min-h-11 items-center gap-2 font-medium text-foreground"
          >
            <input
              id="user-self-check"
              type="checkbox"
              checked={selfTicked}
              disabled={busy}
              onChange={(event) => onSelfTick(event.target.checked)}
              className={`size-5 accent-primary ${focusClass}`}
            />
            <span>{selfCheckLabel}</span>
          </label>
        ) : null}
        <LiveRegion>
          {refusal === null ? null : (
            <p className="text-danger">
              <DescriptorText t={t} descriptor={refusal} />
            </p>
          )}
        </LiveRegion>
      </div>
    </Dialog>
  );
}

/** Previous and next page as links (the page is in the URL); the range is spelled out for assistive technology too. */
export function UserPager({
  t,
  total,
  limit,
  offset,
  count,
  hrefForOffset,
}: {
  t: Translator;
  total: number;
  limit: number;
  offset: number;
  count: number;
  hrefForOffset: (offset: number) => string;
}) {
  if (total === 0) return null;
  const hasPrevious = offset > 0;
  const hasNext = offset + count < total;
  return (
    <nav aria-label={t("user.list.pagerLabel")} className="flex flex-wrap items-center gap-4">
      <p className="text-muted-foreground">
        {t("user.list.pageRange", { from: offset + 1, to: offset + count, total })}
      </p>
      {hasPrevious ? (
        <Link to={hrefForOffset(Math.max(0, offset - limit))} rel="prev" className={linkClass}>
          {t("user.list.previous")}
        </Link>
      ) : null}
      {hasNext ? (
        <Link to={hrefForOffset(offset + limit)} rel="next" className={linkClass}>
          {t("user.list.next")}
        </Link>
      ) : null}
    </nav>
  );
}
