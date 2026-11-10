import type { HomeSection } from "../config/home";
import type { CustomSectionProps, CustomSectionRegistry } from "./custom-sections";

/**
 * A FILLED `config/custom-sections.ts` as a client fork would write it, plus a home config that uses it, for
 * `vitest.home-fork.config.ts` only: that run replaces `config/custom-sections.ts` with this file and runs the unit suite
 * again, so a spec that silently depends on the empty registry fails upstream instead of in a fork (plan
 * 2026-11-08-design-changeability.md, L4). `components/home-sections.fork.spec.tsx` renders `forkHomeSections` in that run.
 */

/** A brand strip: a server component of the fork, given the plain view model only. */
function ForkBrandStrip({ headingId, t, isFirst }: CustomSectionProps) {
  return (
    <section aria-labelledby={headingId} data-fork-brand-strip="">
      <h2 id={headingId} className="sr-only">
        {t("custom.brandStrip.title")}
      </h2>
      <ul className="flex flex-wrap justify-center gap-6 text-muted-foreground">
        <li>{t("custom.brandStrip.first")}</li>
        <li>{t("custom.brandStrip.second")}</li>
      </ul>
      {isFirst ? null : <p className="sr-only">{t("custom.brandStrip.note")}</p>}
    </section>
  );
}

export const customSections: CustomSectionRegistry = { brandStrip: ForkBrandStrip };

/** Reshape request 4 of the plan: a full-bleed hero, the brand strip as a band, then the template's sections. */
export const forkHomeSections: readonly HomeSection[] = [
  {
    kind: "hero",
    id: "home-hero",
    headlineKey: "home.hero.title",
    cta: { labelKey: "home.hero.cta", href: "/catalog" },
    width: "full",
  },
  { kind: "custom", id: "home-brands", name: "brandStrip", width: "full" },
  { kind: "categories", id: "home-categories", titleKey: "home.categoryTiles.title", limit: 6 },
  { kind: "trust", id: "home-trust", titleKey: "home.trust.title", width: "contained" },
  { kind: "richText", id: "home-about", titleKey: "home.about.title", bodyKey: "home.about.body" },
];
