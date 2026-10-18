"use client";

import { cn, ProductImage } from "@fluxkit/ui";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export interface StoreImageProps {
  /** An already checked URL (`allowedImageUrl`), or `null` for the placeholder. Never an unchecked API URL. */
  src: string | null;
  /** Never empty for an informative image: the page passes the media alt or the product title. */
  alt: string;
  /** Intrinsic size: reserves the space (no layout shift); CSS decides the rendered size. */
  width: number;
  height: number;
  /** Rendered widths per breakpoint, so `next/image` serves a fitting size. */
  sizes: string;
  /** Above the fold: load at once and with high priority. Everything else is lazy. */
  eager?: boolean;
  className?: string;
}

/**
 * A product image through `next/image` (owner answer 7). Only URLs of the build-time host allow-list reach it; a missing
 * URL, a host that is not allowed, or an image that fails to load (also one that failed before hydration) shows the
 * token-styled placeholder of `@fluxkit/ui`, never a broken image. A client component because of that fallback state.
 */
export function StoreImage({
  src,
  alt,
  width,
  height,
  sizes,
  eager = false,
  className,
}: StoreImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (src !== null && image !== null && image.complete && image.naturalWidth === 0) {
      setFailedSrc(src);
    }
  }, [src]);

  if (src === null || failedSrc === src) {
    return (
      <ProductImage src={null} alt={alt} width={width} height={height} className={className} />
    );
  }
  return (
    <Image
      ref={imageRef}
      src={src}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      className={cn("aspect-square h-auto w-full rounded-md object-cover", className)}
      onError={() => setFailedSrc(src)}
    />
  );
}
