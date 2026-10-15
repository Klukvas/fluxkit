import { Injectable } from "@nestjs/common";
import {
  generateVariants,
  proposeSkus,
  type GenerateVariantsError,
  type GenerateVariantsOption,
} from "@fluxkit/core";
import { isUniqueViolation } from "../../../common/postgres-errors.js";
import { conflict, validationFailed, type FieldError } from "../../../common/problem.js";
import type { DbExecutor } from "../../../common/transaction.js";
import { ProductsRepository, type ProductRow } from "../products/products.repository.js";
import { VariantsRepository } from "./variants.repository.js";

export const VARIANT_SKU_CONSTRAINT = "variant_sku_key";
// A proposed SKU can lose a race against another product that proposes the same one. Every lost round means
// another request won, so the bound only has to stop a pathological loop.
const MAX_SKU_ATTEMPTS = 8;
// proposeSku cuts the base to 64 characters and may drop one trailing separator, so a shorter prefix still
// matches every candidate it can produce.
const SKU_PREFIX_LENGTH = 60;

export interface GenerationOutcome {
  created: number;
  /** Combinations of the chosen option values that already had a variant. */
  skipped: number;
}

/**
 * Runs `work` (one whole transaction) again when a SKU that the service proposed was taken by a concurrent write.
 * Only use it for work whose SKUs are all proposed: a SKU the client sent must answer 409, not be retried.
 */
export async function retryOnProposedSkuCollision<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SKU_ATTEMPTS; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (!isUniqueViolation(error, VARIANT_SKU_CONSTRAINT)) {
        throw error;
      }
    }
  }
  throw conflict("Could not allocate unique SKUs; try again or provide them.", {
    field: "sku",
    constraint: VARIANT_SKU_CONSTRAINT,
  });
}

function toFieldError(error: GenerateVariantsError): FieldError {
  const details = [
    error.valueCode === undefined ? undefined : `value ${error.valueCode}`,
    error.limit === undefined ? undefined : `limit ${error.limit}`,
    error.actual === undefined ? undefined : `actual ${error.actual}`,
  ].filter((part) => part !== undefined);
  return {
    path: error.optionCode === undefined ? "variants" : `options.${error.optionCode}`,
    code: error.reason,
    ...(details.length === 0 ? {} : { message: details.join(", ") }),
  };
}

/** Creates the variants a product is missing from its chosen options. Callers hold the product row lock. */
@Injectable()
export class VariantGenerationService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly variants: VariantsRepository,
  ) {}

  async deleteAll(tx: DbExecutor, productId: string): Promise<void> {
    await this.variants.deleteAllOfProduct(tx, productId);
  }

  /**
   * The cartesian product of the chosen values minus the combinations that already exist (core
   * `generateVariants`, which also enforces the limits). The first variant of a product that has none becomes the
   * default one. Idempotent: a second call creates nothing.
   */
  async generateMissing(tx: DbExecutor, product: ProductRow): Promise<GenerationOutcome> {
    const options = await this.products.listProductOptions(tx, product.id);
    const chosenValues = await this.products.listProductOptionValues(tx, product.id);
    const existing = await this.products.listVariants(tx, product.id);

    const generateOptions: GenerateVariantsOption[] = options.map((option) => ({
      code: option.optionCode,
      valueCodes: chosenValues
        .filter((value) => value.optionId === option.optionId)
        .map((value) => value.valueCode),
    }));
    const result = generateVariants({
      options: generateOptions,
      existingSignatures: new Set(existing.map((variant) => variant.optionSignature)),
    });
    if (!result.ok) {
      throw validationFailed(result.errors.map(toFieldError));
    }
    const combinations = generateOptions.reduce(
      (count, option) => count * option.valueCodes.length,
      1,
    );
    const generated = result.variants;
    if (generated.length === 0) {
      return { created: 0, skipped: combinations };
    }

    const optionIdByCode = new Map(options.map((option) => [option.optionCode, option.optionId]));
    const valueIdByCode = new Map(
      chosenValues.map((value) => [`${value.optionId}:${value.valueCode}`, value.optionValueId]),
    );
    const skus = proposeSkus({
      slug: product.slug,
      variants: generated.map((variant) => variant.optionValues.map((pair) => pair.valueCode)),
      takenSkus: await this.products.findSkusStartingWith(
        tx,
        product.slug.toUpperCase().slice(0, SKU_PREFIX_LENGTH),
      ),
    });
    const skuValues: string[] = [];
    const skuProblems: FieldError[] = [];
    skus.forEach((proposal, index) => {
      if (proposal.ok) {
        skuValues.push(proposal.sku);
      } else {
        skuProblems.push({
          path: "slug",
          code: proposal.reason,
          message: `A SKU cannot be derived for variant ${index + 1}; change the slug.`,
        });
      }
    });
    if (skuProblems.length > 0) {
      throw validationFailed(skuProblems);
    }

    const firstPosition =
      existing.reduce((highest, variant) => Math.max(highest, variant.position), -1) + 1;
    const inserted = await this.variants.insertVariants(
      tx,
      generated.map((variant, index) => {
        const sku = skuValues[index];
        if (sku === undefined) {
          throw new Error(`No SKU was proposed for variant ${variant.optionSignature}.`);
        }
        return {
          productId: product.id,
          sku,
          optionSignature: variant.optionSignature,
          isDefault: variant.isDefault,
          isActive: true,
          attributes: {},
          position: firstPosition + index,
        };
      }),
    );
    const insertedBySignature = new Map(inserted.map((row) => [row.optionSignature, row.id]));
    await this.variants.insertOptionValues(
      tx,
      generated.flatMap((variant) =>
        variant.optionValues.map((pair) => {
          const optionId = optionIdByCode.get(pair.optionCode);
          const variantId = insertedBySignature.get(variant.optionSignature);
          const optionValueId =
            optionId === undefined ? undefined : valueIdByCode.get(`${optionId}:${pair.valueCode}`);
          if (optionId === undefined || variantId === undefined || optionValueId === undefined) {
            throw new Error(
              `Generated variant ${variant.optionSignature} refers to an unknown row.`,
            );
          }
          return { variantId, productId: product.id, optionId, optionValueId };
        }),
      ),
    );
    return { created: generated.length, skipped: combinations - generated.length };
  }
}
