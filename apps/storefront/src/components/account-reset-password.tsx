"use client";

import { Button, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type Ref } from "react";
import { createAccountEmailFlows } from "../lib/account-email-flows";
import type { Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { checkNewPasswords } from "../lib/reset-password-form";
import {
  CheckingView,
  EmailPageFrame,
  EmailUnavailableView,
  useHeadingFocus,
} from "./account-email-parts";
import { FormErrorSummary, TextField } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { useAccount, useStoreClient } from "./session-provider";
import { linkButton } from "./styles";
import { useFragmentToken } from "./use-fragment-token";
import { useForm } from "./use-form";

export const RESET_FIELDS = ["newPassword", "confirmPassword"] as const;
export const RESET_IDS = {
  newPassword: "reset-new-password",
  confirmPassword: "reset-confirm-password",
} as const;

type ResetField = (typeof RESET_FIELDS)[number];

export interface ResetPasswordFormViewProps {
  t: Translator;
  values: Record<ResetField, string>;
  onValueChange: (name: ResetField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  failure: Failure | null;
  summaryRef: Ref<HTMLDivElement>;
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The new-password form: the registration policy as a hint (the API stays the judge and its answer for the field is shown
 * through `errors.field.*`), a second field for the same password. `method="post"` like every form, though the form only
 * exists after the token was read in the browser.
 */
export function ResetPasswordFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  summaryRef,
  headingRef,
}: ResetPasswordFormViewProps) {
  const labels = {
    newPassword: t("account.field.newPassword"),
    confirmPassword: t("account.field.confirmPassword"),
  };
  return (
    <EmailPageFrame title={t("account.reset.title")} headingRef={headingRef} busy={pending}>
      <form
        method="post"
        onSubmit={onSubmit}
        noValidate
        aria-busy={pending}
        className="flex flex-col gap-4"
      >
        <FormErrorSummary
          failure={failure}
          t={t}
          labels={labels}
          ids={RESET_IDS}
          summaryRef={summaryRef}
        />
        <TextField
          id={RESET_IDS.newPassword}
          name="newPassword"
          label={labels.newPassword}
          failure={failure}
          t={t}
          type="password"
          autoComplete="new-password"
          hint={t("account.password.rules")}
          minLength={12}
          maxLength={128}
          value={values.newPassword}
          onValueChange={(value) => onValueChange("newPassword", value)}
        />
        <TextField
          id={RESET_IDS.confirmPassword}
          name="confirmPassword"
          label={labels.confirmPassword}
          failure={failure}
          t={t}
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={values.confirmPassword}
          onValueChange={(value) => onValueChange("confirmPassword", value)}
        />
        <Button type="submit" disabled={pending}>
          {pending ? t("account.reset.submitting") : t("account.reset.submit")}
        </Button>
      </form>
    </EmailPageFrame>
  );
}

/** The password was changed. No automatic sign-in: the person signs in with the new password. */
export function ResetPasswordDoneView({
  t,
  signInHref,
  headingRef,
}: {
  t: Translator;
  signInHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.reset.done.title")} headingRef={headingRef}>
      <p role="status" className="text-foreground">
        {t("account.reset.done.description")}
      </p>
      <Link href={signInHref} className={`${linkButton} self-start`}>
        {t("account.emailPage.signIn")}
      </Link>
    </EmailPageFrame>
  );
}

/** One state for a link that is missing, malformed, unknown, used, expired or replaced: nothing tells them apart. */
export function ResetPasswordInvalidView({
  t,
  requestHref,
  headingRef,
}: {
  t: Translator;
  requestHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.reset.invalid.title")} headingRef={headingRef}>
      <p role="status" className="text-foreground">
        {t("account.reset.invalid.description")}
      </p>
      <Link href={requestHref} className={`${linkButton} self-start`}>
        {t("account.reset.requestNew")}
      </Link>
    </EmailPageFrame>
  );
}

type Phase = "form" | "done" | "invalid" | "unavailable";

/**
 * `/{locale}/account/reset-password#t=<token>`. The token is read from the fragment in the browser only and removed from
 * the address bar at once (`useFragmentToken`); it lives in memory, goes into the body of the confirm call and nowhere
 * else (no URL, log, storage, title or error text). The page signs nobody in: the API ended every session of the account.
 */
export function ResetPasswordPage({ emailDelivery }: { emailDelivery: boolean }) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const { store: account } = useAccount();
  const flows = useMemo(() => createAccountEmailFlows(client), [client]);
  const token = useFragmentToken();
  const [phase, setPhase] = useState<Phase>("form");
  const form = useForm<Record<ResetField, string>>({
    initial: { newPassword: "", confirmPassword: "" },
    fieldOrder: RESET_FIELDS,
    fieldIds: RESET_IDS,
  });
  const headingRef = useHeadingFocus(phase !== "form");
  const signInHref = localizedHref(locale, "/account/login");
  const requestHref = localizedHref(locale, "/account/forgot-password");

  // A second link pasted into this tab starts over.
  useEffect(() => {
    setPhase("form");
  }, [token]);

  if (!emailDelivery || phase === "unavailable") {
    return <EmailUnavailableView t={t} signInHref={signInHref} headingRef={headingRef} />;
  }
  if (token === undefined) return <CheckingView t={t} title={t("account.reset.title")} />;
  if (token === null || phase === "invalid") {
    return <ResetPasswordInvalidView t={t} requestHref={requestHref} headingRef={headingRef} />;
  }
  if (phase === "done") {
    return <ResetPasswordDoneView t={t} signInHref={signInHref} headingRef={headingRef} />;
  }
  return (
    <ResetPasswordFormView
      t={t}
      values={form.values}
      onValueChange={form.setValue}
      pending={form.pending}
      failure={form.failure}
      summaryRef={form.summaryRef}
      headingRef={headingRef}
      onSubmit={(event) =>
        form.submit(event, {
          required: RESET_FIELDS,
          leaves: false,
          run: async (values) => {
            const mismatch = checkNewPasswords(values);
            if (mismatch !== null) return mismatch;
            const outcome = await flows.confirmPasswordReset(token, values.newPassword);
            if (outcome.status === "failed") return outcome.failure;
            // Both passwords leave the form's memory as soon as the call is answered, whatever the answer.
            form.setValues({ newPassword: "", confirmPassword: "" });
            if (outcome.status === "done") {
              // Every session of the account ended on the server: the header must stop saying "signed in".
              void account.refresh();
            }
            setPhase(outcome.status);
            return null;
          },
        })
      }
    />
  );
}
