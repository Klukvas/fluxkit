import type { ReactNode } from "react";
import { cn } from "./cn";
import { textStyles } from "./styles";

export interface HeroProps {
  /** `id` of the heading; the section is labelled by it. */
  headingId: string;
  /** `h1` for the page's own heading (the first hero of the home page, a category banner), `h2` otherwise. */
  headingLevel: "h1" | "h2";
  title: string;
  /** One line under the heading; plain text, line breaks kept. */
  subline?: string | null;
  /** The call to action, rendered by the app (a router link styled as a button). */
  action?: ReactNode;
  /**
   * A picture beside the text from `md` (under it on a phone, so the heading and the action come first), rendered by the app with its own width and height. It sits on
   * the `muted` surface, so an image with its own background (a product photo, an illustration) reads in both themes.
   */
  media?: ReactNode;
  /**
   * `split` (default): the text beside the picture. `overlay` (reshape experiment): the picture fills the whole section and
   * the text sits on a translucent `background` panel over it, so it reads on any picture; the app sizes the picture to fill
   * (`h-full w-full object-cover`).
   */
  layout?: "split" | "overlay";
  className?: string;
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
  layout = "split",
  className,
}: HeroProps) {
  const Heading = headingLevel;
  if (layout === "overlay") {
    return (
      <section
        aria-labelledby={headingId}
        data-hero=""
        data-hero-layout="overlay"
        className={cn(
          "relative isolate grid min-h-96 items-center overflow-hidden bg-muted",
          className,
        )}
      >
        {media ? <div className="absolute inset-0 -z-10">{media}</div> : null}
        <div className="m-4 flex max-w-xl flex-col items-start gap-3 rounded-lg bg-background/85 p-6 md:m-10 md:p-8">
          <Heading
            id={headingId}
            className={cn(textStyles.pageTitle, headingLevel === "h1" ? "md:text-4xl" : null)}
          >
            {title}
          </Heading>
          {subline ? (
            <p className="text-lg whitespace-pre-line text-muted-foreground">{subline}</p>
          ) : null}
          {action ? <div className="mt-3">{action}</div> : null}
        </div>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      data-hero=""
      className={cn(
        "grid items-center gap-6 rounded-lg bg-muted p-6 md:p-10",
        media ? "md:grid-cols-2" : null,
        className,
      )}
    >
      <div className="flex flex-col items-start gap-3">
        <Heading
          id={headingId}
          className={cn(textStyles.pageTitle, headingLevel === "h1" ? "md:text-4xl" : null)}
        >
          {title}
        </Heading>
        {subline ? (
          <p className="max-w-prose text-lg whitespace-pre-line text-muted-foreground">{subline}</p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
      {media ? <div>{media}</div> : null}
    </section>
  );
}
