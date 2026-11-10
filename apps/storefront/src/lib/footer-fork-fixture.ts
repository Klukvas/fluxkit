import type { FooterConfig } from "../layout/footer-layout";

/**
 * A FILLED footer config as a client fork would write it (`config/footer.ts`), for `vitest.brand-fork.config.ts` only (see
 * `header-fork-fixture.ts`). It follows the guide's four-column recipe (`docs/customization.md`, UI slots): `navigation` and
 * `contacts` are left out of `blocks` because the `footer.columns` slot of `slots-fork-fixture.tsx` renders the links and
 * contacts; a text line, the theme switch and the copyright stay. A spec that silently needs the template's footer blocks
 * fails upstream here; specs that pin the template's footer mock `config/footer` to the template default
 * (`test-support/template-defaults.ts`). The link groups (with a heading and the fork's own links) are what the fork would
 * keep for a later return of the `navigation` block.
 */
export const footerConfig: FooterConfig = {
  blocks: ["copyright", { kind: "text", textKey: "site.description" }, "themeSwitch"],
  navigation: {
    groups: [
      { kind: "legal", headingKey: "footer.nav.label" },
      { kind: "shopPages" },
      { kind: "links", links: [{ labelKey: "nav.catalog", href: "/catalog" }] },
    ],
  },
};
