/** Visible keyboard focus from the ring token. An outline (not box-shadow) so it survives forced-colors mode. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Shared look of form controls that hold text. The invalid state follows aria-invalid, so it cannot drift from it. */
export const controlBase =
  "min-h-11 w-full rounded-md border border-border-input bg-background px-3 py-2 text-foreground disabled:opacity-50 aria-invalid:border-danger";

/**
 * Text roles of the design kit (review D-19): one class string per role, so a redesign changes a heading style in one place.
 * Sizes come from the type-scale tokens (`--fk-font-size-*`), colours from the colour tokens. Every heading (and legend) of
 * `@fluxkit/ui` and the storefront starts from a role (`design-guard.spec.ts`); a call site adds layout or focus classes only.
 * `font-display` (`--fk-font-display`, the body stack by default) is on `pageTitle` and `sectionTitle` only: a decorative face
 * in small titles hurts legibility.
 */
export const textStyles = {
  /** The page's `h1`. */
  pageTitle: "font-display text-3xl font-bold text-foreground",
  /** A smaller page `h1`: status pages (error, not found) and the order page (which adds `sm:text-3xl`). */
  pageTitleCompact: "text-2xl font-bold text-foreground",
  /** A section heading inside a page (`h2`), also a form section's `legend`. */
  sectionTitle: "font-display text-xl font-semibold text-foreground",
  /** A smaller heading inside a section or card (`h2`/`h3`). */
  subsectionTitle: "text-lg font-semibold text-foreground",
  /** A heading in body size: a line item, a short list, a field group's `legend`. */
  itemTitle: "font-semibold text-foreground",
  /** The product name on a card (the card adds its own line clamp). */
  cardTitle: "font-medium text-foreground",
  /** The title of a dialog or of another surface that sets its own text colour (a toned banner card): no colour here. */
  dialogTitle: "text-lg font-semibold",
  /** A small muted heading over a group of navigation links (`SideNav`). */
  navGroupTitle: "text-sm font-semibold text-muted-foreground",
  /** Secondary information next to content: hints, meta lines. */
  meta: "text-sm text-muted-foreground",
} as const;
