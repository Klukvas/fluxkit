/** Visible keyboard focus from the ring token. An outline (not box-shadow) so it survives forced-colors mode. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** Shared look of form controls that hold text. The invalid state follows aria-invalid, so it cannot drift from it. */
export const controlBase =
  "min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50 aria-invalid:border-danger";
