import type { Translator } from "@fluxkit/ui";
import Image from "next/image";
import type { LocalImage } from "../config/home";

/**
 * A picture of the template's own files under `public/` (the home hero, category tiles and banners from `config/home.ts`
 * and `config/category-page.ts`). The second way to an image besides `StoreImage`, for config files only: a path that is not
 * a plain site-relative path is refused, so no remote host can come in this way (remote images go through `StoreImage` and
 * the host allow-list). Width and height reserve the space; `eager` is for the largest picture above the fold.
 */
export function LocalPicture({
  image,
  t,
  eager,
  sizes,
  className,
}: {
  image: LocalImage;
  t: Translator;
  eager: boolean;
  sizes: string;
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
      fetchPriority={eager ? "high" : "auto"}
      className={className}
    />
  );
}
