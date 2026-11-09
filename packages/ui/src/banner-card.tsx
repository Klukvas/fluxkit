import type { ReactNode } from "react";
import { cn } from "./cn";
import { focusRing, textStyles } from "./styles";

export type BannerCardLayout = "card" | "image";
export type BannerCardTone = "surface" | "accent";

/** What `renderLink` receives: the card's classes, its accessible name and description, and its content. */
export interface BannerCardLinkProps {
  className: string;
  /** The title's id (`card` layout): the link is named by the title, not by the picture's alt plus the text. */
  "aria-labelledby"?: string;
  /** The text's id (`card` layout with a text). */
  "aria-describedby"?: string;
  children: ReactNode;
}

export interface BannerCardProps {
  /** Unique in the page: the title and text ids are `<id>-title` and `<id>-text`. */
  id: string;
  /** `card`: picture, title, text. `image`: a finished picture alone; its alt is the link's name. */
  layout: BannerCardLayout;
  /** `card` only; `image` has no tone of its own (the picture is the design). */
  tone?: BannerCardTone;
  /** `card` only. */
  title?: string | null;
  /** `card` only, optional. */
  text?: string | null;
  /**
   * The picture, rendered by the app with its own `src`, `width`, `height` and `alt` (`""` for a decorative `card` picture),
   * filling the fixed 2:1 frame (`h-full w-full object-cover`), so a picture of another ratio is cropped, never shifts the
   * layout.
   */
  picture: ReactNode;
  /**
   * Renders the card's ONE link (a router link, a plain anchor for an external address, or a non-link element in an admin
   * preview). It must spread the props it gets onto the element.
   */
  renderLink: (props: BannerCardLinkProps) => ReactNode;
  /** `h3` under a section's `h2` (the home page), `h2` elsewhere. */
  headingLevel?: "h2" | "h3";
}

const TONES: Record<BannerCardTone, { card: string; text: string | null }> = {
  surface: {
    card: "border-border bg-background text-foreground hover:border-border-input",
    text: "text-muted-foreground",
  },
  // The tone NAME is stored by the API (`banner.tone`); its colour is the accent token pair, which equals primary by default.
  accent: {
    card: "border-accent bg-accent text-accent-foreground",
    // Inherits the card's `accent-foreground` (the muted grey would not read on the accent fill).
    text: null,
  },
};

const FRAME = "block aspect-2/1 overflow-hidden bg-muted";

/**
 * A home page promotional banner (plan 2026-11-05-admin-home-banners.md, D6 and section 7), shared by the storefront and
 * the admin's preview so both draw the same card. Each banner is ONE link: a `card` is named by its title
 * (`aria-labelledby`) and described by its text, so the picture's alt and the text do not pile up in the name; an `image`
 * is named by its picture's alt. Presentational: no copy, no routing, tokens only; every string comes from props.
 */
export function BannerCard({
  id,
  layout,
  tone = "surface",
  title,
  text,
  picture,
  renderLink,
  headingLevel = "h3",
}: BannerCardProps) {
  if (layout === "image") {
    return renderLink({
      className: cn(
        "group block overflow-hidden rounded-lg border border-border transition-shadow hover:border-border-input hover:shadow-raised motion-reduce:transition-none",
        focusRing,
      ),
      children: <span className={FRAME}>{picture}</span>,
    });
  }
  const colours = TONES[tone];
  const Heading = headingLevel;
  const titleId = `${id}-title`;
  const textId = `${id}-text`;
  const hasText = text !== null && text !== undefined && text !== "";
  return renderLink({
    className: cn(
      "group flex h-full flex-col overflow-hidden rounded-lg border transition-shadow hover:shadow-raised motion-reduce:transition-none",
      colours.card,
      focusRing,
    ),
    "aria-labelledby": titleId,
    ...(hasText ? { "aria-describedby": textId } : {}),
    children: (
      <>
        <span className={FRAME}>{picture}</span>
        <span className="flex flex-col gap-1 p-4">
          <Heading
            id={titleId}
            className={cn(
              textStyles.dialogTitle,
              "group-hover:underline group-hover:underline-offset-4",
            )}
          >
            {title}
          </Heading>
          {hasText ? (
            <span id={textId} className={colours.text ?? undefined}>
              {text}
            </span>
          ) : null}
        </span>
      </>
    ),
  });
}
