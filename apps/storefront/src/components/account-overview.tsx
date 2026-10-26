"use client";

import type { Customer } from "@fluxkit/api-client";
import { Alert, Button, Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { failureText, type Failure } from "../lib/failure";
import { formatDate } from "../lib/date";
import { localizedHref } from "../lib/locale-path";
import { AccountGate } from "./account-gate";
import { VerifyEmailNotice } from "./account-verify-notice";
import { useI18n } from "./i18n-provider";
import { useAccount } from "./session-provider";
import { linkButton } from "./styles";

/** The signed-in customer's overview: who they are, a way to edit the profile, and sign out. */
export function AccountOverviewView({
  customer,
  t,
  locale,
  pending,
  failure,
  onLogout,
  emailDelivery = false,
  emailNotice = null,
}: {
  customer: Customer;
  t: Translator;
  locale: Locale;
  pending: boolean;
  failure: Failure | null;
  onLogout: () => void;
  /** The shop sends email: the address shows whether it is confirmed. */
  emailDelivery?: boolean;
  /** The "confirm your address" notice with its "send again" control (a client island, so the caller builds it). */
  emailNotice?: ReactNode;
}) {
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t("account.title")}</h1>
      {emailNotice}
      <h2 className="text-xl font-semibold text-foreground">{t("account.overview.profile")}</h2>
      <dl className="flex max-w-md flex-col gap-2 text-foreground">
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("account.field.firstName")}</dt>
          <dd className="min-w-0">{customer.firstName}</dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("account.field.lastName")}</dt>
          <dd className="min-w-0">{customer.lastName}</dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("account.field.email")}</dt>
          <dd className="min-w-0 break-all">
            {customer.email}
            {emailDelivery && customer.emailVerified ? (
              <span className="ms-2 text-sm text-muted-foreground">
                {t("account.verifyNotice.verified")}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("account.field.phone")}</dt>
          <dd className="min-w-0">{customer.phone ?? t("account.overview.noPhone")}</dd>
        </div>
        <div className="flex flex-wrap gap-x-6">
          <dt className="w-40 text-muted-foreground">{t("account.overview.since")}</dt>
          <dd className="min-w-0">{formatDate(customer.createdAt, locale)}</dd>
        </div>
      </dl>
      {failure === null ? null : <Alert variant="danger">{failureText(t, failure)}</Alert>}
      <div className="flex flex-wrap gap-3">
        <Link href={localizedHref(locale, "/account/orders")} className={linkButton}>
          {t("account.overview.orders")}
        </Link>
        <Link href={localizedHref(locale, "/account/profile")} className={linkButton}>
          {t("account.overview.edit")}
        </Link>
        <Button variant="secondary" onClick={onLogout} disabled={pending} aria-busy={pending}>
          {pending ? t("account.logout.pending") : t("account.logout")}
        </Button>
      </div>
    </Container>
  );
}

export function AccountOverview({ emailDelivery }: { emailDelivery: boolean }) {
  const { locale, t } = useI18n();
  const { store } = useAccount();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function logout(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailure(null);
    try {
      const outcome = await store.logout();
      if (outcome.status === "failed") {
        setFailure(outcome.failure);
        setPending(false);
        return;
      }
      router.replace(localizedHref(locale, "/"));
    } catch (error) {
      setPending(false);
      throw error;
    }
  }

  return (
    <AccountGate titleKey="account.title">
      {(customer) => (
        <AccountOverviewView
          customer={customer}
          t={t}
          locale={locale}
          pending={pending}
          failure={failure}
          onLogout={() => void logout()}
          emailDelivery={emailDelivery}
          emailNotice={<VerifyEmailNotice customer={customer} emailDelivery={emailDelivery} />}
        />
      )}
    </AccountGate>
  );
}
