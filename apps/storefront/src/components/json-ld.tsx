import { serializeJsonLd } from "../lib/seo";

/**
 * The only place the storefront sets raw HTML, and what it sets is JSON that `serializeJsonLd` made safe for a script
 * element (`<` escaped, so no product text can close the tag). A test fails if `dangerouslySetInnerHTML` appears anywhere else.
 */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
