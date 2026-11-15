import type { ReactNode } from "react";
import { cn } from "./cn";
import { textStyles } from "./styles";

export interface HeroProps {
  /** `id` of the heading; the section is labelled by it. */
  headingId: string;
  /** `h1` for the page's own heading (the first hero of the home page, a category banner), `h2` otherwise. */
  headingLevel: "h1" | "h2";
  /** Phrasing content only: rendered inside the h1/h2. A string renders as before. */
  title: ReactNode;
  /** One line under the heading; plain text, line breaks kept. */
  subline?: string | null;
  /** The call to action, rendered by the app (a router link styled as a button). */
  action?: ReactNode;
  /**
   * A picture beside the text from `md` (under it on a phone, so the heading and the action come first), rendered by the app with its own width and height. It sits on
   * the `muted` surface, so an image with its own background (a product photo, an illustration) reads in both themes.
   */
  media?: ReactNode;
  /** Class of the media wrapper; omitted keeps the wrapper a bare div. */
  mediaClassName?: string;
  /** Last section child, after text and media; supply aria-hidden decoration that does not affect the grid. */
  ornament?: ReactNode;
  className?: string;
  [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A banner: heading, subline, call to action and an optional picture on a token surface (review D-18). Used by the home
 * page's `hero` sections and the category page header. It knows no copy and no routing: everything comes from props.
 */
export function Hero({
  headingId,
  headingLevel,
  title,
  subline,
  action,
  media,
  mediaClassName,
  ornament,
  className,
  ...dataAttributes
}: HeroProps) {
  const Heading = headingLevel;
  return (
    <section
      aria-labelledby={headingId}
      data-hero=""
      {...dataAttributes}
      className={cn(
        "grid items-center gap-6 rounded-card bg-muted p-6 md:p-10",
        media ? "md:grid-cols-2" : null,
        className,
      )}
    >
      <div className="flex min-w-0 flex-col items-start gap-3">
        <Heading
          id={headingId}
          className={cn(
            textStyles.displayTitle,
            "w-full break-words",
            headingLevel === "h1" ? "md:text-4xl" : null,
          )}
        >
          {title}
        </Heading>
        {subline ? (
          <p className="max-w-prose text-lg whitespace-pre-line text-muted-foreground">{subline}</p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
      {media ? <div className={mediaClassName}>{media}</div> : null}
      {ornament}
    </section>
  );
}
