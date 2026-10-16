import type {
  AttributeDefinition,
  ProductSnapshot,
  ProductStatus,
  ProductTypeDefinition,
  VariantSnapshot,
} from "@fluxkit/core";
import { attributeLevelSchema } from "../product-types/product-types.schemas.js";
import { inputTypeSchema } from "../attributes/attributes.schemas.js";
import type {
  CategoryAssignmentRow,
  MediaRow,
  ProductOptionRow,
  ProductOptionValueRow,
  ProductRow,
  ProductTypeRows,
  VariantOptionValueRow,
  VariantRow,
} from "./products.repository.js";
import {
  productStatusSchema,
  type ProductCategoryResponse,
  type ProductDetailResponse,
  type ProductMediaResponse,
  type ProductOptionResponse,
  type ProductResponse,
  type ProductVariantResponse,
} from "./products.schemas.js";

/** Database row -> API shape. The only place where column names meet API field names. */
export function toProductResponse(row: ProductRow): ProductResponse {
  return {
    id: row.id,
    productTypeId: row.productTypeId,
    brandId: row.brandId,
    slug: row.slug,
    title: row.title,
    description: row.description,
    status: toStatus(row),
    attributes: row.attributes,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toStatus(row: Pick<ProductRow, "status">): ProductStatus {
  return productStatusSchema.parse(row.status);
}

function toCategoryResponse(row: CategoryAssignmentRow): ProductCategoryResponse {
  return { categoryId: row.categoryId, isPrimary: row.isPrimary, position: row.position };
}

function toMediaResponse(row: MediaRow): ProductMediaResponse {
  return {
    id: row.id,
    url: row.url,
    alt: row.alt,
    position: row.position,
    optionId: row.optionId,
    optionValueId: row.optionValueId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVariantResponse(
  row: VariantRow,
  optionValues: readonly VariantOptionValueRow[],
): ProductVariantResponse {
  return {
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    title: row.title,
    optionSignature: row.optionSignature,
    isDefault: row.isDefault,
    isActive: row.isActive,
    attributes: row.attributes,
    position: row.position,
    optionValues: optionValues
      .filter((value) => value.variantId === row.id)
      .map(({ optionId, optionCode, optionValueId, valueCode }) => ({
        optionId,
        optionCode,
        optionValueId,
        valueCode,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOptionResponse(
  row: ProductOptionRow,
  values: readonly ProductOptionValueRow[],
): ProductOptionResponse {
  return {
    optionId: row.optionId,
    optionCode: row.optionCode,
    position: row.position,
    values: values
      .filter((value) => value.optionId === row.optionId)
      .map(({ optionValueId, valueCode, position }) => ({ optionValueId, valueCode, position })),
  };
}

export interface ProductChildren {
  categories: CategoryAssignmentRow[];
  media: MediaRow[];
  variants: VariantRow[];
  variantOptionValues: VariantOptionValueRow[];
  options: ProductOptionRow[];
  optionValues: ProductOptionValueRow[];
}

export function toProductDetailResponse(
  row: ProductRow,
  children: ProductChildren,
): ProductDetailResponse {
  return {
    ...toProductResponse(row),
    categories: children.categories.map(toCategoryResponse),
    media: children.media.map(toMediaResponse),
    variants: children.variants.map((variant) =>
      toVariantResponse(variant, children.variantOptionValues),
    ),
    options: children.options.map((option) => toOptionResponse(option, children.optionValues)),
  };
}

/** Rows -> the plain shape core validates attribute values against. */
export function toProductTypeDefinition(rows: ProductTypeRows): ProductTypeDefinition {
  return {
    code: rows.code,
    allowedOptionCodes: rows.allowedOptionCodes,
    attributes: rows.assignments.map((assignment) => ({
      level: attributeLevelSchema.parse(assignment.level),
      isRequired: assignment.isRequired,
      attribute: toAttributeDefinition(assignment.attribute, rows),
    })),
  };
}

function toAttributeDefinition(
  row: ProductTypeRows["assignments"][number]["attribute"],
  rows: ProductTypeRows,
): AttributeDefinition {
  return {
    code: row.code,
    inputType: inputTypeSchema.parse(row.inputType),
    isLocalized: row.isLocalized,
    unit: row.unit,
    validation: row.validation,
    isFilterable: row.isFilterable,
    isSearchable: row.isSearchable,
    isVisibleOnStorefront: row.isVisibleOnStorefront,
    isComparable: row.isComparable,
    isSortable: row.isSortable,
    isInternal: row.isInternal,
    options: rows.attributeOptions
      .filter((attributeOption) => attributeOption.attributeId === row.id)
      .map(({ code, label, position }) => ({ code, label, position })),
  };
}

/**
 * What core's publish preconditions check: the product, its option codes and its variants with option values.
 * `pricedVariantIds` holds the variants that have a price in the shop currency
 * (`ProductsRepository.findVariantIdsWithPrice`).
 */
export function toProductSnapshot(
  row: ProductRow,
  children: Pick<ProductChildren, "variants" | "variantOptionValues" | "options">,
  pricedVariantIds: ReadonlySet<string>,
): ProductSnapshot {
  const variants: VariantSnapshot[] = children.variants.map((variant) => ({
    sku: variant.sku,
    isDefault: variant.isDefault,
    isActive: variant.isActive,
    optionSignature: variant.optionSignature,
    optionValues: children.variantOptionValues
      .filter((value) => value.variantId === variant.id)
      .map((value) => ({ optionCode: value.optionCode, valueCode: value.valueCode })),
    attributes: variant.attributes,
    hasShopPrice: pricedVariantIds.has(variant.id),
  }));
  return {
    status: toStatus(row),
    slug: row.slug,
    title: row.title,
    publishedAt: row.publishedAt === null ? null : row.publishedAt.toISOString(),
    attributes: row.attributes,
    optionCodes: children.options.map((option) => option.optionCode),
    variants,
  };
}
