import { Container, textStyles } from "@fluxkit/ui";
import Link from "next/link";
import type { CustomSectionProps } from "../lib/custom-sections";
import { localizedHref } from "../lib/locale-path";
import { LocalPicture } from "./local-picture";
import { linkButton } from "./styles";

/**
 * FORK custom home section `heroOverlay` (`width: "full"` in `config/home.ts`): a full-bleed hero, the picture edge to edge
 * with the headline, subline and call to action overlaid on an opaque token panel (readable on any picture, in both themes).
 * The template's hero texts are reused (`home.hero.*`); the picture is `public/home/hero.svg`. Its heading is an `h2`
 * (`headingId`): the page then gets a visually hidden `h1` with the shop name (`docs/contracts/home-sections.md`).
 */
export function HeroOverlay({ headingId, locale, t, isFirst }: CustomSectionProps) {
  return (
    <section aria-labelledby={headingId} className="relative isolate overflow-hidden bg-muted">
      <LocalPicture
        image={{ src: "/home/hero.svg", width: 640, height: 480, altKey: null }}
        t={t}
        eager={isFirst}
        sizes="100vw"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <Container className="flex min-h-96 items-end py-10 md:items-center md:py-16">
        <div className="flex max-w-xl flex-col gap-4 rounded-card bg-background/90 p-6 shadow-raised md:p-8">
          <h2 id={headingId} className={textStyles.pageTitle}>
            {t("home.hero.title")}
          </h2>
          <p className="text-muted-foreground">{t("home.hero.description")}</p>
          <Link href={localizedHref(locale, "/catalog")} className={`${linkButton} w-fit px-6`}>
            {t("home.hero.cta")}
          </Link>
        </div>
      </Container>
    </section>
  );
}
