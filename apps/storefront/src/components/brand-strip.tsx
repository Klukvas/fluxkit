import { Container, textStyles } from "@fluxkit/ui";
import type { LocalImage } from "../config/home";
import type { CustomSectionProps } from "../lib/custom-sections";
import { LocalPicture } from "./local-picture";

/**
 * The fork's brand-logos strip (custom section `brandStrip`, `width: "full"` in `config/home.ts`): a `bg-muted` band with a row
 * of logos. A SERVER component.
 *
 * TODO(fluxkit): placeholders. The store API has no brand pictures (a brand is a name and a slug only), so the logos are five
 * copies of the dashed placeholder `public/brands/placeholder.svg`, shown as decorative pictures. The client's real logos are
 * files under `public/brands/` listed in `BRAND_LOGOS`; linking each to its brand page needs the brand slug, which only a hand
 * written list (not the API) can give today.
 */
const PLACEHOLDER: LocalImage = {
  src: "/brands/placeholder.svg",
  width: 200,
  height: 80,
  altKey: null,
};

const BRAND_LOGOS: readonly { id: string; image: LocalImage }[] = [
  { id: "brand-1", image: PLACEHOLDER },
  { id: "brand-2", image: PLACEHOLDER },
  { id: "brand-3", image: PLACEHOLDER },
  { id: "brand-4", image: PLACEHOLDER },
  { id: "brand-5", image: PLACEHOLDER },
];

export function BrandStrip({ headingId, t }: CustomSectionProps) {
  return (
    <section aria-labelledby={headingId} className="bg-muted py-8">
      <Container className="flex flex-col gap-4">
        <h2 id={headingId} className={`${textStyles.navGroupTitle} text-center`}>
          {t("custom.home.brands.title")}
        </h2>
        <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
          {BRAND_LOGOS.map((logo) => (
            <li key={logo.id}>
              <LocalPicture
                image={logo.image}
                t={t}
                eager={false}
                sizes="120px"
                className="h-10 w-auto"
              />
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
