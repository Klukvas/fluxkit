import type {
  AdminIntegration,
  AdminIntegrationKind,
  AdminIntegrationSecret,
  AdminIntegrationStorage,
} from "@fluxkit/api-client";
import type { StatusTone } from "@fluxkit/ui";

/**
 * How the Integrations screen presents what the API answers (`docs/api/integrations.md`). Pure. The list is data: a
 * provider or a secret field this file does not know still renders, under its own code. No answer carries a secret, so
 * nothing here can show one.
 */

/** The kinds in the order of the screen's sections. */
export const INTEGRATION_KINDS = [
  "email",
  "payment",
  "shipping",
] as const satisfies readonly AdminIntegrationKind[];

/** Provider codes with a translated name (`intg.provider.<code>`); any other code is shown as it is. */
export const KNOWN_PROVIDER_CODES = ["resend", "brevo", "monobank", "nova_post", "fake"] as const;

/** Secret fields with a translated label (`intg.field.<field>`); any other field is shown by its name. */
export const KNOWN_SECRET_FIELDS = ["api_key", "webhook_secret", "token"] as const;

/** A label that is either a message key or, for a code the screen does not know, the code itself. */
export type Label = { key: string } | { text: string };

export function providerLabel(code: string): Label {
  return (KNOWN_PROVIDER_CODES as readonly string[]).includes(code)
    ? { key: `intg.provider.${code}` }
    : { text: code };
}

export function secretFieldLabel(field: string): Label {
  return (KNOWN_SECRET_FIELDS as readonly string[]).includes(field)
    ? { key: `intg.field.${field}` }
    : { text: field };
}

export interface IntegrationGroup {
  kind: AdminIntegrationKind;
  items: AdminIntegration[];
}

/** The providers by kind, in the order of `INTEGRATION_KINDS`, each group by provider code; empty kinds are left out. */
export function groupByKind(items: readonly AdminIntegration[]): IntegrationGroup[] {
  return INTEGRATION_KINDS.map((kind) => ({
    kind,
    items: items
      .filter((item) => item.kind === kind)
      .sort((a, b) => a.providerCode.localeCompare(b.providerCode, "en")),
  })).filter((group) => group.items.length > 0);
}

export interface SecretView {
  statusKey: string;
  tone: StatusTone;
  /** The server variable that holds the value, named only while it does (`env`). */
  envVariable: string | null;
  /** When the stored value was saved; null without a stored value. */
  savedAt: string | null;
  /** The server can no longer decrypt the stored value: it has to be entered again. */
  needsReentry: boolean;
  /** `null`: no enter control at all (the server environment decides the value). */
  enter: { mode: "enter" | "replace"; disabled: boolean } | null;
  /** The stored version a "Remove" would retire; null when nothing is stored. */
  removableVersionId: string | null;
}

/**
 * One secret as the screen shows it. A value set on the server is read-only here, but a version stored earlier can still
 * be removed. With storage `disabled` nothing can be saved (the control stays, disabled, so the reason next to it makes
 * sense); removing needs no encryption key.
 */
export function secretView(
  secret: AdminIntegrationSecret,
  storage: AdminIntegrationStorage,
): SecretView {
  const stored = secret.versionId !== null;
  return {
    statusKey: `intg.state.${secret.state}`,
    tone: secret.state === "not_set" ? "neutral" : secret.state === "env" ? "success" : "warning",
    envVariable: secret.state === "env" ? secret.envVariable : null,
    savedAt: stored ? secret.savedAt : null,
    needsReentry: secret.keyAvailable === false,
    enter:
      secret.state === "env"
        ? null
        : { mode: stored ? "replace" : "enter", disabled: storage === "disabled" },
    removableVersionId: secret.versionId,
  };
}
