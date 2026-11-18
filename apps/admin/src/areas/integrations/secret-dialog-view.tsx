import { Alert, Button, Dialog, Field, Input, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { SecretFormField } from "./integrations-errors";
import { PASSWORD_ONLY_ACTIONS, type SecretAction } from "./integrations-list-view";

export const SECRET_VALUE_INPUT_ID = "intg-secret-value";
export const SECRET_PASSWORD_INPUT_ID = "intg-secret-password";

/** The API's bounds, so a paste that cannot be accepted is cut by the browser, not sent. */
const VALUE_MAX_LENGTH = 4096;
const PASSWORD_MAX_LENGTH = 1024;

export interface SecretDialogViewProps {
  t: Translator;
  action: SecretAction;
  /** Translated names of what the dialog changes. */
  field: string;
  provider: string;
  values: Record<SecretFormField, string>;
  fieldErrors: Partial<Record<SecretFormField, MessageDescriptor>>;
  formErrors: readonly MessageDescriptor[];
  busy: boolean;
  onChange: (field: SecretFormField, value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  formErrorRef?: Ref<HTMLDivElement>;
}

/**
 * The save and the remove dialog. The two inputs hold what the owner types and nothing else does: `autoComplete="off"`
 * (plan, section 8: no password manager offer for a provider key, no stored copy of the form), no `name` a browser could
 * key a history entry on, and the values come from and go to the state of the mounted dialog only.
 */
export function SecretDialogView({
  t,
  action,
  field,
  provider,
  values,
  fieldErrors,
  formErrors,
  busy,
  onChange,
  onSubmit,
  onClose,
  formErrorRef,
}: SecretDialogViewProps) {
  const describe = (descriptor: MessageDescriptor) => t(descriptor.key, descriptor.values);
  const passwordOnly = (PASSWORD_ONLY_ACTIONS as readonly string[]).includes(action);
  const destructive = action === "remove" || action === "turnOff" || action === "revoke";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }
  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!busy}
      title={t(`intg.dialog.${action}.title`, { field, provider })}
      description={t(`intg.dialog.${action}.description`)}
      aria-busy={busy || undefined}
    >
      <form method="post" noValidate onSubmit={submit} className="flex flex-col gap-4">
        {formErrors.length === 0 ? null : (
          <div ref={formErrorRef} tabIndex={-1}>
            <Alert variant="danger">
              <ul className="flex flex-col gap-1">
                {formErrors.map((descriptor, index) => (
                  <li key={`${descriptor.key}-${String(index)}`}>
                    {describe(descriptor)}
                    {descriptor.code === undefined ? null : (
                      <small className="ms-2 text-muted-foreground">
                        {t("errors.reference", { code: descriptor.code })}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}
        {passwordOnly ? null : (
          <Field
            id={SECRET_VALUE_INPUT_ID}
            label={t("intg.dialog.value")}
            hint={t("intg.dialog.valueHint")}
            error={fieldErrors.value === undefined ? undefined : describe(fieldErrors.value)}
            required
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                data-autofocus=""
                maxLength={VALUE_MAX_LENGTH}
                value={values.value}
                onChange={(event) => onChange("value", event.target.value)}
              />
            )}
          </Field>
        )}
        <Field
          id={SECRET_PASSWORD_INPUT_ID}
          label={t("intg.dialog.password")}
          hint={t("intg.dialog.passwordHint")}
          error={
            fieldErrors.currentPassword === undefined
              ? undefined
              : describe(fieldErrors.currentPassword)
          }
          required
        >
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="off"
              data-autofocus={passwordOnly ? "" : undefined}
              maxLength={PASSWORD_MAX_LENGTH}
              value={values.currentPassword}
              onChange={(event) => onChange("currentPassword", event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            {t("intg.dialog.cancel")}
          </Button>
          <Button
            type="submit"
            variant={destructive ? "danger" : "primary"}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {t(`intg.dialog.${action}.${busy ? "submitting" : "submit"}`)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
