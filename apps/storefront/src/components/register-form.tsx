"use client";

import { Button, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent, Ref } from "react";
import type { Failure } from "../lib/failure";
import { authHref, safeNextPath } from "../lib/safe-next";
import { FormErrorSummary, TextField } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { AlreadySignedInView } from "./login-form";
import { useAccount } from "./session-provider";
import { LegalNotice, noticeLinks } from "./legal-notice";
import { useForm } from "./use-form";

export const REGISTER_FIELDS = ["email", "password", "firstName", "lastName", "phone"] as const;
export const REGISTER_IDS = {
  email: "register-email",
  password: "register-password",
  firstName: "register-first-name",
  lastName: "register-last-name",
  phone: "register-phone",
} as const;
const REQUIRED = ["email", "password", "firstName", "lastName"] as const;

type RegisterField = (typeof REGISTER_FIELDS)[number];

export interface RegisterFormViewProps {
  t: Translator;
  values: Record<RegisterField, string>;
  onValueChange: (name: RegisterField, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  failure: Failure | null;
  summaryRef: Ref<HTMLDivElement>;
  loginHref: string;
  /** The Terms and Privacy notice pages for the information sentence above the button; omitted: no sentence. */
  noticeLinks?: { terms: string; privacy: string };
}

/**
 * Markup of the registration form. The password rules come from the API (12 to 128 characters, not the email) and are
 * stated as a hint; the API stays the judge, and its answer for each field is shown through `errors.field.*`.
 */
export function RegisterFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  summaryRef,
  loginHref,
  noticeLinks: legalLinks,
}: RegisterFormViewProps) {
  const labels = {
    email: t("account.field.email"),
    password: t("account.field.password"),
    firstName: t("account.field.firstName"),
    lastName: t("account.field.lastName"),
    phone: t("account.field.phone"),
  };
  const field = (name: RegisterField) => ({
    id: REGISTER_IDS[name],
    name,
    label: labels[name],
    failure,
    t,
    value: values[name],
    onValueChange: (value: string) => onValueChange(name, value),
  });
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="flex flex-col gap-4"
    >
      <h1 className="text-3xl font-bold text-foreground">{t("account.register.title")}</h1>
      <FormErrorSummary
        failure={failure}
        t={t}
        labels={labels}
        ids={REGISTER_IDS}
        summaryRef={summaryRef}
      />
      <TextField {...field("email")} type="email" inputMode="email" autoComplete="email" />
      <TextField
        {...field("password")}
        type="password"
        autoComplete="new-password"
        hint={t("account.password.rules")}
        minLength={12}
        maxLength={128}
      />
      <TextField {...field("firstName")} autoComplete="given-name" maxLength={100} />
      <TextField {...field("lastName")} autoComplete="family-name" maxLength={100} />
      <TextField
        {...field("phone")}
        label={t("account.field.phoneOptional")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={false}
      />
      {legalLinks === undefined ? null : <LegalNotice t={t} kind="register" links={legalLinks} />}
      <Button type="submit" disabled={pending}>
        {pending ? t("account.register.submitting") : t("account.register.submit")}
      </Button>
      <p className="text-foreground">
        {t("account.register.haveAccount")}{" "}
        <Link href={loginHref} className="underline underline-offset-4">
          {t("account.register.login")}
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next: string | undefined }) {
  const { locale, t } = useI18n();
  const { state, store } = useAccount();
  const router = useRouter();
  const form = useForm<Record<RegisterField, string>>({
    initial: { email: "", password: "", firstName: "", lastName: "", phone: "" },
    fieldOrder: REGISTER_FIELDS,
    fieldIds: REGISTER_IDS,
  });

  if (state.session.status === "signedIn") {
    return <AlreadySignedInView t={t} locale={locale} session={state.session} />;
  }
  return (
    <RegisterFormView
      t={t}
      values={form.values}
      onValueChange={form.setValue}
      pending={form.pending}
      failure={form.failure}
      summaryRef={form.summaryRef}
      loginHref={authHref(locale, "login", next)}
      noticeLinks={noticeLinks(locale)}
      onSubmit={(event) =>
        form.submit(event, {
          required: REQUIRED,
          leaves: true,
          run: async (values) => {
            const phone = values.phone.trim();
            const outcome = await store.register({
              email: values.email.trim(),
              password: values.password,
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              ...(phone === "" ? {} : { phone }),
            });
            if (outcome.status === "ok") {
              router.replace(safeNextPath(next, locale));
              return null;
            }
            return outcome.status === "failed" ? outcome.failure : null;
          },
        })
      }
    />
  );
}
