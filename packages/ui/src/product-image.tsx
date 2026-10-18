"use client";

import { useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { cn } from "./cn";

export interface ProductImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "width" | "height"
> {
  src?: string | null;
  /** Alt text from the media record; an empty string marks the image as decorative. */
  alt: string;
  width: number;
  height: number;
}

/**
 * Client component on purpose: a failing image must fall back to the placeholder, which needs state and an
 * `onError` handler (plus a check in an effect for errors that happened before hydration). The server renders
 * the same markup as the first client render.
 */
export function ProductImage({
  src,
  alt,
  width,
  height,
  className,
  onError,
  ...props
}: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (src && image && image.complete && image.naturalWidth === 0) {
      setFailedSrc(src);
    }
  }, [src]);

  if (!src || failedSrc === src) {
    const accessibility = alt
      ? { role: "img", "aria-label": alt }
      : { "aria-hidden": true as const };
    return (
      <div
        className={cn("aspect-square w-full rounded-md bg-muted", className)}
        {...accessibility}
      />
    );
  }

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={cn("rounded-md object-cover", className)}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
      {...props}
    />
  );
}
