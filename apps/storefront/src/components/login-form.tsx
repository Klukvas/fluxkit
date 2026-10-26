"use client";

import { Alert, Button, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, Ref } from "react";
import type { SessionState } from "../lib/account-store";
import { authHref, safeNextPath } from "../lib/safe-next";
import { forgotPasswordHref } from "../lib/email-links";
import { localizedHref } from "../lib/locale-path";
import type { Failure } from "../lib/failure";
import { FormErrorSummary, TextField } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";
import { linkButton } from "./styles";
import { useForm } from "./use-form";

export const LOGIN_FIELDS = ["email", "password"] as const;
export const LOGIN_IDS = { email: "login-email", password: "login-password" } as const;

export interface LoginFormViewProps {
  t: Translator;
  values: { email: string; password: string };
  onValueChange: (name: "email" | "password", value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  failure: Failure | null;
  summaryRef: Ref<HTMLDivElement>;
  registerHref: string;
  /** The "Forgot password?" page; absent when the shop sends no email (`emailDelivery` false), so no link is shown. */
  forgotHref?: string | undefined;
}

/** Markup of the sign-in form. The password input is `current-password`, the email `email` (password managers rely on it). */
export function LoginFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  summaryRef,
  registerHref,
  forgotHref,
}: LoginFormViewProps) {
  const labels = {
    email: t("account.field.email"),
    password: t("account.field.password"),
  };
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <h1 className="text-3xl font-bold text-foreground">{t("account.login.title")}</h1>
      <FormErrorSummary
        failure={failure}
        t={t}
        labels={labels}
        ids={LOGIN_IDS}
        summaryRef={summaryRef}
      />
      <TextField
        id={LOGIN_IDS.email}
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
      <TextField
        id={LOGIN_IDS.password}
        name="password"
        label={labels.password}
        failure={failure}
        t={t}
        type="password"
        autoComplete="current-password"
        value={values.password}
        onValueChange={(value) => onValueChange("password", value)}
      />
      {forgotHref === undefined ? null : (
        <Link href={forgotHref} className="self-start underline underline-offset-4">
          {t("account.login.forgot")}
        </Link>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("account.login.submitting") : t("account.login.submit")}
      </Button>
      <p className="text-foreground">
        {t("account.login.noAccount")}{" "}
        <Link href={registerHref} className="underline underline-offset-4">
          {t("account.login.register")}
        </Link>
      </p>
    </form>
  );
}

/** Shown instead of a sign-in or register form when the visitor already has a session. */
export function AlreadySignedInView({
  t,
  locale,
  session,
}: {
  t: Translator;
  locale: Locale;
  session: Extract<SessionState, { status: "signedIn" }>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold text-foreground">{t("account.signedIn.title")}</h1>
      <Alert variant="success">
        {t("account.signedIn.description", { name: session.customer.firstName })}
      </Alert>
      <Link href={localizedHref(locale, "/account")} className={`${linkButton} self-start`}>
        {t("account.signedIn.account")}
      </Link>
    </div>
  );
}

export function LoginForm({
  next,
  emailDelivery,
}: {
  next: string | undefined;
  emailDelivery: boolean;
}) {
  const { locale, t } = useI18n();
  const { state, store } = useAccount();
  const router = useRouter();
  const form = useForm({
    initial: { email: "", password: "" },
    fieldOrder: LOGIN_FIELDS,
    fieldIds: LOGIN_IDS,
  });

  if (state.session.status === "signedIn") {
    return <AlreadySignedInView t={t} locale={locale} session={state.session} />;
  }
  return (
    <LoginFormView
      t={t}
      values={form.values}
      onValueChange={form.setValue}
      pending={form.pending}
      failure={form.failure}
      summaryRef={form.summaryRef}
      registerHref={authHref(locale, "register", next)}
      forgotHref={forgotPasswordHref(locale, emailDelivery)}
      onSubmit={(event) =>
        form.submit(event, {
          required: LOGIN_FIELDS,
          leaves: true,
          run: async (values) => {
            const outcome = await store.login({
              email: values.email.trim(),
              password: values.password,
            });
            if (outcome.status === "ok") {
              // Where to go comes from the URL, so it is checked first (`safeNextPath`): same-locale storefront paths only.
              router.replace(safeNextPath(next, locale));
              return null;
            }
            // A password is not kept after a refused sign-in.
            form.setValue("password", "");
            return outcome.status === "failed" ? outcome.failure : null;
          },
        })
      }
    />
  );
}
