import { Disclosure, type Translator } from "@fluxkit/ui";
import type { AttributeRow } from "../lib/attributes";
import { SelectedSku } from "./selected-sku";

/**
 * Description and specifications of the product page, as collapsible sections that start open (review D-08; native
 * `<details>`, so they work without a script and keep their `h2`). Server component. The description is PLAIN TEXT from the
 * API (the contract has no markup): React escapes it and `whitespace-pre-line` keeps its line breaks. Nothing from the API is
 * ever rendered as HTML. The first specification is the selected variant's SKU (`SelectedSku`, from the purchase island).
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
  return (
    <div className="flex flex-col">
      {hasDescription ? (
        <Disclosure title={t("product.description.title")} headingId="product-description-title">
          <p className="whitespace-pre-line text-foreground">{description}</p>
        </Disclosure>
      ) : null}
      <Disclosure title={t("product.attributes.title")} headingId="product-attributes-title">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex flex-col border-b border-border py-2">
            <dt className="text-sm text-muted-foreground">{t("product.sku.label")}</dt>
            <dd className="break-all text-foreground">
              <SelectedSku />
            </dd>
          </div>
          {attributes.map((row) => (
            <div key={row.code} className="flex flex-col border-b border-border py-2">
              <dt className="text-sm text-muted-foreground">{row.name}</dt>
              <dd className="text-foreground">{row.text}</dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}
