import type { AdminRole, AdminUser } from "@fluxkit/api-client";
import { Alert, Button, Field, Input, type Translator } from "@fluxkit/ui";
import type { FormEvent, ReactNode, Ref } from "react";
import { Link } from "react-router";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { PATHS } from "../../router/paths";
import { PageHeading } from "../../views/status-views";
import { EMAIL_MAX_LENGTH, type CreateField, type CreateUserValues } from "./user-form";
import type { LookupResult } from "./user-lookup";
import {
  DescriptorText,
  NewPasswordField,
  RoleBadge,
  RoleChoices,
  focusClass,
  linkClass,
} from "./user-parts";
import { userHref } from "./user-view";

/**
 * The create form (plan step 10): email, role (each role with what it may do), the initial password with live policy
 * feedback, show or hide, and a generated password. Presentational: the page owns the values and sends.
 */
export interface CreateUserFormViewProps {
  t: Translator;
  values: CreateUserValues;
  fieldErrors: Partial<Record<CreateField, MessageDescriptor>>;
  summary: MessageDescriptor[];
  busy: boolean;
  passwordVisible: boolean;
  passwordGenerated: boolean;
  onEmailChange: (email: string) => void;
  onRoleChange: (role: AdminRole) => void;
  onPasswordChange: (password: string) => void;
  onTogglePassword: () => void;
  onGeneratePassword: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  summaryRef?: Ref<HTMLDivElement>;
}

export function CreateUserFormView({
  t,
  values,
  fieldErrors,
  summary,
  busy,
  passwordVisible,
  passwordGenerated,
  onEmailChange,
  onRoleChange,
  onPasswordChange,
  onTogglePassword,
  onGeneratePassword,
  onSubmit,
  summaryRef,
}: CreateUserFormViewProps) {
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      className="flex max-w-xl flex-col gap-6"
      aria-busy={busy || undefined}
    >
      {summary.length === 0 ? null : (
        <div ref={summaryRef} tabIndex={-1} className={focusClass}>
          <Alert variant="danger" title={t("user.create.summaryTitle")}>
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
      <Field
        id="user-email"
        label={t("user.create.email")}
        hint={t("user.create.emailHint")}
        error={
          fieldErrors.email === undefined ? undefined : (
            <DescriptorText t={t} descriptor={fieldErrors.email} />
          )
        }
        required
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={EMAIL_MAX_LENGTH}
            value={values.email}
            disabled={busy}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        )}
      </Field>
      <RoleChoices
        t={t}
        idPrefix="user-role"
        legend={t("user.create.role")}
        value={values.role}
        disabled={busy}
        error={
          fieldErrors.role === undefined ? undefined : (
            <DescriptorText t={t} descriptor={fieldErrors.role} />
          )
        }
        onChange={onRoleChange}
      />
      <NewPasswordField
        t={t}
        id="user-password"
        name="password"
        label={t("user.create.password")}
        value={values.password}
        email={values.email}
        visible={passwordVisible}
        generated={passwordGenerated}
        {...(fieldErrors.password === undefined ? {} : { error: fieldErrors.password })}
        disabled={busy}
        onChange={onPasswordChange}
        onToggleVisible={onTogglePassword}
        onGenerate={onGeneratePassword}
      />
      <p className="max-w-prose text-sm text-muted-foreground">{t("user.create.handoverHint")}</p>
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? t("user.create.submitting") : t("user.create.submit")}
        </Button>
      </div>
    </form>
  );
}

/**
 * After a create the API answered: a focused panel with the stored user. The password is NOT shown again; the text says
 * that the owner hands it over outside this admin (no email exists) and that the user should change it.
 */
export function CreatedPanel({
  t,
  user,
  panelRef,
  onCreateAnother,
}: {
  t: Translator;
  user: AdminUser;
  panelRef?: Ref<HTMLDivElement>;
  onCreateAnother: () => void;
}) {
  return (
    <div ref={panelRef} tabIndex={-1} className={`flex flex-col gap-4 ${focusClass}`}>
      <Alert variant="success" title={t("user.created.title")}>
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-2">
            <span className="break-all font-medium">{user.email}</span>
            <RoleBadge t={t} role={user.role} />
          </p>
          <p>{t("user.created.passwordNotShown")}</p>
          <p>{t("user.created.handover")}</p>
          <p>{t("user.created.changeIt")}</p>
        </div>
      </Alert>
      <div className="flex flex-wrap items-center gap-4">
        <Link to={userHref(user.id)} className={linkClass}>
          {t("user.created.openUser")}
        </Link>
        <Link to={PATHS.users} className={linkClass}>
          {t("user.created.toList")}
        </Link>
        <Button variant="secondary" onClick={onCreateAnother}>
          {t("user.created.another")}
        </Button>
      </div>
    </div>
  );
}

/**
 * After a create whose answer never arrived: what the bounded read of the list found. It never claims that this request
 * created the user; the password typed is gone (cleared), so a found user needs a password reset to be usable.
 */
export function CreateUnknownView({
  t,
  lookup,
}: {
  t: Translator;
  /** `null` while the list is being read. */
  lookup: LookupResult | null;
}) {
  return (
    <Alert variant="warning" title={t("user.create.unknownTitle")}>
      {lookup === null ? (
        <p>{t("user.create.unknownReading")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p>{t(`user.create.unknown.${lookup.kind}`)}</p>
          {lookup.kind === "found" ? (
            <p>
              <Link to={userHref(lookup.user.id)} className={linkClass}>
                {t("user.create.unknownOpen")}
              </Link>
            </p>
          ) : null}
        </div>
      )}
    </Alert>
  );
}

export function CreateUserScreen({ t, children }: { t: Translator; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link to={PATHS.users} className={linkClass}>
          {t("user.back")}
        </Link>
      </p>
      <PageHeading>{t("page.userNew.title")}</PageHeading>
      {children}
    </div>
  );
}
