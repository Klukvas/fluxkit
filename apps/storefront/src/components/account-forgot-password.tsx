"use client";

import { Button, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useMemo, useState, type FormEvent, type Ref } from "react";
import { createAccountEmailFlows } from "../lib/account-email-flows";
import type { Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { EmailPageFrame, EmailUnavailableView, useHeadingFocus } from "./account-email-parts";
import { FormErrorSummary, TextField } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { useStoreClient } from "./session-provider";
import { linkButton } from "./styles";
import { useForm } from "./use-form";

export const FORGOT_FIELDS = ["email"] as const;
export const FORGOT_IDS = { email: "forgot-email" } as const;

export interface ForgotPasswordFormViewProps {
  t: Translator;
  values: { email: string };
  onValueChange: (name: "email", value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  failure: Failure | null;
  summaryRef: Ref<HTMLDivElement>;
  signInHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** The request form. `method="post"` like every form: a submit before hydration must never put the address into a URL. */
export function ForgotPasswordFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  summaryRef,
  signInHref,
  headingRef,
}: ForgotPasswordFormViewProps) {
  const labels = { email: t("account.field.email") };
  return (
    <EmailPageFrame title={t("account.forgot.title")} headingRef={headingRef} busy={pending}>
      <p className="text-foreground">{t("account.forgot.description")}</p>
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
          ids={FORGOT_IDS}
          summaryRef={summaryRef}
        />
        <TextField
          id={FORGOT_IDS.email}
          name="email"
          label={labels.email}
          failure={failure}
          t={t}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={values.email}
          onValueChange={(value) => onValueChange("email", value)}
        />
        <Button type="submit" disabled={pending}>
          {pending ? t("account.forgot.submitting") : t("account.forgot.submit")}
        </Button>
      </form>
      <Link href={signInHref} className="self-start underline underline-offset-4">
        {t("account.forgot.back")}
      </Link>
    </EmailPageFrame>
  );
}

/**
 * The ONE answer to a request, the same for an address with an account and one without: it names no address and says
 * "if an account exists". Its heading takes the focus, and a polite live region repeats it for assistive technology.
 */
export function ForgotPasswordSentView({
  t,
  onAnother,
  signInHref,
  headingRef,
}: {
  t: Translator;
  onAnother: () => void;
  signInHref: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <EmailPageFrame title={t("account.forgot.sent.title")} headingRef={headingRef}>
      <p role="status" className="text-foreground">
        {t("account.forgot.sent.description")}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href={signInHref} className={linkButton}>
          {t("account.forgot.back")}
        </Link>
        <Button variant="secondary" onClick={onAnother}>
          {t("account.forgot.another")}
        </Button>
      </div>
    </EmailPageFrame>
  );
}

export function ForgotPasswordPage({ emailDelivery }: { emailDelivery: boolean }) {
  const { locale, t } = useI18n();
  const client = useStoreClient();
  const flows = useMemo(() => createAccountEmailFlows(client), [client]);
  const [phase, setPhase] = useState<"form" | "sent" | "unavailable">("form");
  const form = useForm({
    initial: { email: "" },
    fieldOrder: FORGOT_FIELDS,
    fieldIds: FORGOT_IDS,
  });
  const headingRef = useHeadingFocus(phase !== "form");
  const signInHref = localizedHref(locale, "/account/login");

  if (!emailDelivery || phase === "unavailable") {
    return <EmailUnavailableView t={t} signInHref={signInHref} headingRef={headingRef} />;
  }
  if (phase === "sent") {
    return (
      <ForgotPasswordSentView
        t={t}
        signInHref={signInHref}
        headingRef={headingRef}
        onAnother={() => {
          form.setValue("email", "");
          setPhase("form");
        }}
      />
    );
  }
  return (
    <ForgotPasswordFormView
      t={t}
      values={form.values}
      onValueChange={form.setValue}
      pending={form.pending}
      failure={form.failure}
      summaryRef={form.summaryRef}
      signInHref={signInHref}
      headingRef={headingRef}
      onSubmit={(event) =>
        form.submit(event, {
          required: FORGOT_FIELDS,
          leaves: false,
          run: async (values) => {
            const outcome = await flows.requestPasswordReset({
              email: values.email.trim(),
              locale,
            });
            if (outcome.status === "sent") {
              setPhase("sent");
              return null;
            }
            if (outcome.status === "unavailable") {
              setPhase("unavailable");
              return null;
            }
            return outcome.failure;
          },
        })
      }
    />
  );
}
