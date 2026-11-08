/** Visible keyboard focus from the ring token. An outline (not box-shadow) so it survives forced-colors mode. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Shared look of form controls that hold text. The invalid state follows aria-invalid, so it cannot drift from it. */
export const controlBase =
  "min-h-11 w-full rounded-md border border-border-input bg-background px-3 py-2 text-foreground disabled:opacity-50 aria-invalid:border-danger";

/**
 * Text roles of the design kit (review D-19): one class string per role, so a redesign changes a heading style in one place.
 * Sizes come from the type-scale tokens (`--fk-font-size-*`), colours from the colour tokens.
 */
export const textStyles = {
  /** The page's `h1`. */
  pageTitle: "font-display text-3xl font-bold text-foreground",
  /** A section heading inside a page (`h2`). */
  sectionTitle: "font-display text-xl font-semibold text-foreground",
  /** A smaller heading inside a section or card (`h2`/`h3`). */
  subsectionTitle: "font-display text-lg font-semibold text-foreground",
  /** Secondary information next to content: hints, meta lines. */
  meta: "text-sm text-muted-foreground",
} as const;
