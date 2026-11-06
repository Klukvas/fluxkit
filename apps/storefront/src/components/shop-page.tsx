import {
  Breadcrumbs,
  Container,
  Disclosure,
  textStyles,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import type {
  FaqSection,
  LinksSection,
  ShopPageConfig,
  ShopPageSection,
  TableSection,
  TextSection,
} from "../config/shop-pages";
import { contactsView, type ContactsView } from "../lib/contacts";
import { localizedHref } from "../lib/locale-path";
import { paragraphsOf, shopPageLinks } from "../lib/shop-pages";
import { ContactDetails } from "./contact-details";
import { focusRing } from "./styles";

/**
 * A shop page (`config/shop-pages.ts`): breadcrumbs, the one `h1`, the lead and the sections in config order, each section
 * title an `h2`. A server component: nothing here needs the browser (the FAQ's disclosures are native `details`).
 */

function headingIdOf(section: ShopPageSection): string {
  return `shop-section-${section.id}`;
}

function Paragraphs({ text }: { text: string }) {
  return (
    <>
      {paragraphsOf(text).map((paragraph, index) => (
        <p key={index} className="max-w-prose text-foreground">
          {paragraph}
        </p>
      ))}
    </>
  );
}

function TextView({ section, t }: { section: TextSection; t: Translator }) {
  const headingId = headingIdOf(section);
  return (
    <section
      aria-labelledby={section.titleKey === undefined ? undefined : headingId}
      className="flex flex-col gap-3"
    >
      {section.titleKey === undefined ? null : (
        <h2 id={headingId} className={textStyles.sectionTitle}>
          {t(section.titleKey)}
        </h2>
      )}
      <Paragraphs text={t(section.bodyKey)} />
    </section>
  );
}

function TableView({ section, t }: { section: TableSection; t: Translator }) {
  const headingId = headingIdOf(section);
  const cellText = (cell: TableSection["rows"][number][number]) =>
    "key" in cell ? t(cell.key) : cell.value;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className={textStyles.sectionTitle}>
        {t(section.titleKey)}
      </h2>
      {/* The table scrolls inside its own box on a narrow screen; the page never scrolls sideways. */}
      <div className="max-w-full overflow-x-auto">
        <table className="w-full max-w-3xl text-start text-foreground">
          <caption className="sr-only">{t(section.captionKey)}</caption>
          <thead>
            <tr className="border-b border-border">
              {section.columnKeys.map((key) => (
                <th key={key} scope="col" className="py-2 pe-4 text-start align-bottom">
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border align-top">
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row" className="py-2 pe-4 text-start font-medium">
                      {cellText(cell)}
                    </th>
                  ) : (
                    <td key={cellIndex} className="py-2 pe-4">
                      {cellText(cell)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.noteKey === undefined ? null : (
        <p className="max-w-prose text-sm text-muted-foreground">{t(section.noteKey)}</p>
      )}
    </section>
  );
}

function FaqView({ section, t }: { section: FaqSection; t: Translator }) {
  const headingId = headingIdOf(section);
  const titled = section.titleKey !== undefined;
  return (
    <section aria-labelledby={titled ? headingId : undefined} className="flex flex-col gap-1">
      {section.titleKey === undefined ? null : (
        <h2 id={headingId} className={textStyles.sectionTitle}>
          {t(section.titleKey)}
        </h2>
      )}
      {section.items.map((item) => (
        <Disclosure
          key={item.id}
          title={t(item.questionKey)}
          headingId={`faq-${section.id}-${item.id}`}
          headingAs={titled ? "h3" : "h2"}
          defaultOpen={false}
        >
          <Paragraphs text={t(item.answerKey)} />
        </Disclosure>
      ))}
    </section>
  );
}

function LinksView({
  section,
  t,
  locale,
}: {
  section: LinksSection;
  t: Translator;
  locale: Locale;
}) {
  const links = shopPageLinks(locale, section.pages);
  if (links.length === 0) return null;
  const headingId = headingIdOf(section);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h2 id={headingId} className={textStyles.sectionTitle}>
        {t(section.titleKey)}
      </h2>
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {links.map((link) => (
          <li key={link.slug}>
            <Link
              href={link.href}
              className={`inline-flex min-h-6 items-center text-foreground underline underline-offset-4 ${focusRing}`}
            >
              {t(link.titleKey)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionView({
  section,
  t,
  locale,
  contacts,
}: {
  section: ShopPageSection;
  t: Translator;
  locale: Locale;
  contacts: ContactsView;
}) {
  switch (section.kind) {
    case "text":
      return <TextView section={section} t={t} />;
    case "table":
      return <TableView section={section} t={t} />;
    case "faq":
      return <FaqView section={section} t={t} />;
    case "contacts":
      return (
        <ContactDetails
          contacts={contacts}
          t={t}
          headingId={headingIdOf(section)}
          {...(section.titleKey === undefined ? {} : { titleKey: section.titleKey })}
        />
      );
    case "links":
      return <LinksView section={section} t={t} locale={locale} />;
    default: {
      const unknown: never = section;
      throw new Error(`Unknown shop page section ${JSON.stringify(unknown)}.`);
    }
  }
}

export function ShopPage({
  page,
  locale,
  t,
  contacts = contactsView(),
}: {
  page: ShopPageConfig;
  locale: Locale;
  t: Translator;
  /** `contactsView()` of `config/contacts.ts`; a prop for tests. */
  contacts?: ContactsView;
}) {
  return (
    <Container className="flex flex-col gap-8 py-8">
      <div className="flex flex-col gap-4">
        <Breadcrumbs
          label={t("breadcrumbs.label")}
          items={[
            { label: t("breadcrumbs.home"), href: localizedHref(locale, "/") },
            { label: t(page.titleKey) },
          ]}
        />
        <h1 className={textStyles.pageTitle}>{t(page.titleKey)}</h1>
        <p className="max-w-prose text-muted-foreground">{t(page.descriptionKey)}</p>
      </div>
      {page.sections.map((section) => (
        <SectionView key={section.id} section={section} t={t} locale={locale} contacts={contacts} />
      ))}
    </Container>
  );
}
