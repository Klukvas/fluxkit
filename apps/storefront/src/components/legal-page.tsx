import {
  Alert,
  Breadcrumbs,
  Container,
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import {
  LEGAL_PLACEHOLDER_MARKER,
  cookieTable,
  legalIdentity,
  legalSections,
  withoutLegalMarker,
  type LegalPageSlug,
} from "../config/legal";
import { demoContent } from "../config/demo-content";
import { Paragraphs } from "./paragraphs";
import { formatDate } from "../lib/date";
import { localizedHref } from "../lib/locale-path";
import { slotValues, splitMessage } from "../lib/rich-message";

/** Section-based default legal texts; server-rendered, with a review box until the fork reviews each page. */
function Unset({ t }: { t: Translator }) {
  return <span className="text-muted-foreground">{t("legal.identity.unset")}</span>;
}

function Identity({ t }: { t: Translator }) {
  const rows: [string, string | null][] = [
    ["legal.identity.name", legalIdentity.shopLegalName],
    ["legal.identity.taxId", legalIdentity.shopTaxId],
    ["legal.identity.address", legalIdentity.shopLegalAddress],
    ["legal.identity.phone", legalIdentity.shopPhone],
    ["legal.identity.email", legalIdentity.shopEmail],
    ...(!legalIdentity.shopEmail?.trim() || legalIdentity.privacyContact !== legalIdentity.shopEmail
      ? [["legal.identity.contact", legalIdentity.privacyContact] as [string, string | null]]
      : []),
  ];
  return (
    <section aria-labelledby="legal-identity" className="flex flex-col gap-3">
      <h2 id="legal-identity" className={textStyles.sectionTitle}>
        {t("legal.identity.title")}
      </h2>
      <dl className="flex max-w-xl flex-col gap-2 text-foreground">
        {rows.map(([key, value]) => (
          <div key={key} className="flex flex-wrap gap-x-6">
            <dt className="w-40 text-muted-foreground">{t(key)}</dt>
            <dd className="min-w-0 break-words">{value?.trim() ? value : <Unset t={t} />}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CookieTable({ t }: { t: Translator }) {
  return (
    <section aria-labelledby="legal-cookie-table" className="flex flex-col gap-3">
      <h2 id="legal-cookie-table" className={textStyles.sectionTitle}>
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

function PrivacyPointers({
  t,
  locale,
  values,
}: {
  t: Translator;
  locale: Locale;
  values: Readonly<Record<string, string>>;
}) {
  const parts = splitMessage(
    t("legal.privacy.selfService", { ...values, ...slotValues(["account"]) }),
    ["account"],
  );
  return (
    <section aria-labelledby="legal-rights" className="flex flex-col gap-2">
      <h2 id="legal-rights" className={textStyles.sectionTitle}>
        {t("legal.privacy.rightsTitle")}
      </h2>
      <Paragraphs text={t("legal.privacy.rightsBody", values)} />
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
      <p className="text-foreground">{t("legal.privacy.guests", values)}</p>
    </section>
  );
}

export function LegalPage({
  slug,
  locale,
  t,
  website,
}: {
  slug: LegalPageSlug;
  locale: Locale;
  t: Translator;
  /** Public origin host, supplied by the server route. */
  website: string;
}) {
  const inline = (value: string | null) => value?.trim() || t("legal.identity.unsetInline");
  const values = {
    sellerName: inline(legalIdentity.shopLegalName),
    sellerTaxId: inline(legalIdentity.shopTaxId),
    sellerAddress: inline(legalIdentity.shopLegalAddress),
    sellerEmail: inline(legalIdentity.shopEmail),
    sellerPhone: inline(legalIdentity.shopPhone),
    privacyEmail: inline(legalIdentity.privacyContact),
    website,
  };
  const intro = t(`legal.${slug}.intro`, values);
  return (
    <Container className="flex flex-col gap-6 py-8">
      {/* Breadcrumbs like the shop pages listed next to these in the footer (council decision 3). */}
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          label={t("breadcrumbs.label")}
          items={[
            { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
            { label: t(`legal.${slug}.title`) },
          ]}
        />
        <h1 className={textStyles.pageTitle}>{t(`legal.${slug}.title`)}</h1>
      </div>
      {/* The list records legal review; the marker remains a backstop for older fork intros. */}
      {demoContent.legalTexts.includes(slug) || intro.includes(LEGAL_PLACEHOLDER_MARKER) ? (
        <Alert variant="warning" title={t("legal.placeholder.title")}>
          <p>{t("legal.placeholder.body")}</p>
        </Alert>
      ) : null}
      <Paragraphs text={withoutLegalMarker(intro)} />
      <p className="text-muted-foreground">
        {legalIdentity.lastUpdated === null
          ? t("legal.updated.unset")
          : t("legal.updated", {
              date: formatDate(legalIdentity.lastUpdated, locale, { timeZone: "UTC" }),
            })}
      </p>
      {slug === "cookies" ? <CookieTable t={t} /> : null}
      {legalSections[slug].map((section, index) => (
        <section
          key={section.id}
          aria-labelledby={`legal-section-${section.id}`}
          className="flex flex-col gap-3"
        >
          {section.titleKey === undefined ? null : (
            <h2 id={`legal-section-${section.id}`} className={textStyles.sectionTitle}>
              {`${index + 1}. ${t(section.titleKey)}`}
            </h2>
          )}
          <Paragraphs text={t(section.bodyKey, values)} />
        </section>
      ))}
      {slug === "privacy" ? <PrivacyPointers t={t} locale={locale} values={values} /> : null}
      <Identity t={t} />
    </Container>
  );
}
