import type { CategoryNode, ProductList } from "@fluxkit/api-client";
import {
  Breadcrumbs,
  Container,
  EmptyState,
  Pagination,
  type BreadcrumbItem,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { catalogPath } from "../lib/catalog-query";
import { localizedHref } from "../lib/locale-path";
import { ProductGrid } from "./product-grid";
import { focusRing, linkButton } from "./styles";

export interface CatalogViewProps {
  locale: Locale;
  t: Translator;
  /** The `h1`. */
  heading: string;
  description: string | null;
  breadcrumbs: BreadcrumbItem[];
  products: ProductList;
  page: number;
  pageCount: number;
  exponent: number;
  imageHosts: readonly string[];
  /** Locale-less path of this list (`/catalog` or `/c/<slug>`); filter and page links are built from it. */
  basePath: string;
  /** Child categories of a category page. */
  subcategories: readonly CategoryNode[];
  /** The active brand filter. `name` is the brand's name when a listed product carries it, else the slug. */
  brand: { slug: string; name: string } | null;
  /** A category page, for the "category empty" state. */
  isCategory: boolean;
}

function EmptyList({
  t,
  locale,
  basePath,
  brand,
  isCategory,
}: Pick<CatalogViewProps, "t" | "locale" | "basePath" | "brand" | "isCategory">) {
  if (brand !== null) {
    return (
      <EmptyState
        title={t("catalog.filter.empty.title")}
        description={t("catalog.filter.empty.description")}
        action={
          <Link href={localizedHref(locale, catalogPath(basePath, {}))} className={linkButton}>
            {t("catalog.filter.clear")}
          </Link>
        }
        className="rounded-md border border-border"
      />
    );
  }
  if (isCategory) {
    return (
      <EmptyState
        title={t("catalog.category.empty.title")}
        description={t("catalog.category.empty.description")}
        action={
          <Link href={localizedHref(locale, "/catalog")} className={linkButton}>
            {t("catalog.all")}
          </Link>
        }
        className="rounded-md border border-border"
      />
    );
  }
  return (
    <EmptyState
      title={t("catalog.empty.title")}
      description={t("catalog.empty.description")}
      className="rounded-md border border-border"
    />
  );
}

/**
 * The catalog and category pages share this view (pages only compose). Headings: `h1` the page, `h2` the subcategories and
 * the product titles. The brand filter exists only as links (owner answer 11): a product's brand link leads here with
 * `?brand=`, and the active filter is shown with a link that clears it.
 */
export function CatalogView({
  locale,
  t,
  heading,
  description,
  breadcrumbs,
  products,
  page,
  pageCount,
  exponent,
  imageHosts,
  basePath,
  subcategories,
  brand,
  isCategory,
}: CatalogViewProps) {
  const brandSlug = brand?.slug ?? null;
  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs label={t("breadcrumbs.label")} items={breadcrumbs} />
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-foreground">{heading}</h1>
        {description === null ? null : (
          <p className="whitespace-pre-line text-muted-foreground">{description}</p>
        )}
      </header>

      {subcategories.length === 0 ? null : (
        <section aria-labelledby="catalog-subcategories-title" className="flex flex-col gap-2">
          <h2 id="catalog-subcategories-title" className="text-lg font-semibold text-foreground">
            {t("catalog.subcategories")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {subcategories.map((child) => (
              <li key={child.id}>
                <Link
                  href={localizedHref(locale, `/c/${encodeURIComponent(child.slug)}`)}
                  className={`inline-flex min-h-11 items-center rounded-md border border-border px-3 text-foreground ${focusRing}`}
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {brand === null ? null : (
        <p className="flex flex-wrap items-center gap-3 text-foreground">
          <span>{t("catalog.filter.brand", { brand: brand.name })}</span>
          <Link
            href={localizedHref(locale, catalogPath(basePath, {}))}
            className={`inline-flex min-h-11 items-center underline underline-offset-4 ${focusRing}`}
          >
            {t("catalog.filter.clear")}
          </Link>
        </p>
      )}

      {products.items.length === 0 ? (
        <EmptyList
          t={t}
          locale={locale}
          basePath={basePath}
          brand={brand}
          isCategory={isCategory}
        />
      ) : (
        <>
          <p className="text-muted-foreground">{t.plural("catalog.count", products.total)}</p>
          <ProductGrid
            products={products.items}
            locale={locale}
            t={t}
            exponent={exponent}
            imageHosts={imageHosts}
            headingLevel="h2"
            brandPathFor={(slug) => catalogPath(basePath, { brand: slug })}
            label={t("catalog.list.label")}
          />
        </>
      )}

      <Pagination
        label={t("catalog.pagination.label")}
        currentPage={page}
        pageCount={pageCount}
        hrefForPage={(target) =>
          localizedHref(locale, catalogPath(basePath, { brand: brandSlug, page: target }))
        }
        previousLabel={t("catalog.pagination.previous")}
        nextLabel={t("catalog.pagination.next")}
        pageLabel={(target) => t("catalog.pagination.page", { page: target })}
      />
    </Container>
  );
}
