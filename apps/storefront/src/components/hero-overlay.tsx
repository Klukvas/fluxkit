import { Container, textStyles } from "@fluxkit/ui";
import Link from "next/link";
import type { LocalImage } from "../config/home";
import { localizedHref } from "../lib/locale-path";
import type { CustomSectionProps } from "../lib/custom-sections";
import { LocalPicture } from "./local-picture";
import { linkButton } from "./styles";

/**
 * The fork's home hero (custom section `heroOverlay`, `width: "full"` in `config/home.ts`): a picture edge to edge with the
 * headline, subline and button laid over it on a token surface (`bg-background/90`), so the text keeps its contrast on any
 * picture. Texts: the template's own `home.hero.*` keys (a fork changes them in `messages-overrides`). A SERVER component; the
 * heading is an `h2` (the page's `h1` is the visually hidden one, `docs/contracts/home-sections.md`).
 *
 * TODO(fluxkit): the picture is the template's demo illustration (`public/home/hero.svg`, 640 x 480) stretched over the band with
 * `object-cover`; the client's real photograph replaces the file (same name) or `HERO_IMAGE` below. `LocalPicture` and
 * `LocalImage` are internal, not contract (`docs/customization.md`, "Known gap").
 */
const HERO_IMAGE: LocalImage = { src: "/home/hero.svg", width: 640, height: 480, altKey: null };

export function HeroOverlay({ headingId, locale, t, isFirst }: CustomSectionProps) {
  return (
    <section aria-labelledby={headingId} className="relative isolate flex min-h-96 items-center">
      <LocalPicture
        image={HERO_IMAGE}
        t={t}
        eager={isFirst}
        sizes="100vw"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <Container className="py-12">
        <div className="flex max-w-xl flex-col items-start gap-4 rounded-card bg-background/90 p-6 shadow-raised">
          <h2 id={headingId} className={textStyles.pageTitle}>
            {t("home.hero.title")}
          </h2>
          <p className="text-muted-foreground">{t("home.hero.description")}</p>
          <Link href={localizedHref(locale, "/catalog")} className={`${linkButton} px-6`}>
            {t("home.hero.cta")}
          </Link>
        </div>
      </Container>
    </section>
  );
}
