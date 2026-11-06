import type { Locale, Translator } from "@fluxkit/ui";
import Link from "next/link";
import { productNoteView } from "../lib/shop-pages";
import { focusRing } from "./styles";

/**
 * "Delivery and returns" under the product page's buy box (repair batch 2): the delivery page's one-line summary and links to
 * the delivery and returns pages (`productPageNote` of `config/shop-pages.ts`). Server-rendered and passed into the purchase
 * island as `note`, so its texts stay out of the client messages; static text, so nothing moves when the page hydrates.
 * Nothing when the note is switched off or none of its pages is enabled.
 */
export function ProductPageNote({ locale, t }: { locale: Locale; t: Translator }) {
  const note = productNoteView(locale);
  if (note === null) return null;
  return (
    <div className="flex flex-col gap-1 text-sm text-muted-foreground" data-product-note="">
      <p className="font-medium text-foreground">{t(note.titleKey)}</p>
      <p>{t(note.summaryKey)}</p>
      <ul className="flex flex-wrap gap-x-4">
        {note.links.map((link) => (
          <li key={link.slug}>
            <Link
              href={link.href}
              className={`inline-flex min-h-6 items-center text-foreground underline underline-offset-4 ${focusRing}`}
            >
              {t(link.titleKey)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
