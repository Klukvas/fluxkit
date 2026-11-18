import type { AdminEmailRouteMode } from "@fluxkit/api-client";
import { Button, Field, Input, type Translator } from "@fluxkit/ui";
import { useState } from "react";

const PASSWORD_ID = "email-route-password";

/**
 * The Integrations choice for Resend and Brevo when both are in the send chain. `equal` shares new mail. `resend`
 * starts every message with Resend. A definite non-acceptance still tries the other. The password is asked again,
 * like every other change on this screen.
 */
export function EmailRouteForm({
  t,
  mode,
  busy,
  error,
  onSave,
}: {
  t: Translator;
  mode: AdminEmailRouteMode;
  busy: boolean;
  error: string | null;
  onSave: (mode: AdminEmailRouteMode, currentPassword: string) => void;
}) {
  const [choice, setChoice] = useState<AdminEmailRouteMode>(mode);
  const [password, setPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const shown = localError ?? error;

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (password === "") {
      setLocalError(t("intg.error.passwordRequired"));
      return;
    }
    setLocalError(null);
    onSave(choice, password);
  }

  return (
    <form method="post" noValidate onSubmit={submit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="font-medium">{t("intg.route.title")}</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="email-route-mode"
            value="equal"
            checked={choice === "equal"}
            onChange={() => setChoice("equal")}
          />
          <span>
            <span className="font-medium">{t("intg.route.equal")}</span>
            <span className="block text-muted-foreground">{t("intg.route.equalBody")}</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="email-route-mode"
            value="resend"
            checked={choice === "resend"}
            onChange={() => setChoice("resend")}
          />
          <span>
            <span className="font-medium">{t("intg.route.resend")}</span>
            <span className="block text-muted-foreground">{t("intg.route.resendBody")}</span>
          </span>
        </label>
      </fieldset>
      <Field id={PASSWORD_ID} label={t("intg.dialog.password")} error={shown ?? undefined} required>
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary" disabled={busy}>
          {t("intg.route.save")}
        </Button>
      </div>
    </form>
  );
}
