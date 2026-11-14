import { cn, Hero, type HeroProps, type Translator, type Locale } from "@fluxkit/ui";
import type { HeroDecoration, HeroSection } from "../config/home";
import Link from "next/link";
import { localizedHref } from "../lib/locale-path";
import { LocalPicture } from "./local-picture";
import { linkButton } from "./styles";
import "./home-sections-motion.css";

function Highlight({ title, phrase }: { title: string; phrase: string | undefined }) {
  if (phrase === undefined) return title;
  const start = phrase === "" ? -1 : title.indexOf(phrase);
  if (start < 0) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Home hero highlight is absent from its translated headline.");
    }
    return title;
  }
  return (
    <>
      {title.slice(0, start)}
      <span className="fk-home-marker" data-home-highlight="">
        {phrase}
      </span>
      {title.slice(start + phrase.length)}
    </>
  );
}

function Sticker({ sectionId, text }: { sectionId: string; text: string }) {
  // Encode every code point, including punctuation: distinct section ids cannot collapse to the same path id.
  const pathId = `home-sticker-${Array.from(sectionId, (char) => char.codePointAt(0)?.toString(16)).join("-")}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 120 120"
      className="fk-home-sticker rounded-full"
      data-home-sticker=""
    >
      <circle cx="60" cy="60" r="57" strokeWidth="2" className="fk-home-sticker-surface" />
      <defs>
        <path id={pathId} d="M 60,60 m -42,0 a 42,42 0 1,1 84,0 a 42,42 0 1,1 -84,0" />
      </defs>
      <text textLength="260" lengthAdjust="spacing">
        <textPath href={`#${pathId}`}>{text}</textPath>
      </text>
    </svg>
  );
}

/** Composes UI Hero slots only when the config opts into decoration. */
function DecoratedHomeHero({
  headingId,
  headingLevel,
  title,
  subline,
  action,
  media,
  className,
  decoration,
  sectionId,
  t,
}: HeroProps & { title: string; decoration: HeroDecoration; sectionId: string; t: Translator }) {
  const sticker = decoration.sticker ? (
    <Sticker sectionId={sectionId} text={t(decoration.sticker.textKey)} />
  ) : null;
  return (
    <Hero
      headingId={headingId}
      headingLevel={headingLevel}
      title={
        <Highlight
          title={title}
          phrase={decoration.highlightKey === undefined ? undefined : t(decoration.highlightKey)}
        />
      }
      subline={subline}
      action={action}
      className={cn("fk-home-hero", className)}
      data-home-decorated=""
      data-home-pop-in={decoration.popIn ? "" : undefined}
      mediaClassName={media ? "fk-home-hero-media" : undefined}
      media={
        media ? (
          <>
            {decoration.blob ? (
              <div aria-hidden="true" className="fk-home-blob" data-home-blob="" />
            ) : null}
            <div className="fk-home-hero-picture">{media}</div>
            {sticker}
          </>
        ) : undefined
      }
      ornament={media ? undefined : sticker}
    />
  );
}

/** Keep the legacy Hero path unchanged when a fork omits the new options. */
export function HeroView({
  section,
  context,
  isPageHeading,
}: {
  section: HeroSection;
  context: { t: Translator; locale: Locale };
  isPageHeading: boolean;
}) {
  const { t, locale } = context;
  const props = {
    headingId: `${section.id}-title`,
    headingLevel: isPageHeading ? "h1" : "h2",
    title: t(section.headlineKey),
    subline: section.sublineKey === undefined ? null : t(section.sublineKey),
    action:
      section.cta === undefined ? undefined : (
        <Link href={localizedHref(locale, section.cta.href)} className={`${linkButton} px-6`}>
          {t(section.cta.labelKey)}
        </Link>
      ),
    media:
      section.image === undefined ? undefined : (
        <LocalPicture
          image={section.image}
          t={t}
          // The first hero is the largest paint above the fold: load it at once.
          eager={isPageHeading}
          sizes="(min-width: 768px) 50vw, 100vw"
          className="h-auto w-full rounded-media"
        />
      ),
  } satisfies HeroProps;
  return section.decoration === undefined ? (
    <Hero {...props} />
  ) : (
    <DecoratedHomeHero {...props} decoration={section.decoration} sectionId={section.id} t={t} />
  );
}
