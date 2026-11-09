import type { Locale, Translator } from "@fluxkit/ui";
import Link from "next/link";
import { brand } from "../config/brand";
import type { BrandLogo as BrandLogoConfig, BrandPicture } from "../lib/brand";
import { localizedHref } from "../lib/locale-path";
import { LocalPicture } from "./local-picture";

function LogoPicture({
  picture,
  t,
  className,
}: {
  picture: BrandPicture;
  t: Translator;
  className: string;
}) {
  return (
    <LocalPicture
      image={{ ...picture, altKey: "site.name" }}
      t={t}
      eager
      lowPriority
      className={className}
    />
  );
}

/**
 * The header's home link (`config/brand.ts` `logo`, plan 2026-11-08-design-changeability.md B1). The default `text` logo is the
 * shop name with a `title` (a long name is truncated on a phone). An `image` logo is the picture alone, its alternative text the
 * shop name and no `title`; a light/dark pair renders both pictures and `app/globals.css` (`.fk-logo-light`, `.fk-logo-dark`)
 * hides the one that does not match `<html data-theme>` (the theme comes from the cookie on the server, ADR 0045, so a
 * `<picture media>` would follow the device instead). Pictures load eagerly with `fetchpriority="low"`, so React adds no
 * `<link rel="preload">` to the head (it does for an eager `high` picture) and the logo never competes with the page's main picture.
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
  if (logo.kind === "text") {
    return (
      <Link href={href} title={t("site.name")} className="fk-logo">
        {t("site.name")}
      </Link>
    );
  }
  if ("darkSafe" in logo) {
    return (
      <Link href={href} className="fk-logo">
        <LogoPicture picture={logo.light} t={t} className="fk-logo-image" />
      </Link>
    );
  }
  return (
    <Link href={href} className="fk-logo">
      <LogoPicture picture={logo.light} t={t} className="fk-logo-image fk-logo-light" />
      <LogoPicture picture={logo.dark} t={t} className="fk-logo-image fk-logo-dark" />
    </Link>
  );
}
