import { Container } from "@fluxkit/ui";
import type { CustomSectionProps, CustomSectionRegistry } from "./custom-sections";

/**
 * A client fork's `config/custom-sections.ts` as it would write it, for `vitest.home-fork.config.ts` only (with
 * `home-config-fork-fixture.ts` in place of `config/home.ts` and `messages-extra-fork-fixture.{uk,en}.json` in place of the
 * extras): the unit suite runs again as such a fork has it, so a spec that depends on the template's defaults fails upstream,
 * not in a fork (plan 2026-11-08-design-changeability.md section 1, request 4: config and new files only).
 */

/** A brand strip: a server component of the fork, given the plain view model only; full width chooses its own surface. */
function ForkBrandStrip({ headingId, t, width }: CustomSectionProps) {
  const content = (
    <>
      <h2 id={headingId} className="sr-only">
        {t("custom.brandStrip.title")}
      </h2>
      <ul className="flex flex-wrap justify-center gap-6 text-muted-foreground">
        <li>{t("custom.brandStrip.first")}</li>
        <li>{t("custom.brandStrip.second")}</li>
      </ul>
    </>
  );
  return (
    <section aria-labelledby={headingId} data-fork-brand-strip="" className="bg-muted py-8">
      {width === "full" ? <Container>{content}</Container> : content}
    </section>
  );
}

/** A promotion line, contained: the page puts it in the content width. */
function ForkPromo({ headingId, t }: CustomSectionProps) {
  return (
    <section aria-labelledby={headingId} data-fork-promo="">
      <h2 id={headingId}>{t("custom.promo.title")}</h2>
    </section>
  );
}

export const customSections: CustomSectionRegistry = {
  brandStrip: ForkBrandStrip,
  promo: ForkPromo,
};
