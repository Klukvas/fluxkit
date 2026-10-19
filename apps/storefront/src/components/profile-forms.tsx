"use client";

import type { Customer } from "@fluxkit/api-client";
import { Alert, Button, Container, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { FormEvent, Ref } from "react";
import { useState } from "react";
import type { Failure } from "../lib/failure";
import { localizedHref } from "../lib/locale-path";
import { AccountGate } from "./account-gate";
import { FormErrorSummary, TextField } from "./form-parts";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";
import { useForm } from "./use-form";

export const PROFILE_FIELDS = ["firstName", "lastName", "phone"] as const;
export const PROFILE_IDS = {
  firstName: "profile-first-name",
  lastName: "profile-last-name",
  phone: "profile-phone",
} as const;
export const PASSWORD_FIELDS = ["currentPassword", "newPassword"] as const;
export const PASSWORD_IDS = {
  currentPassword: "password-current",
  newPassword: "password-new",
} as const;

type ProfileField = (typeof PROFILE_FIELDS)[number];
type PasswordField = (typeof PASSWORD_FIELDS)[number];

interface FormViewBase {
  t: Translator;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  failure: Failure | null;
  /** Set after a successful save: a polite status message. */
  saved: boolean;
  summaryRef: Ref<HTMLDivElement>;
}

export function ProfileFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  saved,
  summaryRef,
}: FormViewBase & {
  values: Record<ProfileField, string>;
  onValueChange: (name: ProfileField, value: string) => void;
}) {
  const labels = {
    firstName: t("account.field.firstName"),
    lastName: t("account.field.lastName"),
    phone: t("account.field.phoneOptional"),
  };
  const field = (name: ProfileField) => ({
    id: PROFILE_IDS[name],
    name,
    label: labels[name],
    failure,
    t,
    value: values[name],
    onValueChange: (value: string) => onValueChange(name, value),
  });
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-xl font-semibold text-foreground">{t("account.profile.title")}</h2>
      <FormErrorSummary
        failure={failure}
        t={t}
        labels={labels}
        ids={PROFILE_IDS}
        summaryRef={summaryRef}
      />
      <TextField {...field("firstName")} autoComplete="given-name" maxLength={100} />
      <TextField {...field("lastName")} autoComplete="family-name" maxLength={100} />
      <TextField
        {...field("phone")}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required={false}
      />
      <Button type="submit" disabled={pending}>
        {pending ? t("account.profile.saving") : t("account.profile.save")}
      </Button>
      <div role="status">
        {saved ? <Alert variant="success">{t("account.profile.saved")}</Alert> : null}
      </div>
    </form>
  );
}

export function PasswordFormView({
  t,
  values,
  onValueChange,
  onSubmit,
  pending,
  failure,
  saved,
  summaryRef,
}: FormViewBase & {
  values: Record<PasswordField, string>;
  onValueChange: (name: PasswordField, value: string) => void;
}) {
  const labels = {
    currentPassword: t("account.field.currentPassword"),
    newPassword: t("account.field.newPassword"),
  };
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={pending}
      className="flex max-w-md flex-col gap-4"
    >
      <h2 className="text-xl font-semibold text-foreground">{t("account.password.title")}</h2>
      <FormErrorSummary
        failure={failure}
        t={t}
        labels={labels}
        ids={PASSWORD_IDS}
        summaryRef={summaryRef}
      />
      <TextField
        id={PASSWORD_IDS.currentPassword}
        name="currentPassword"
        label={labels.currentPassword}
        failure={failure}
        t={t}
        type="password"
        autoComplete="current-password"
        value={values.currentPassword}
        onValueChange={(value) => onValueChange("currentPassword", value)}
      />
      <TextField
        id={PASSWORD_IDS.newPassword}
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
      <Button type="submit" disabled={pending}>
        {pending ? t("account.password.saving") : t("account.password.save")}
      </Button>
      <div role="status">
        {saved ? <Alert variant="success">{t("account.password.saved")}</Alert> : null}
      </div>
    </form>
  );
}

function ProfileForm({ customer }: { customer: Customer }) {
  const { t } = useI18n();
  const { store } = useAccount();
  const [saved, setSaved] = useState(false);
  const form = useForm<Record<ProfileField, string>>({
    initial: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone ?? "",
    },
    fieldOrder: PROFILE_FIELDS,
    fieldIds: PROFILE_IDS,
  });
  return (
    <ProfileFormView
      t={t}
      values={form.values}
      onValueChange={(name, value) => {
        setSaved(false);
        form.setValue(name, value);
      }}
      pending={form.pending}
      failure={form.failure}
      saved={saved}
      summaryRef={form.summaryRef}
      onSubmit={(event) =>
        form.submit(event, {
          required: ["firstName", "lastName"],
          leaves: false,
          run: async (values) => {
            setSaved(false);
            const phone = values.phone.trim();
            const outcome = await store.updateProfile({
              firstName: values.firstName.trim(),
              lastName: values.lastName.trim(),
              // An empty phone removes it (the API: `phone: null`).
              phone: phone === "" ? null : phone,
            });
            if (outcome.status === "ok") {
              setSaved(true);
              return null;
            }
            // A lost session (`signedOut`) turns the account gate into the sign-in redirect on its own.
            return outcome.status === "failed" ? outcome.failure : null;
          },
        })
      }
    />
  );
}

function PasswordForm() {
  const { t } = useI18n();
  const { store } = useAccount();
  const [saved, setSaved] = useState(false);
  const form = useForm<Record<PasswordField, string>>({
    initial: { currentPassword: "", newPassword: "" },
    fieldOrder: PASSWORD_FIELDS,
    fieldIds: PASSWORD_IDS,
  });
  return (
    <PasswordFormView
      t={t}
      values={form.values}
      onValueChange={(name, value) => {
        setSaved(false);
        form.setValue(name, value);
      }}
      pending={form.pending}
      failure={form.failure}
      saved={saved}
      summaryRef={form.summaryRef}
      onSubmit={(event) =>
        form.submit(event, {
          required: PASSWORD_FIELDS,
          leaves: false,
          run: async (values) => {
            setSaved(false);
            const outcome = await store.changePassword(values);
            if (outcome.status === "ok") {
              // Both passwords leave the form's memory as soon as the change is done.
              form.setValues({ currentPassword: "", newPassword: "" });
              setSaved(true);
              return null;
            }
            return outcome.status === "failed" ? outcome.failure : null;
          },
        })
      }
    />
  );
}

/** `/account/profile`: edit the names and the phone, and change the password. */
export function ProfilePage() {
  const { locale, t } = useI18n();
  return (
    <AccountGate>
      {(customer) => (
        <Container className="flex flex-col gap-10 py-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold text-foreground">{t("account.profile.heading")}</h1>
            <Link
              href={localizedHref(locale, "/account")}
              className="self-start underline underline-offset-4"
            >
              {t("account.profile.back")}
            </Link>
          </div>
          <ProfileForm customer={customer} />
          <PasswordForm />
        </Container>
      )}
    </AccountGate>
  );
}
