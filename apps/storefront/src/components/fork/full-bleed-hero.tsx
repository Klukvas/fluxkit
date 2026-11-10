import { Container, textStyles } from "@fluxkit/ui";
import Link from "next/link";
import type { LocalImage } from "../../config/home";
import type { CustomSectionProps } from "../../lib/custom-sections";
import { localizedHref } from "../../lib/locale-path";
import { LocalPicture } from "../local-picture";
import { linkButton } from "../styles";

/** The hero's picture: a file of the fork under `public/fork/`, decorative (the heading says it all). */
const picture: LocalImage = { src: "/fork/hero-wide.svg", width: 1600, height: 640, altKey: null };

/**
 * FORK (reshape R4): the full-bleed hero of the home page with its text over the picture: the custom section `fullBleedHero`
 * (`config/custom-sections.ts`, `docs/contracts/home-sections.md`), placed with `width: "full"` in `config/home.ts`. The
 * picture fills the band edge to edge; the heading, line and call to action sit over it on a panel with its own surface, so
 * they read on any photo and in both themes (no text directly on a photo). The texts are the template's hero texts
 * (`home.hero.*`; a fork changes them in `messages-overrides`). Its heading is an `h2` (the page's `h1` is then the visually
 * hidden shop name, as for any page whose first section is not the built-in hero).
 */
export function FullBleedHero({ headingId, locale, t, isFirst }: CustomSectionProps) {
  return (
    <section
      aria-labelledby={headingId}
      data-fork-hero=""
      className="relative isolate flex min-h-96 items-center overflow-hidden bg-muted py-10 lg:min-h-128"
    >
      <LocalPicture
        image={picture}
        t={t}
        eager={isFirst}
        sizes="100vw"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <Container>
        <div className="flex max-w-xl flex-col items-start gap-3 rounded-panel bg-background/90 p-6 shadow-raised md:p-10">
          <h2 id={headingId} className={`${textStyles.pageTitle} md:text-4xl`}>
            {t("home.hero.title")}
          </h2>
          <p className="text-lg whitespace-pre-line text-muted-foreground">
            {t("home.hero.description")}
          </p>
          <Link href={localizedHref(locale, "/catalog")} className={`${linkButton} mt-3`}>
            {t("home.hero.cta")}
          </Link>
        </div>
      </Container>
    </section>
  );
}
