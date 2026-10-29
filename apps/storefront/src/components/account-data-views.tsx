import { Alert, Button, type Translator } from "@fluxkit/ui";
import type { FormEvent, Ref } from "react";
import { failureText, type Failure } from "../lib/failure";
import { blockReasonKey, type ExportFailure, type WaitParts } from "../lib/personal-data";
import { FormErrorSummary, TextField } from "./form-parts";

/**
 * The two sections of "Your data" (privacy plan step 10), presentational: props in, markup out. Every text is a message
 * (`account.data.*`); the API's own wording never reaches the page. Containers: `account-data.tsx`.
 */

export const DELETE_FIELDS = ["password", "confirmWord"] as const;
export const DELETE_IDS = {
  password: "delete-password",
  confirmWord: "delete-confirm-word",
} as const;

export type ExportState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; file: string }
  | { status: "failed"; reason: ExportFailure };

/** A wait as a sentence ("in about 2 hours"), in the plural forms of the shopper's language. */
export function waitText(t: Translator, wait: WaitParts | null): string {
  if (wait === null) return t("account.data.limit.unknown");
  return wait.unit === "hours"
    ? t.plural("account.data.limit.hours", wait.count)
    : t.plural("account.data.limit.minutes", wait.count);
}

export function exportFailureText(t: Translator, reason: ExportFailure): string {
  switch (reason.kind) {
    case "rate_limited":
      return `${t("account.data.export.limited")} ${waitText(t, reason.wait)}`;
    case "too_large":
      return t("account.data.export.tooLarge");
    case "signed_out":
      return t("account.gate.redirecting");
    case "other":
      return failureText(t, reason.failure);
  }
}

/** "Download my data": the button and a status line that is always in the page (a live region needs to be there first). */
export function ExportSection({
  t,
  state,
  onDownload,
  statusRef,
}: {
  t: Translator;
  state: ExportState;
  onDownload: () => void;
  statusRef: Ref<HTMLDivElement>;
}) {
  const pending = state.status === "pending";
  return (
    <section aria-labelledby="data-export-heading" className="flex max-w-xl flex-col gap-3">
      <h2 id="data-export-heading" className="text-xl font-semibold text-foreground">
        {t("account.data.export.title")}
      </h2>
      <p className="text-foreground">{t("account.data.export.intro")}</p>
      <div>
        <Button variant="secondary" onClick={onDownload} disabled={pending} aria-busy={pending}>
          {pending ? t("account.data.export.pending") : t("account.data.export.button")}
        </Button>
      </div>
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        className="rounded-md outline-offset-2 focus:outline-2 focus:outline-ring"
      >
        {state.status === "done" ? (
          <Alert variant="success">
            <p>{t("account.data.export.done", { file: state.file })}</p>
            <p className="mt-1">{t("account.data.export.care")}</p>
          </Alert>
        ) : null}
        {state.status === "failed" ? (
          <Alert variant="danger">{exportFailureText(t, state.reason)}</Alert>
        ) : null}
      </div>
    </section>
  );
}

/** What deleting does, in three short lists: deleted, kept, not reachable. */
function DeleteExplanation({ t }: { t: Translator }) {
  return (
    <div className="flex flex-col gap-3 text-foreground">
      <p>{t("account.data.delete.intro")}</p>
      <div>
        <h3 className="font-semibold">{t("account.data.delete.deletesTitle")}</h3>
        <ul className="mt-1 list-disc ps-5">
          <li>{t("account.data.delete.deletesAccount")}</li>
          <li>{t("account.data.delete.deletesCart")}</li>
          <li>{t("account.data.delete.deletesMail")}</li>
        </ul>
      </div>
      <div>
        <h3 className="font-semibold">{t("account.data.delete.keepsTitle")}</h3>
        <p className="mt-1">{t("account.data.delete.keeps")}</p>
      </div>
      <p className="text-muted-foreground">{t("account.data.delete.limits")}</p>
    </div>
  );
}

/** The reasons a deletion is refused, in words, with what to do. Nothing was changed. */
export function BlockedView({
  t,
  reasons,
  innerRef,
}: {
  t: Translator;
  reasons: readonly string[];
  innerRef: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={innerRef}
      tabIndex={-1}
      className="rounded-md outline-offset-2 focus:outline-2 focus:outline-ring"
    >
      <Alert variant="warning" title={t("account.data.blocked.title")}>
        <p>{t("account.data.blocked.intro")}</p>
        {reasons.length === 0 ? null : (
          <ul className="mt-2 list-disc ps-5">
            {reasons.map((reason) => (
              <li key={reason}>{t(blockReasonKey(reason))}</li>
            ))}
          </ul>
        )}
      </Alert>
    </div>
  );
}

export interface DeleteSectionProps {
  t: Translator;
  values: Record<(typeof DELETE_FIELDS)[number], string>;
  onValueChange: (name: (typeof DELETE_FIELDS)[number], value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  /** Field errors and general failures of the last submit, or `null`. */
  failure: Failure | null;
  /** The reasons of a refusal (`erasure_blocked`), or `null`. */
  blocked: readonly string[] | null;
  /** The wait after a rate-limit refusal, or `undefined` when there was none. */
  limited?: WaitParts | null;
  summaryRef: Ref<HTMLDivElement>;
  blockedRef: Ref<HTMLDivElement>;
}

/** "Delete my account": the password and the typed word are the explicit confirmation. */
export function DeleteSection({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  blocked,
  limited,
  summaryRef,
  blockedRef,
}: DeleteSectionProps) {
  const labels = {
    password: t("account.field.password"),
    confirmWord: t("account.data.delete.wordLabel", { word: t("account.data.delete.word") }),
  };
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      aria-labelledby="data-delete-heading"
      className="flex max-w-xl flex-col gap-4"
    >
      <h2 id="data-delete-heading" className="text-xl font-semibold text-foreground">
        {t("account.data.delete.title")}
      </h2>
      <DeleteExplanation t={t} />
      {blocked === null ? (
        <FormErrorSummary
          failure={failure}
          t={t}
          labels={labels}
          ids={DELETE_IDS}
          summaryRef={summaryRef}
        />
      ) : (
        <BlockedView t={t} reasons={blocked} innerRef={blockedRef} />
      )}
      {limited === undefined ? null : (
        <Alert variant="danger">
          {t("account.data.delete.limited")} {waitText(t, limited)}
        </Alert>
      )}
      <TextField
        id={DELETE_IDS.password}
        name="password"
        label={labels.password}
        failure={failure}
        t={t}
        type="password"
        autoComplete="current-password"
        value={values.password}
        onValueChange={(value) => onValueChange("password", value)}
      />
      <TextField
        id={DELETE_IDS.confirmWord}
        name="confirmWord"
        label={labels.confirmWord}
        hint={t("account.data.delete.wordHint")}
        failure={failure}
        t={t}
        autoComplete="off"
        spellCheck={false}
        value={values.confirmWord}
        onValueChange={(value) => onValueChange("confirmWord", value)}
      />
      <div>
        <Button type="submit" variant="danger" disabled={pending} aria-busy={pending}>
          {pending ? t("account.data.delete.submitting") : t("account.data.delete.submit")}
        </Button>
      </div>
    </form>
  );
}
