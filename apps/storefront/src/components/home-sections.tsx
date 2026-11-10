import type { CategoryNode, ProductSummary } from "@fluxkit/api-client";
import {
  BannerCard,
  type BannerCardLinkProps,
  Container,
  Hero,
  Skeleton,
  textStyles,
  VisuallyHidden,
  type Locale,
  type Translator,
} from "@fluxkit/ui";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { customSections } from "../config/custom-sections";
import { trustBarItems, type TrustBarItemConfig } from "../config/trust-bar";
import {
  checkHomeSections,
  isDataSection,
  type BannersSection,
  type BannerTone,
  type CategoriesSection,
  type ConfigBannersSection,
  type CustomSection,
  type HeroSection,
  type HomeDataSection,
  type HomeSection,
  type LocalImage,
  type ProductRowSection,
  type RichTextSection,
  type TrustSection,
} from "../config/home";
import { catalogPath } from "../lib/catalog-query";
import { resolveCustomSection } from "../lib/custom-sections";
import {
  bannerLink,
  checkBannersSection,
  type BannerLink,
  type StoreBannerPicture,
  type StoreBannerView,
} from "../lib/home-banners";
import type { HomeSectionResult } from "../lib/home-data";
import { localizedHref } from "../lib/locale-path";
import { CategoryIcon } from "./icons";
import { LocalPicture } from "./local-picture";
import { ProductGrid } from "./product-grid";
import { StoreImage } from "./store-image";
import { focusRing, linkButton } from "./styles";
import { StoreTrustBar } from "./trust-bar";

/**
 * The home page from `config/home.ts` (review D-18, plan 2026-11-03-storefront-design-b.md). Every section is presentational:
 * the page loads the data and passes each data section its result. `HomeSections` streams each data section into its own
 * `Suspense` boundary (a skeleton of the same size meanwhile); `HomeSectionsView` renders already loaded results (tests).
 *
 * Layout (plan 2026-11-08-design-changeability.md, L4): with every section `contained` (the default) the sections share ONE
 * `Container`, exactly the markup from before `width` existed; once a (custom) section is `full`, each section gets a frame
 * of its own (`SectionFrame`). A `custom` section renders the fork's component from `config/custom-sections.ts`.
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
      {/* `min-h-11`: the same height with or without the link beside the heading, so a skeleton matches its section. */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
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
            className="h-auto w-full rounded-media"
          />
        )
      }
    />
  );
}

/** One column on phones; from `md` one row of as many columns as there are banners (1 to 3). */
const bannerColumns: Record<number, { grid: string; sizes: string }> = {
  1: { grid: "grid-cols-1", sizes: "100vw" },
  2: { grid: "grid-cols-1 md:grid-cols-2", sizes: "(min-width: 768px) 50vw, 100vw" },
  3: { grid: "grid-cols-1 md:grid-cols-3", sizes: "(min-width: 768px) 33vw, 100vw" },
};

/** A banner's picture: a file of the template (`config` source) or an uploaded image of the API (`admin` source). */
type BannerPicture =
  { kind: "local"; image: LocalImage } | ({ kind: "remote" } & StoreBannerPicture);

/** One banner as `BannersView` draws it, whichever source it came from. */
type BannerItem =
  | {
      id: string;
      layout: "card";
      title: string;
      text: string | null;
      tone: BannerTone;
      link: BannerLink;
      picture: BannerPicture;
    }
  | { id: string; layout: "image"; link: BannerLink; picture: BannerPicture };

function configBannerCards(section: ConfigBannersSection, context: HomeContext): BannerItem[] {
  checkBannersSection(section);
  const { t, locale } = context;
  return section.items.map((banner) => ({
    id: banner.id,
    layout: "card",
    title: t(banner.titleKey),
    text: t(banner.textKey),
    tone: banner.tone ?? "surface",
    link: bannerLink(locale, banner.href),
    picture: { kind: "local", image: banner.image },
  }));
}

function storeBannerCards(banners: readonly StoreBannerView[]): BannerItem[] {
  return banners.map((banner) => ({
    ...banner,
    picture: { kind: "remote", ...banner.picture },
  }));
}

/**
 * A banner's picture inside the fixed 2:1 frame of `BannerCard` (`object-cover`): any upload size or ratio fills it,
 * cropped, and the frame reserves the space before the picture loads, so nothing moves.
 */
function BannerPictureView({
  picture,
  context,
  eager,
  sizes,
}: {
  picture: BannerPicture;
  context: HomeContext;
  eager: boolean;
  sizes: string;
}) {
  return picture.kind === "local" ? (
    <LocalPicture
      image={picture.image}
      t={context.t}
      eager={eager}
      sizes={sizes}
      className="h-full w-full object-cover"
    />
  ) : (
    <StoreImage
      src={picture.src}
      alt={picture.alt}
      width={picture.width}
      height={picture.height}
      sizes={sizes}
      eager={eager}
      fill
    />
  );
}

/** The one link of a banner: a router link inside the shop, a plain anchor for an `https` address. */
function BannerAnchor({ link, ...props }: { link: BannerLink } & BannerCardLinkProps) {
  return link.external ? <a href={link.href} {...props} /> : <Link href={link.href} {...props} />;
}

/**
 * Promotional cards (plans 2026-11-05-home-banners.md and 2026-11-05-admin-home-banners.md). Each banner is ONE link:
 * - `card`: the picture, a title and an optional text; the link is named by its title (`aria-labelledby`) and described by
 *   its text, so the picture's alt and the text do not pile up in the name. The picture is decorative (`alt=""`) unless it
 *   has its own alt text.
 * - `image` (admin only): the finished picture alone, no text over it and no tone; its alt text is the link's name.
 * Server-rendered; the only script is the placeholder fallback of an uploaded picture that fails to load.
 */
function BannersView({
  section,
  cards,
  context,
  isFirst,
}: {
  section: BannersSection;
  cards: readonly BannerItem[];
  context: HomeContext;
  /** The first section of the page: its pictures are above the fold and load at once; otherwise lazily. */
  isFirst: boolean;
}) {
  if (cards.length === 0) return null;
  const columns = bannerColumns[cards.length] as { grid: string; sizes: string };
  return (
    <section
      aria-labelledby={headingId(section)}
      data-home-section="banners"
      data-home-section-id={section.id}
    >
      <h2 id={headingId(section)} className="sr-only">
        {context.t(section.titleKey)}
      </h2>
      <ul className={`grid gap-4 ${columns.grid}`}>
        {cards.map((banner) => (
          <li key={banner.id} data-banner-id={banner.id} data-banner-layout={banner.layout}>
            <BannerCard
              id={`${section.id}-${banner.id}`}
              layout={banner.layout}
              {...(banner.layout === "card"
                ? { title: banner.title, text: banner.text, tone: banner.tone }
                : {})}
              picture={
                <BannerPictureView
                  picture={banner.picture}
                  context={context}
                  eager={isFirst}
                  sizes={columns.sizes}
                />
              }
              renderLink={(props) => <BannerAnchor link={banner.link} {...props} />}
            />
          </li>
        ))}
      </ul>
    </section>
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
                className={`group flex h-full flex-col overflow-hidden rounded-card border border-border bg-background transition-shadow hover:border-border-input hover:shadow-raised motion-reduce:transition-none ${focusRing}`}
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
  const { t, locale, trustItems = trustBarItems } = context;
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
      <StoreTrustBar
        t={t}
        locale={locale}
        items={trustItems}
        className="md:flex-row md:justify-around md:py-4"
      />
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

/** The fork's component of a `custom` section, given a plain view model only (`lib/custom-sections.ts`). */
function CustomSectionView({
  section,
  context,
  isFirst,
}: {
  section: CustomSection;
  context: HomeContext;
  isFirst: boolean;
}) {
  const Component = resolveCustomSection(section, customSections);
  if (Component === null) return null;
  return (
    <Component
      id={section.id}
      headingId={headingId(section)}
      locale={context.locale}
      t={context.t}
      isFirst={isFirst}
      width={section.width ?? "contained"}
    />
  );
}

function SectionError({
  section,
  context,
}: {
  section: CategoriesSection | ProductRowSection;
  context: HomeContext;
}) {
  const { t } = context;
  return (
    <SectionShell section={section} title={t(section.titleKey)}>
      <p
        className="rounded-panel border border-border p-4 text-muted-foreground"
        data-home-section-error=""
      >
        {t("home.section.error")}
      </p>
    </SectionShell>
  );
}

/**
 * A data section with its loaded result: nothing when there is nothing to show, a short error when the read failed (the
 * banners: nothing either; the failure is already logged by the loader).
 */
export function HomeDataSectionView({
  section,
  result,
  context,
  isFirst = false,
}: {
  section: HomeDataSection;
  result: HomeSectionResult;
  context: HomeContext;
  /** The first section of the page (above the fold): banner pictures load at once. */
  isFirst?: boolean;
}) {
  if (result.status === "error") {
    return section.kind === "banners" ? null : <SectionError section={section} context={context} />;
  }
  const { data } = result;
  if (section.kind === "banners" && data.kind === "banners") {
    return (
      <BannersView
        section={section}
        cards={storeBannerCards(data.banners)}
        context={context}
        isFirst={isFirst}
      />
    );
  }
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
  // The admin's banners have no skeleton: how many there are and which layout is unknown until they load, so the page
  // waits for them instead (`HomeSections`).
  if (section.kind === "banners") return null;
  const { t } = context;
  // One row of tiles (most shops show a few top-level categories), two rows of four product cards.
  const count = Math.min(section.limit, section.kind === "categories" ? 3 : 8);
  return (
    <SectionShell section={section} title={t(section.titleKey)} busy>
      <VisuallyHidden>{t("loading.page")}</VisuallyHidden>
      {section.kind === "categories" ? (
        <div className={tileGrid}>
          {Array.from({ length: count }, (_, index) => (
            <div
              key={index}
              className="flex flex-col overflow-hidden rounded-card border border-border"
            >
              <Skeleton className="aspect-video" />
              <div className="flex flex-col gap-1 p-3">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="flex flex-col gap-2 rounded-card border border-border p-3">
              <Skeleton className="aspect-square w-full" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-6 w-3/4" />
              <div className="pt-1">
                <Skeleton className="h-6 w-1/2" />
              </div>
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
  isFirst,
}: {
  section: Exclude<HomeSection, HomeDataSection>;
  context: HomeContext;
  pageHeading: string | null;
  isFirst: boolean;
}) {
  switch (section.kind) {
    case "hero":
      return (
        <HeroView section={section} context={context} isPageHeading={pageHeading === section.id} />
      );
    case "banners":
      return (
        <BannersView
          section={section}
          cards={configBannerCards(section, context)}
          context={context}
          isFirst={isFirst}
        />
      );
    case "trust":
      return <TrustView section={section} context={context} />;
    case "richText":
      return <RichTextView section={section} context={context} />;
    case "custom":
      return <CustomSectionView section={section} context={context} isFirst={isFirst} />;
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

/**
 * The frame of one section when the sections do not share one container (some section is `full`):
 * - `contained`: the same `Container` as the shared one (same content width and gutter, whatever the tokens).
 * - `full`: NO container: the section spans the window and decides its own inner width and surface. A full section right
 *   after another full one pulls up over the stack's gap (`-mt-12` = `gap-12`), so adjacent bands touch instead of showing a
 *   strip of page background between them.
 * `empty:hidden`: a section that renders nothing (no data, an empty custom section) leaves no frame and no extra gap.
 */
function SectionFrame({
  section,
  afterFull,
  children,
}: {
  section: HomeSection;
  afterFull: boolean;
  children: ReactNode;
}) {
  return section.width === "full" ? (
    <div className={afterFull ? "-mt-12 empty:hidden" : "empty:hidden"} data-home-width="full">
      {children}
    </div>
  ) : (
    <Container className="empty:hidden" data-home-width="contained">
      {children}
    </Container>
  );
}

/**
 * The page around its sections. Every section contained: one `Container` around the stack (the markup from before `width`
 * existed, byte for byte; frozen copies in `home-sections-default.spec.tsx`). Otherwise the stack spans the window and every
 * section has its own `SectionFrame`; a full section first sits flush under the header (no top padding).
 */
function SectionsLayout({
  sections,
  t,
  renderSection,
}: {
  sections: readonly HomeSection[];
  t: Translator;
  renderSection: (section: HomeSection, index: number) => ReactNode;
}) {
  checkHomeSections(sections);
  const ownFrames = sections.some((section) => section.width === "full");
  const firstFull = sections[0]?.width === "full";
  const stack = (
    <div className={firstFull ? "flex flex-col gap-12 pb-8" : sectionStack}>
      <HiddenPageHeading sections={sections} t={t} />
      {sections.map((section, index) =>
        ownFrames ? (
          <SectionFrame
            key={section.id}
            section={section}
            afterFull={section.width === "full" && sections[index - 1]?.width === "full"}
          >
            {renderSection(section, index)}
          </SectionFrame>
        ) : (
          renderSection(section, index)
        ),
      )}
    </div>
  );
  return ownFrames ? stack : <Container>{stack}</Container>;
}

async function AwaitedSection({
  section,
  result,
  context,
  isFirst,
}: {
  section: HomeDataSection;
  result: Promise<HomeSectionResult>;
  context: HomeContext;
  isFirst: boolean;
}) {
  return (
    <HomeDataSectionView
      section={section}
      result={await result}
      context={context}
      isFirst={isFirst}
    />
  );
}

/**
 * The page's version: the category tiles and product rows stream in, each behind a skeleton of its size. `load` is called
 * for every data section before anything renders, so the reads run in parallel.
 *
 * The admin's banners have no boundary of their own: the page waits for them (the `(site)` loading view meanwhile). They
 * sit near the top and no skeleton can match an unknown number of banners in an unknown layout, so streaming them in would
 * push the page down. The wait is one read of the 60 s data cache, bounded by the read timeout, and the layout around the
 * page already waits for the API.
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
    <SectionsLayout
      sections={sections}
      t={context.t}
      renderSection={(section, index) => {
        if (!isDataSection(section)) {
          return (
            <StaticSectionView
              key={section.id}
              section={section}
              context={context}
              pageHeading={pageHeading}
              isFirst={index === 0}
            />
          );
        }
        const result = pending.get(section.id) as Promise<HomeSectionResult>;
        const awaited = (
          <AwaitedSection
            key={section.id}
            section={section}
            result={result}
            context={context}
            isFirst={index === 0}
          />
        );
        if (section.kind === "banners") return awaited;
        return (
          <Suspense
            key={section.id}
            fallback={<HomeSectionSkeleton section={section} context={context} />}
          >
            {awaited}
          </Suspense>
        );
      }}
    />
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
    <SectionsLayout
      sections={sections}
      t={context.t}
      renderSection={(section, index) => {
        if (!isDataSection(section)) {
          return (
            <StaticSectionView
              key={section.id}
              section={section}
              context={context}
              pageHeading={pageHeading}
              isFirst={index === 0}
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
            isFirst={index === 0}
          />
        );
      }}
    />
  );
}
