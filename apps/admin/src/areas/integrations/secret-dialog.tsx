import type { AdminIntegration, AdminIntegrationSecret } from "@fluxkit/api-client";
import { useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n-context";
import { adminClient } from "../../lib/api";
import type { MessageDescriptor } from "../../lib/problem-messages";
import { runWrite } from "../../lib/run-write";
import { createSingleFlight } from "../../lib/single-flight";
import { useFocusAfterCommit } from "../../lib/use-focus-after-commit";
import { useSession } from "../../session/session-context";
import {
  SECRET_FORM_FIELDS,
  localSecretErrors,
  secretProblemErrors,
  type SecretFormField,
} from "./integrations-errors";
import { labelText, type SecretAction } from "./integrations-list-view";
import { providerLabel, secretFieldLabel } from "./integrations-view";
import {
  SECRET_PASSWORD_INPUT_ID,
  SECRET_VALUE_INPUT_ID,
  SecretDialogView,
} from "./secret-dialog-view";
import { secretHolder, useSecretValues } from "./use-secret-values";

/** What the open dialog changes: ids and names only, never a value. */
export interface SecretDialogTarget {
  action: SecretAction;
  integration: AdminIntegration;
  secret: AdminIntegrationSecret;
}

/** How a dialog ended when it did not simply stay open with an error. */
export type SecretDialogResult = "saved" | "removed" | "stale" | "unknown";

type SecretValuesState = Record<SecretFormField, string>;
const BLANK: SecretValuesState = { value: "", currentPassword: "" };
const INPUT_IDS: Record<SecretFormField, string> = {
  value: SECRET_VALUE_INPUT_ID,
  currentPassword: SECRET_PASSWORD_INPUT_ID,
};

interface ShownErrors {
  fields: Partial<Record<SecretFormField, MessageDescriptor>>;
  form: MessageDescriptor[];
}
const NO_ERRORS: ShownErrors = { fields: {}, form: [] };

/**
 * The mounted save or remove dialog. It is rendered only while open, so closing it drops its state; the typed key and
 * password live in `useSecretValues` and are taken out of it for exactly one request, whatever the answer. One request
 * per submit, never repeated: a lost answer closes the dialog and the screen reads the list again.
 */
export function SecretDialog({
  target,
  revision,
  onClose,
  onDone,
}: {
  target: SecretDialogTarget;
  /** The `revision` of the list the owner is looking at. */
  revision: number;
  onClose: () => void;
  onDone: (result: SecretDialogResult) => void;
}) {
  const { t } = useI18n();
  const session = useSession();
  const secrets = useSecretValues(BLANK, secretHolder(session.state), onClose);
  const [errors, setErrors] = useState<ShownErrors>(NO_ERRORS);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const focusAfterCommit = useFocusAfterCommit();
  const isRemoval = target.action === "remove";

  function show(next: ShownErrors) {
    setErrors(next);
    if (next.form.length > 0) focusAfterCommit(formErrorRef);
    else {
      const first = SECRET_FORM_FIELDS.find((field) => next.fields[field] !== undefined);
      // After a request both inputs are empty again; the first one is where the owner starts over.
      focusAfterCommit(INPUT_IDS[first ?? (isRemoval ? "currentPassword" : "value")]);
    }
  }

  function close() {
    if (busy || flight.pending()) return;
    secrets.wipe();
    onClose();
  }

  function send(taken: SecretValuesState) {
    const { integration, secret } = target;
    if (isRemoval) {
      return adminClient.retireIntegrationSecret(integration.id, {
        expectedRevision: revision,
        versionId: secret.versionId ?? "",
        currentPassword: taken.currentPassword,
      });
    }
    return adminClient.putIntegrationSecret(integration.id, secret.field, {
      expectedRevision: revision,
      value: taken.value.trim(),
      currentPassword: taken.currentPassword,
    });
  }

  async function submit() {
    if (flight.pending()) return;
    const local = localSecretErrors(
      isRemoval ? { currentPassword: secrets.values.currentPassword } : secrets.values,
    );
    if (Object.keys(local).length > 0) {
      show({ fields: local, form: [] });
      return;
    }
    const taken = secrets.take();
    const running = flight.run(() => runWrite(() => send(taken)));
    if (running === null) return;
    setBusy(true);
    try {
      const outcome = await running;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "ok") onDone(isRemoval ? "removed" : "saved");
      else if (outcome.kind === "unknown") onDone("unknown");
      else {
        const mapped = secretProblemErrors(outcome.status, outcome.problem, outcome.retryAfter);
        if (mapped.stale) onDone("stale");
        else show({ fields: mapped.fields, form: mapped.form });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <SecretDialogView
      t={t}
      action={target.action}
      field={labelText(t, secretFieldLabel(target.secret.field))}
      provider={labelText(t, providerLabel(target.integration.providerCode))}
      values={secrets.values}
      fieldErrors={errors.fields}
      formErrors={errors.form}
      busy={busy}
      onChange={(field, value) => secrets.set({ ...secrets.values, [field]: value })}
      onSubmit={() => void submit()}
      onClose={close}
      formErrorRef={formErrorRef}
    />
  );
}
