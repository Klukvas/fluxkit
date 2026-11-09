import type { Translator } from "@fluxkit/ui";
import Image from "next/image";
import type { LocalImage } from "../config/home";

/**
 * A picture of the template's own files under `public/` (the home hero, category tiles and banners from `config/home.ts`
 * and `config/category-page.ts`). The second way to an image besides `StoreImage`, for config files only: a path that is not
 * a plain site-relative path is refused, so no remote host can come in this way (remote images go through `StoreImage` and
 * the host allow-list). Width and height reserve the space; `eager` is for the largest picture above the fold
 * (`fetchpriority="high"`, which React also announces with a `<link rel="preload">`). `lowPriority` loads an eager picture
 * with `fetchpriority="low"` instead, which React does NOT preload: the header logo (`brand-logo.tsx`) is on every page and
 * must not compete with the page's main picture or grow the head. Without a sizes hint a raster picture gets a 1x/2x `srcset`
 * (a fixed-size picture such as a logo).
 */
export function LocalPicture({
  image,
  t,
  eager,
  lowPriority = false,
  sizes,
  className,
}: {
  image: LocalImage;
  t: Translator;
  eager: boolean;
  lowPriority?: boolean;
  sizes?: string;
  className: string;
}) {
  if (!/^\/[A-Za-z0-9._-]/.test(image.src)) {
    throw new Error(`A config picture must be a file under public/, not "${image.src}".`);
  }
  return (
    <Image
      src={image.src}
      width={image.width}
      height={image.height}
      alt={image.altKey === null ? "" : t(image.altKey)}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={lowPriority ? "low" : eager ? "high" : "auto"}
      className={className}
    />
  );
}
