import type { Locale, Translator } from "@fluxkit/ui";
import Link from "next/link";
import { brand } from "../config/brand";
import {
  isPublicFilePath,
  type BrandLogo as BrandLogoConfig,
  type BrandPicture,
} from "../lib/brand";
import { localizedHref } from "../lib/locale-path";

/**
 * One logo picture: a plain img element, not `next/image`. The header is on every page, and importing `next/image` here would put
 * its client component into the JavaScript of every page (sign-in and registration included) for a picture that needs no
 * optimisation (a logo is small, SVG recommended). Only a file under `public/` is accepted, by the same rule as the config
 * check (`isPublicFilePath` of `lib/brand.ts`: no `//`, no `..`), so no remote host comes in through the brand config
 * (`source-guards.spec.ts`). Both pictures of a light/dark pair are fetched: the hidden one is `display: none`, which does not
 * stop the download. `fetchpriority="low"`: React adds no `<link rel="preload">`
 * to the head (it does for an eager picture otherwise), and the logo never competes with the page's main picture.
 */
function LogoPicture({
  picture,
  alt,
  className,
}: {
  picture: BrandPicture;
  alt: string;
  className: string;
}) {
  if (!isPublicFilePath(picture.src)) {
    throw new Error(`A logo picture must be a file under public/, not "${picture.src}".`);
  }
  return (
    <img
      src={picture.src}
      width={picture.width}
      height={picture.height}
      alt={alt}
      loading="eager"
      fetchPriority="low"
      decoding="async"
      className={className}
    />
  );
}

/**
 * The header's home link (`config/brand.ts` `logo`, plan 2026-11-08-design-changeability.md B1). The default `text` logo is the
 * shop name with a `title` (a long name is truncated on a phone). An `image` logo is the picture alone, its alternative text the
 * shop name and no `title`; a light/dark pair renders both pictures and `app/globals.css` (`.fk-logo-light`, `.fk-logo-dark`)
 * hides the one that does not match `<html data-theme>` (the theme comes from the cookie on the server, ADR 0045, so a
 * `<picture media>` would follow the device instead).
 */
export function BrandLogo({
  locale,
  t,
  logo = brand.logo,
}: {
  locale: Locale;
  t: Translator;
  /** `config/brand.ts`; a prop for tests. */
  logo?: BrandLogoConfig;
}) {
  const href = localizedHref(locale, "/");
  const name = t("site.name");
  if (logo.kind === "text") {
    return (
      <Link href={href} title={name} className="fk-logo">
        {name}
      </Link>
    );
  }
  if ("darkSafe" in logo) {
    return (
      <Link href={href} className="fk-logo">
        <LogoPicture picture={logo.light} alt={name} className="fk-logo-image" />
      </Link>
    );
  }
  return (
    <Link href={href} className="fk-logo">
      <LogoPicture picture={logo.light} alt={name} className="fk-logo-image fk-logo-light" />
      <LogoPicture picture={logo.dark} alt={name} className="fk-logo-image fk-logo-dark" />
    </Link>
  );
}
