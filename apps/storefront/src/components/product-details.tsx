import type { Translator } from "@fluxkit/ui";
import type { AttributeRow } from "../lib/attributes";

/**
 * Description and specifications under the purchase block. Server component. The description is PLAIN TEXT from the API
 * (the contract has no markup): React escapes it and `whitespace-pre-line` keeps its line breaks. Nothing from the API is
 * ever rendered as HTML.
 */
export function ProductDetails({
  description,
  attributes,
  t,
}: {
  description: string | null;
  attributes: readonly AttributeRow[];
  t: Translator;
}) {
  const hasDescription = description !== null && description.trim() !== "";
  if (!hasDescription && attributes.length === 0) return null;
  return (
    <div className="mt-10 flex flex-col gap-8">
      {hasDescription ? (
        <section aria-labelledby="product-description-title" className="flex flex-col gap-2">
          <h2 id="product-description-title" className="text-xl font-semibold text-foreground">
            {t("product.description.title")}
          </h2>
          <p className="whitespace-pre-line text-foreground">{description}</p>
        </section>
      ) : null}
      {attributes.length === 0 ? null : (
        <section aria-labelledby="product-attributes-title" className="flex flex-col gap-2">
          <h2 id="product-attributes-title" className="text-xl font-semibold text-foreground">
            {t("product.attributes.title")}
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {attributes.map((row) => (
              <div key={row.code} className="flex flex-col border-b border-border py-2">
                <dt className="text-sm text-muted-foreground">{row.name}</dt>
                <dd className="text-foreground">{row.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
