import { Breadcrumbs, Container, createTranslator, isLocale } from "@fluxkit/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "../../../../../components/json-ld";
import { ProductDetails } from "../../../../../components/product-details";
import { ProductPurchase } from "../../../../../components/product-purchase";
import { attributeRows } from "../../../../../lib/attributes";
import { getProductPage } from "../../../../../lib/catalog-pages.server";
import { catalogPath } from "../../../../../lib/catalog-query";
import { IMAGE_HOSTS } from "../../../../../lib/image-hosts";
import { localizedHref } from "../../../../../lib/locale-path";
import { productMetadata } from "../../../../../lib/page-metadata";
import { prepareMedia } from "../../../../../lib/product-media";
import { publicOrigin } from "../../../../../lib/public-url.server";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  productJsonLd,
  socialImageUrl,
  trimDescription,
} from "../../../../../lib/seo";
import { messagesByLocale } from "../../../../../messages";

interface ProductProps {
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * An unknown, unpublished or unsellable slug is a REAL 404: `notFound()` runs before anything streams, and no `loading.tsx`
 * sits above this route (README, "Rendering"; `route-structure.spec.ts`).
 */
async function resolve({ params }: ProductProps) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const page = await getProductPage(locale, slug);
  if (page.kind === "not_found") notFound();
  return { locale, page };
}

export async function generateMetadata(props: ProductProps): Promise<Metadata> {
  const { locale, page } = await resolve(props);
  return productMetadata({
    origin: await publicOrigin(),
    locale,
    t: createTranslator(messagesByLocale[locale], locale),
    product: page.product,
  });
}

export default async function ProductPage(props: ProductProps) {
  const { locale, page } = await resolve(props);
  const { product, exponent, trail } = page;
  const t = createTranslator(messagesByLocale[locale], locale);
  const origin = await publicOrigin();
  const url = absoluteUrl(origin, localizedHref(locale, `/p/${encodeURIComponent(product.slug)}`));
  const homeHref = localizedHref(locale, "/");

  const crumbs = [
    { label: t("breadcrumbs.home"), href: homeHref },
    ...trail.map((node) => ({
      label: node.name,
      href: localizedHref(locale, `/c/${encodeURIComponent(node.slug)}`),
    })),
    { label: product.title },
  ];
  const images = product.media
    .map((item) => socialImageUrl(item.url))
    .filter((image): image is string => image !== null);

  return (
    <Container className="flex flex-col gap-6 py-8">
      <Breadcrumbs label={t("breadcrumbs.label")} items={crumbs} />
      <ProductPurchase
        product={{
          id: product.id,
          title: product.title,
          options: product.options,
          variants: product.variants,
          price: product.price,
          availability: product.availability,
        }}
        gallery={prepareMedia(product.media, IMAGE_HOSTS)}
        exponent={exponent}
        brand={
          product.brand === null
            ? null
            : {
                name: product.brand.name,
                path: catalogPath("/catalog", { brand: product.brand.slug }),
              }
        }
      >
        <ProductDetails
          description={product.description}
          attributes={attributeRows(product, t, locale)}
          t={t}
        />
      </ProductPurchase>
      <JsonLd
        data={productJsonLd({
          product,
          url,
          exponent,
          images,
          description: trimDescription(product.description),
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbs.home"), url: absoluteUrl(origin, homeHref) },
          ...trail.map((node) => ({
            name: node.name,
            url: absoluteUrl(origin, localizedHref(locale, `/c/${encodeURIComponent(node.slug)}`)),
          })),
          { name: product.title, url },
        ])}
      />
    </Container>
  );
}
