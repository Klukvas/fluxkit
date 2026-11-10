import { Container, textStyles, VisuallyHidden } from "@fluxkit/ui";
import Link from "next/link";
import { brandStrip, type BrandLogoEntry } from "../../config/brand-strip";
import type { CustomSectionProps } from "../../lib/custom-sections";
import { localizedHref } from "../../lib/locale-path";
import { LocalPicture } from "../local-picture";
import { focusRing } from "../styles";

/**
 * FORK (reshape R4): the brand-logos strip of the home page: the custom section `brandStrip` (`config/custom-sections.ts`),
 * a `bg-muted` band over the whole width with the logos of `config/brand-strip.ts` in one wrapping row.
 *
 * TODO(fluxkit): the logos are placeholders (the store API has no brand pictures; see `config/brand-strip.ts`). Each picture
 * is decorative and the brand's name is read instead; a brand with a slug links to the catalog filtered by it. No entry: no
 * section.
 */
export function BrandStrip({
  headingId,
  locale,
  t,
  width,
  brands = brandStrip,
}: CustomSectionProps & {
  /** `config/brand-strip.ts`; a prop for tests. */
  brands?: readonly BrandLogoEntry[];
}) {
  if (brands.length === 0) return null;
  const content = (
    <div className="flex flex-col items-center gap-4">
      <h2 id={headingId} className={textStyles.sectionTitle}>
        {t("custom.brandStrip.title")}
      </h2>
      <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
        {brands.map((brand) => {
          const logo = (
            <>
              <LocalPicture
                image={brand.image}
                t={t}
                eager={false}
                sizes="160px"
                className="h-12 w-auto rounded-media"
              />
              <VisuallyHidden>{brand.name}</VisuallyHidden>
            </>
          );
          return (
            <li key={brand.name}>
              {brand.slug === null ? (
                logo
              ) : (
                <Link
                  href={localizedHref(locale, `/catalog?brand=${encodeURIComponent(brand.slug)}`)}
                  className={`inline-flex min-h-11 items-center rounded-media ${focusRing}`}
                >
                  {logo}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <section aria-labelledby={headingId} data-fork-brand-strip="" className="bg-muted py-10">
      {width === "full" ? <Container>{content}</Container> : content}
    </section>
  );
}
