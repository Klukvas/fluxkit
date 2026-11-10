import { Container, textStyles } from "@fluxkit/ui";
import type { CustomSectionProps } from "../lib/custom-sections";

/** FORK: the brands of the strip, as message keys of the fork's `custom.` namespace. */
const brandKeys = [
  "custom.brandStrip.brand1",
  "custom.brandStrip.brand2",
  "custom.brandStrip.brand3",
  "custom.brandStrip.brand4",
  "custom.brandStrip.brand5",
] as const;

/**
 * FORK custom home section `brandStrip` (`width: "full"`): a band of brand logos.
 * TODO(fluxkit): placeholder wordmarks (text in small capitals); a client fork puts its brands' logo files under
 * `public/brands/` and renders them here (the store API's brand has no logo picture).
 */
export function BrandLogoStrip({ headingId, t, width }: CustomSectionProps) {
  const content = (
    <>
      <h2 id={headingId} className={`${textStyles.sectionTitle} text-center`}>
        {t("custom.brandStrip.title")}
      </h2>
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
        {brandKeys.map((key) => (
          <li
            key={key}
            className="font-display text-xl font-semibold tracking-widest text-muted-foreground uppercase"
          >
            {t(key)}
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <section aria-labelledby={headingId} className="border-y border-border bg-muted py-10">
      {width === "full" ? (
        <Container className="flex flex-col gap-6">{content}</Container>
      ) : (
        <div className="flex flex-col gap-6">{content}</div>
      )}
    </section>
  );
}
