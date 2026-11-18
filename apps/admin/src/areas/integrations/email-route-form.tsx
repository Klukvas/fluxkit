import type { AdminEmailRouteMode } from "@fluxkit/api-client";
import { Button, Field, Input, type Translator } from "@fluxkit/ui";
import { useState } from "react";
import { adminClient } from "../../lib/api";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { secretProblemErrors } from "./integrations-errors";
import { useSecretValues, type PageLifecycleTarget } from "./use-secret-values";

const PASSWORD_ID = "email-route-password";
const BLANK = { currentPassword: "" };
const NO_PAGE: PageLifecycleTarget = {
  addEventListener() {
    /* static markup has no page lifecycle */
  },
  removeEventListener() {
    /* static markup has no page lifecycle */
  },
};

function pageTarget(): PageLifecycleTarget {
  return typeof window === "undefined" ? NO_PAGE : window;
}

export type EmailRouteResult = "routeSaved" | "stale" | "unknown";

/**
 * The Integrations choice for Resend and Brevo when both are in the send chain. `equal` shares new mail. `resend`
 * starts every message with Resend. A definite non-acceptance still tries the other. The password is asked again,
 * like every other change on this screen, and it stays in this form's secret hook: the page never sees it.
 */
export function EmailRouteForm({
  t,
  mode,
  revision,
  holder,
  busy,
  onDone,
}: {
  t: Translator;
  mode: AdminEmailRouteMode;
  revision: number;
  /** `secretHolder` of the session. A change wipes the typed password. */
  holder: string | null;
  busy: boolean;
  onDone: (result: EmailRouteResult) => void;
}) {
  const secrets = useSecretValues(BLANK, holder, () => undefined, pageTarget());
  const [choice, setChoice] = useState<AdminEmailRouteMode>(mode);
  const [flight] = useState(createSingleFlight);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const shown = localError ?? serverError;
  const locked = busy || submitting;

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (locked || flight.pending()) return;
    if (secrets.values.currentPassword === "") {
      setLocalError(t("intg.error.passwordRequired"));
      return;
    }
    setLocalError(null);
    const taken = secrets.take();
    const running = flight.run(() =>
      runWrite(() =>
        adminClient.setEmailRouteMode({
          mode: choice,
          expectedRevision: revision,
          currentPassword: taken.currentPassword,
        }),
      ),
    );
    if (running === null) return;
    setSubmitting(true);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "ok") {
        setServerError(null);
        onDone("routeSaved");
        return;
      }
      if (outcome.kind === "unknown") {
        onDone("unknown");
        return;
      }
      const mapped = secretProblemErrors(outcome.status, outcome.problem, outcome.retryAfter);
      if (mapped.stale) {
        onDone("stale");
        return;
      }
      const descriptor = mapped.fields.currentPassword ?? mapped.form[0];
      setServerError(descriptor === undefined ? null : t(descriptor.key, descriptor.values));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      <fieldset className="flex flex-col gap-2" disabled={locked}>
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
            value={secrets.values.currentPassword}
            onChange={(event) => secrets.set({ currentPassword: event.target.value })}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="secondary" disabled={locked}>
          {t("intg.route.save")}
        </Button>
      </div>
    </form>
  );
}
