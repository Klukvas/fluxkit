const linkLook = "font-medium text-foreground underline underline-offset-4";

/** A link inside running text: as tall as its line (links in sentences are exempt from WCAG 2.5.8). */
export const inlineLinkClass = linkLook;

/**
 * A link on its own (a table cell, a back link, a pager, a panel's next step): at least 24 px high (WCAG 2.5.8), 44 px on a
 * touch screen, the sizing of `Breadcrumbs` and `subNavLinkClass`.
 */
export const standaloneLinkClass = `inline-flex min-h-6 items-center pointer-coarse:min-h-11 ${linkLook}`;

const focusClass =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * A link that looks like the primary button (the create actions). The focus outline is its own string, as in the UI library:
 * it sits two pixels outside the box, on the page background, so the contrast scan must not pair it with the button fill.
 */
export const primaryLinkClass = `inline-flex items-center justify-center rounded-control bg-primary px-4 py-2 font-medium text-primary-foreground ${focusClass}`;
