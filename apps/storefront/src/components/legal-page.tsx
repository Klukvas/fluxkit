import { Alert, Container, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import {
  LEGAL_PLACEHOLDER_MARKER,
  cookieTable,
  legalIdentity,
  type LegalPageSlug,
} from "../config/legal";
import { formatDate } from "../lib/date";
import { localizedHref } from "../lib/locale-path";
import { slotValues, splitMessage } from "../lib/rich-message";

/**
 * A legal page of the template (privacy plan step 10): neutral placeholder copy that says the shop must supply its own text,
 * the visible template marker, who runs the shop (from `config/legal.ts`, a visible placeholder while unset) and, on the
 * cookie page, the table of the cookies a shopper can receive. A server component: nothing here needs the browser.
 * TODO(fluxkit): legal review of the cookie statement before an EU launch.
 */

function Unset({ t }: { t: Translator }) {
  return <span className="text-muted-foreground">{t("legal.identity.unset")}</span>;
}

function Identity({ t }: { t: Translator }) {
  const rows: [string, string | null][] = [
    ["legal.identity.name", legalIdentity.shopLegalName],
    ["legal.identity.address", legalIdentity.shopLegalAddress],
    ["legal.identity.contact", legalIdentity.privacyContact],
  ];
  return (
    <section aria-labelledby="legal-identity" className="flex flex-col gap-3">
      <h2 id="legal-identity" className="text-xl font-semibold text-foreground">
        {t("legal.identity.title")}
      </h2>
      <dl className="flex max-w-xl flex-col gap-2 text-foreground">
        {rows.map(([key, value]) => (
          <div key={key} className="flex flex-wrap gap-x-6">
            <dt className="w-40 text-muted-foreground">{t(key)}</dt>
            <dd className="min-w-0 break-words">{value ?? <Unset t={t} />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CookieTable({ t }: { t: Translator }) {
  return (
    <section aria-labelledby="legal-cookie-table" className="flex flex-col gap-3">
      <h2 id="legal-cookie-table" className="text-xl font-semibold text-foreground">
        {t("legal.cookies.tableTitle")}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-xl text-start text-foreground">
          <caption className="sr-only">{t("legal.cookies.tableCaption")}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-2 pe-4 text-start">
                {t("legal.cookies.columnName")}
              </th>
              <th scope="col" className="py-2 pe-4 text-start">
                {t("legal.cookies.columnPurpose")}
              </th>
              <th scope="col" className="py-2 pe-4 text-start">
                {t("legal.cookies.columnWhen")}
              </th>
              <th scope="col" className="py-2 text-start">
                {t("legal.cookies.columnKept")}
              </th>
            </tr>
          </thead>
          <tbody>
            {cookieTable.map((row) => (
              <tr key={row.id} className="border-b border-border align-top">
                <th scope="row" className="py-2 pe-4 text-start font-mono font-normal">
                  {row.name}
                </th>
                <td className="py-2 pe-4">{t(`legal.cookies.row.${row.id}.purpose`)}</td>
                <td className="py-2 pe-4">{t(`legal.cookies.row.${row.id}.when`)}</td>
                <td className="py-2">{t(`legal.cookies.row.${row.id}.kept`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground">{t("legal.cookies.staff")}</p>
    </section>
  );
}

function PrivacyPointers({ t, locale }: { t: Translator; locale: Locale }) {
  const parts = splitMessage(t("legal.privacy.selfService", slotValues(["account"])), ["account"]);
  return (
    <section aria-labelledby="legal-rights" className="flex flex-col gap-2">
      <h2 id="legal-rights" className="text-xl font-semibold text-foreground">
        {t("legal.privacy.rightsTitle")}
      </h2>
      <p className="text-foreground">
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <span key={index}>{part.text}</span>
          ) : (
            <Link
              key={index}
              href={localizedHref(locale, "/account/data")}
              className="underline underline-offset-4"
            >
              {t("legal.privacy.accountLink")}
            </Link>
          ),
        )}
      </p>
      <p className="text-foreground">{t("legal.privacy.guests")}</p>
    </section>
  );
}

export function LegalPage({
  slug,
  locale,
  t,
}: {
  slug: LegalPageSlug;
  locale: Locale;
  t: Translator;
}) {
  const intro = t(`legal.${slug}.intro`);
  return (
    <Container className="flex flex-col gap-6 py-8">
      <h1 className="text-3xl font-bold text-foreground">{t(`legal.${slug}.title`)}</h1>
      {/* The box follows the text, not a message of its own: it goes away only when the shop replaced the text. */}
      {intro.includes(LEGAL_PLACEHOLDER_MARKER) ? (
        <Alert variant="warning" title={t("legal.placeholder.title")}>
          <p>{t("legal.placeholder.body")}</p>
        </Alert>
      ) : null}
      <p className="max-w-prose text-foreground">{intro}</p>
      <p className="text-muted-foreground">
        {legalIdentity.lastUpdated === null
          ? t("legal.updated.unset")
          : t("legal.updated", {
              date: formatDate(legalIdentity.lastUpdated, locale, { timeZone: "UTC" }),
            })}
      </p>
      {slug === "cookies" ? <CookieTable t={t} /> : null}
      {slug === "privacy" ? <PrivacyPointers t={t} locale={locale} /> : null}
      <Identity t={t} />
    </Container>
  );
}
