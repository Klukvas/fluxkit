import type { Translator } from "@fluxkit/ui";
import type { GalleryItem } from "../lib/product-media";
import { StoreImage } from "./store-image";
import { focusRing } from "./styles";

/** Gallery view keeps image selection in the purchase island. */
export function ProductPurchaseGallery({
  current,
  images,
  activeImage,
  title,
  t,
  onImage,
}: {
  current: GalleryItem;
  images: readonly GalleryItem[];
  activeImage: number;
  title: string;
  t: Translator;
  onImage: (index: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label={t("product.gallery.label")}
      className="flex flex-col gap-3 lg:col-span-7"
    >
      <StoreImage
        key={current.src ?? "placeholder"}
        src={current.src}
        alt={current.alt ?? title}
        width={960}
        height={960}
        sizes="(min-width: 768px) 50vw, 100vw"
        eager
      />
      {images.length > 1 ? (
        <ul className="flex flex-wrap gap-2">
          {images.map((item, index) => (
            <li key={`${index}-${item.src ?? "placeholder"}`}>
              <button
                type="button"
                aria-label={t("product.gallery.show", {
                  index: index + 1,
                  total: images.length,
                })}
                aria-pressed={index === activeImage}
                onClick={() => onImage(index)}
                className={`block w-16 rounded-media border-2 ${index === activeImage ? "border-primary" : "border-border"} ${focusRing}`}
              >
                <StoreImage src={item.src} alt="" width={96} height={96} sizes="64px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
