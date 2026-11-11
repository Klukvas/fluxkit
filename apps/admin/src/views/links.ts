const linkLook = "font-medium text-foreground underline underline-offset-4";

/** A link inside running text: as tall as its line (links in sentences are exempt from WCAG 2.5.8). */
export const inlineLinkClass = linkLook;

/**
 * A link on its own (a table cell, a back link, a pager, a panel's next step): at least 24 px high (WCAG 2.5.8), 44 px on a
 * touch screen, the sizing of `Breadcrumbs` and `subNavLinkClass`.
 */
export const standaloneLinkClass = `inline-flex min-h-6 items-center pointer-coarse:min-h-11 ${linkLook}`;
