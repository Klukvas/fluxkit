import type { CategoryNode, ProductSummary } from "@fluxkit/api-client";
import {
  Hero,
  Skeleton,
  textStyles,
  VisuallyHidden,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { trustBarItems, type TrustBarItemConfig } from "../config/trust-bar";
import {
  isDataSection,
  type CategoriesSection,
  type HeroSection,
  type HomeDataSection,
  type HomeSection,
  type ProductRowSection,
  type RichTextSection,
  type TrustSection,
} from "../config/home";
import { catalogPath } from "../lib/catalog-query";
import type { HomeSectionResult } from "../lib/home-data";
import { localizedHref } from "../lib/locale-path";
import { CategoryIcon } from "./icons";
import { LocalPicture } from "./local-picture";
import { ProductGrid } from "./product-grid";
import { focusRing, linkButton } from "./styles";
import { StoreTrustBar } from "./trust-bar";

/**
 * The home page from `config/home.ts` (review D-18, plan 2026-11-03-storefront-design-b.md). Every section is presentational:
 * the page loads the data and passes each data section its result. `HomeSections` streams each data section into its own
 * `Suspense` boundary (a skeleton of the same size meanwhile); `HomeSectionsView` renders already loaded results (tests).
 */

export interface HomeContext {
  locale: Locale;
  t: Translator;
  /** Hosts `next/image` may load product images from. */
  imageHosts: readonly string[];
  /** The trust bar's lines; `config/trust-bar.ts` unless a test passes others. */
  trustItems?: readonly TrustBarItemConfig[];
}

/** The heading level of each hero: the first section's hero is the page's `h1`; any other hero is an `h2`. */
export function pageHeadingId(sections: readonly HomeSection[]): string | null {
  const first = sections[0];
  return first?.kind === "hero" ? first.id : null;
}

function headingId(section: HomeSection): string {
  return `${section.id}-title`;
}

function SectionShell({
  section,
  title,
  action,
  busy,
  children,
}: {
  section: HomeSection;
  title: string;
  /** A link beside the heading (for example "All products"). */
  action?: ReactNode;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={headingId(section)}
      aria-busy={busy ? "true" : undefined}
      data-home-section={section.kind}
      data-home-section-id={section.id}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId(section)} className={textStyles.sectionTitle}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function HeroView({
  section,
  context,
  isPageHeading,
}: {
  section: HeroSection;
  context: HomeContext;
  isPageHeading: boolean;
}) {
  const { t, locale } = context;
  return (
    <Hero
      headingId={headingId(section)}
      headingLevel={isPageHeading ? "h1" : "h2"}
      title={t(section.headlineKey)}
      subline={section.sublineKey === undefined ? null : t(section.sublineKey)}
      action={
        section.cta === undefined ? undefined : (
          <Link href={localizedHref(locale, section.cta.href)} className={`${linkButton} px-6`}>
            {t(section.cta.labelKey)}
          </Link>
        )
      }
      media={
        section.image === undefined ? undefined : (
          <LocalPicture
            image={section.image}
            t={t}
            // The first hero is the largest paint above the fold: load it at once.
            eager={isPageHeading}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="h-auto w-full rounded-md"
          />
        )
      }
    />
  );
}

const tileGrid = "grid grid-cols-2 gap-4 md:grid-cols-3";

function CategoryTiles({
  section,
  categories,
  context,
}: {
  section: CategoriesSection;
  categories: readonly CategoryNode[];
  context: HomeContext;
}) {
  const { t, locale } = context;
  return (
    <SectionShell section={section} title={t(section.titleKey)}>
      <ul className={tileGrid}>
        {categories.map((category) => {
          const image = section.images?.[category.slug];
          return (
            <li key={category.id}>
              <Link
                href={localizedHref(locale, `/c/${encodeURIComponent(category.slug)}`)}
                className={`group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background transition-shadow hover:border-border-input hover:shadow-raised motion-reduce:transition-none ${focusRing}`}
              >
                <span className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
                  {image === undefined ? (
                    <CategoryIcon width="40" height="40" />
                  ) : (
                    <LocalPicture
                      image={image}
                      t={t}
                      eager={false}
                      sizes="(min-width: 768px) 33vw, 50vw"
                      className="h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="flex flex-col gap-1 p-3">
                  <span className="font-medium text-foreground group-hover:underline group-hover:underline-offset-4">
                    {category.name}
                  </span>
                  {category.children.length === 0 ? null : (
                    <span className="text-sm text-muted-foreground">
                      {t.plural("home.categoryTiles.subcategories", category.children.length)}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </SectionShell>
  );
}

function productRowListPath(section: ProductRowSection): string {
  const { category, brand } = section.source;
  const base = category === undefined ? "/catalog" : `/c/${encodeURIComponent(category)}`;
  return catalogPath(base, brand === undefined ? {} : { brand });
}

function ProductRow({
  section,
  products,
  exponent,
  context,
}: {
  section: ProductRowSection;
  products: readonly ProductSummary[];
  exponent: number;
  context: HomeContext;
}) {
  const { t, locale, imageHosts } = context;
  const title = t(section.titleKey);
  return (
    <SectionShell
      section={section}
      title={title}
      action={
        section.viewAll === undefined ? undefined : (
          <Link
            href={localizedHref(locale, productRowListPath(section))}
            className={`inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4 ${focusRing}`}
          >
            {t(section.viewAll.labelKey)}
          </Link>
        )
      }
    >
      <ProductGrid
        products={products}
        locale={locale}
        t={t}
        exponent={exponent}
        imageHosts={imageHosts}
        headingLevel="h3"
        brandPathFor={(slug) => catalogPath("/catalog", { brand: slug })}
        label={title}
        // Below the hero: every image waits until it nears the viewport.
        eagerCount={0}
      />
    </SectionShell>
  );
}

function TrustView({ section, context }: { section: TrustSection; context: HomeContext }) {
  const { t, trustItems = trustBarItems } = context;
  if (trustItems.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId(section)}
      data-home-section="trust"
      data-home-section-id={section.id}
    >
      <h2 id={headingId(section)} className="sr-only">
        {t(section.titleKey)}
      </h2>
      <StoreTrustBar t={t} items={trustItems} className="md:flex-row md:justify-around md:py-4" />
    </section>
  );
}

function RichTextView({ section, context }: { section: RichTextSection; context: HomeContext }) {
  const { t } = context;
  const paragraphs = t(section.bodyKey)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  if (paragraphs.length === 0) return null;
  const body = (
    <div className="flex max-w-prose flex-col gap-3 text-muted-foreground">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
  if (section.titleKey === undefined) {
    return (
      <div data-home-section="richText" data-home-section-id={section.id}>
        {body}
      </div>
    );
  }
  return (
    <SectionShell section={section} title={t(section.titleKey)}>
      {body}
    </SectionShell>
  );
}

function SectionError({ section, context }: { section: HomeDataSection; context: HomeContext }) {
  const { t } = context;
  return (
    <SectionShell section={section} title={t(section.titleKey)}>
      <p
        className="rounded-md border border-border p-4 text-muted-foreground"
        data-home-section-error=""
      >
        {t("home.section.error")}
      </p>
    </SectionShell>
  );
}

/** A data section with its loaded result: nothing when there is nothing to show, a short error when the read failed. */
export function HomeDataSectionView({
  section,
  result,
  context,
}: {
  section: HomeDataSection;
  result: HomeSectionResult;
  context: HomeContext;
}) {
  if (result.status === "error") return <SectionError section={section} context={context} />;
  const { data } = result;
  if (section.kind === "categories" && data.kind === "categories") {
    if (data.categories.length === 0) return null;
    return <CategoryTiles section={section} categories={data.categories} context={context} />;
  }
  if (section.kind === "productRow" && data.kind === "productRow") {
    if (data.products.length === 0) return null;
    return (
      <ProductRow
        section={section}
        products={data.products}
        exponent={data.exponent}
        context={context}
      />
    );
  }
  throw new Error(
    `Home section "${section.id}" (${section.kind}) got data of kind "${data.kind}".`,
  );
}

/** The placeholder of a data section while it loads: the heading and boxes of the final size, so nothing moves. */
export function HomeSectionSkeleton({
  section,
  context,
}: {
  section: HomeDataSection;
  context: HomeContext;
}) {
  const { t } = context;
  const count = Math.min(section.limit, section.kind === "categories" ? 6 : 8);
  return (
    <SectionShell section={section} title={t(section.titleKey)} busy>
      <VisuallyHidden>{t("loading.page")}</VisuallyHidden>
      {section.kind === "categories" ? (
        <div className={tileGrid}>
          {Array.from({ length: count }, (_, index) => (
            <div
              key={index}
              className="flex flex-col overflow-hidden rounded-lg border border-border"
            >
              <Skeleton className="aspect-video" />
              <div className="flex flex-col gap-1 p-3">
                <Skeleton className="h-6 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-6 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}

function StaticSectionView({
  section,
  context,
  pageHeading,
}: {
  section: Exclude<HomeSection, HomeDataSection>;
  context: HomeContext;
  pageHeading: string | null;
}) {
  switch (section.kind) {
    case "hero":
      return (
        <HeroView section={section} context={context} isPageHeading={pageHeading === section.id} />
      );
    case "trust":
      return <TrustView section={section} context={context} />;
    case "richText":
      return <RichTextView section={section} context={context} />;
    default: {
      // A kind added to `HomeSection` without a renderer fails here at compile time.
      const unknown: never = section;
      throw new Error(`The home config names an unknown section kind: ${JSON.stringify(unknown)}`);
    }
  }
}

function HiddenPageHeading({ sections, t }: { sections: readonly HomeSection[]; t: Translator }) {
  // Without a hero first the page still needs its one `h1` before the sections' `h2`s.
  return pageHeadingId(sections) === null ? <h1 className="sr-only">{t("site.name")}</h1> : null;
}

const sectionStack = "flex flex-col gap-12 py-8";

async function AwaitedSection({
  section,
  result,
  context,
}: {
  section: HomeDataSection;
  result: Promise<HomeSectionResult>;
  context: HomeContext;
}) {
  return <HomeDataSectionView section={section} result={await result} context={context} />;
}

/**
 * The page's version: data sections stream in. `load` is called for every data section before anything renders, so the
 * reads run in parallel.
 */
export function HomeSections({
  sections,
  context,
  load,
}: {
  sections: readonly HomeSection[];
  context: HomeContext;
  load: (section: HomeDataSection) => Promise<HomeSectionResult>;
}) {
  const pageHeading = pageHeadingId(sections);
  const pending = new Map(
    sections.filter(isDataSection).map((section) => [section.id, load(section)] as const),
  );
  return (
    <div className={sectionStack}>
      <HiddenPageHeading sections={sections} t={context.t} />
      {sections.map((section) => {
        if (!isDataSection(section)) {
          return (
            <StaticSectionView
              key={section.id}
              section={section}
              context={context}
              pageHeading={pageHeading}
            />
          );
        }
        const result = pending.get(section.id) as Promise<HomeSectionResult>;
        return (
          <Suspense
            key={section.id}
            fallback={<HomeSectionSkeleton section={section} context={context} />}
          >
            <AwaitedSection section={section} result={result} context={context} />
          </Suspense>
        );
      })}
    </div>
  );
}

/** The same page with every data section already loaded (unit tests; no streaming). */
export function HomeSectionsView({
  sections,
  context,
  results,
}: {
  sections: readonly HomeSection[];
  context: HomeContext;
  /** By section id; a data section without a result renders its skeleton. */
  results: Readonly<Record<string, HomeSectionResult>>;
}) {
  const pageHeading = pageHeadingId(sections);
  return (
    <div className={sectionStack}>
      <HiddenPageHeading sections={sections} t={context.t} />
      {sections.map((section) => {
        if (!isDataSection(section)) {
          return (
            <StaticSectionView
              key={section.id}
              section={section}
              context={context}
              pageHeading={pageHeading}
            />
          );
        }
        const result = results[section.id];
        return result === undefined ? (
          <HomeSectionSkeleton key={section.id} section={section} context={context} />
        ) : (
          <HomeDataSectionView
            key={section.id}
            section={section}
            result={result}
            context={context}
          />
        );
      })}
    </div>
  );
}
