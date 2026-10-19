import { Card, EmptyState, type Locale, type Translator } from "@fluxkit/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import type { HomeSection, HomeSectionType } from "../layout/home";
import type { HomeData } from "../lib/catalog-data";
import { catalogPath } from "../lib/catalog-query";
import { localizedHref } from "../lib/locale-path";
import { ProductGrid } from "./product-grid";
import { focusRing, linkButton } from "./styles";

interface SectionContext {
  locale: Locale;
  t: Translator;
  /** What `loadHomeData` fetched for the configured sections. */
  data: HomeData;
  /** Hosts `next/image` may load from. */
  imageHosts: readonly string[];
}

type SectionOf<K extends HomeSectionType> = Extract<HomeSection, { type: K }>;
type SectionRenderer<K extends HomeSectionType> = (
  section: SectionOf<K>,
  context: SectionContext,
) => ReactNode;

function Hero({
  props,
  context,
}: {
  props: Extract<HomeSection, { type: "hero" }>["props"];
  context: SectionContext;
}) {
  const { t, locale } = context;
  return (
    <section aria-labelledby="home-hero-title" className="py-12">
      <h1 id="home-hero-title" className="text-3xl font-bold text-foreground">
        {t(props.titleKey)}
      </h1>
      <p className="mt-2 text-muted-foreground">{t(props.descriptionKey)}</p>
      <Link href={localizedHref(locale, props.ctaHref)} className={`${linkButton} mt-6`}>
        {t(props.ctaKey)}
      </Link>
    </section>
  );
}

function EmptySection({
  id,
  titleKey,
  emptyTitleKey,
  emptyDescriptionKey,
  t,
}: {
  id: string;
  titleKey: string;
  emptyTitleKey: string;
  emptyDescriptionKey: string;
  t: Translator;
}) {
  return (
    <section aria-labelledby={id} className="py-8">
      <h2 id={id} className="text-xl font-semibold text-foreground">
        {t(titleKey)}
      </h2>
      <EmptyState
        headingAs="h3"
        title={t(emptyTitleKey)}
        description={t(emptyDescriptionKey)}
        className="mt-4 rounded-md border border-border"
      />
    </section>
  );
}

function CategoryTiles({
  props,
  context,
}: {
  props: Extract<HomeSection, { type: "categoryTiles" }>["props"];
  context: SectionContext;
}) {
  const { t, locale, data } = context;
  const categories = (data.categories ?? []).slice(0, props.limit);
  if (categories.length === 0) {
    return <EmptySection id="home-categories-title" {...props} t={t} />;
  }
  return (
    <section aria-labelledby="home-categories-title" className="py-8">
      <h2 id="home-categories-title" className="text-xl font-semibold text-foreground">
        {t(props.titleKey)}
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
        {categories.map((category) => (
          <li key={category.id}>
            <Card className="relative focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <Link
                href={localizedHref(locale, `/c/${encodeURIComponent(category.slug)}`)}
                className="text-lg font-medium text-foreground after:absolute after:inset-0 focus-visible:outline-none"
              >
                {category.name}
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NewProducts({
  props,
  context,
}: {
  props: Extract<HomeSection, { type: "newProducts" }>["props"];
  context: SectionContext;
}) {
  const { t, locale, data, imageHosts } = context;
  const products = data.newProducts ?? [];
  if (products.length === 0 || data.exponent === undefined) {
    return <EmptySection id="home-new-products-title" {...props} t={t} />;
  }
  return (
    <section aria-labelledby="home-new-products-title" className="py-8">
      <h2 id="home-new-products-title" className="text-xl font-semibold text-foreground">
        {t(props.titleKey)}
      </h2>
      <div className="mt-4">
        <ProductGrid
          products={products}
          locale={locale}
          t={t}
          exponent={data.exponent}
          imageHosts={imageHosts}
          headingLevel="h3"
          brandPathFor={(slug) => catalogPath("/catalog", { brand: slug })}
          label={t(props.titleKey)}
        />
      </div>
      <Link
        href={localizedHref(locale, "/catalog")}
        className={`mt-4 inline-flex min-h-11 items-center underline underline-offset-4 ${focusRing}`}
      >
        {t(props.allKey)}
      </Link>
    </section>
  );
}

/** The registry: one renderer per section type of `layout/home.ts`. Data arrives in the context, loaded by the page. */
export const homeSectionRegistry: { [K in HomeSectionType]: SectionRenderer<K> } = {
  hero: ({ props }, context) => <Hero props={props} context={context} />,
  categoryTiles: ({ props }, context) => <CategoryTiles props={props} context={context} />,
  newProducts: ({ props }, context) => <NewProducts props={props} context={context} />,
};

export function HomeSections({
  sections,
  locale,
  t,
  data,
  imageHosts,
}: {
  sections: readonly HomeSection[];
  locale: Locale;
  t: Translator;
  data: HomeData;
  imageHosts: readonly string[];
}) {
  return (
    <>
      {sections.map((section) => {
        // TypeScript cannot correlate the section's type with its renderer inside a loop; the registry type guarantees it.
        const render = homeSectionRegistry[section.type] as
          ((section: HomeSection, context: SectionContext) => ReactNode) | undefined;
        if (render === undefined) {
          throw new Error(`The home layout names the unknown section type "${section.type}".`);
        }
        return <div key={section.type}>{render(section, { locale, t, data, imageHosts })}</div>;
      })}
    </>
  );
}
