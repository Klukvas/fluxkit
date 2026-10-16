import { Inject, Injectable } from "@nestjs/common";
import {
  canRebuildVariants,
  planProductOptionChange,
  type ProductOptionChangePlan,
  type ProductOptionSelection,
} from "@fluxkit/core";
import { translatePostgresError } from "../../../common/postgres-errors.js";
import { notFound, ruleViolation, validationFailed } from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import type { ProposalLog } from "../../shared/retry.js";
import { toStatus } from "../products/products.mapper.js";
import { ProductsRepository, type ProductRow } from "../products/products.repository.js";
import { ProductsService } from "../products/products.service.js";
import type { ProductDetailResponse } from "../products/products.schemas.js";
import {
  retryOnProposedSkuCollision,
  VariantGenerationService,
} from "../variants/variant-generation.service.js";
import { VariantsRepository } from "../variants/variants.repository.js";
import {
  locateInPutBody,
  toOptionChangeProblem,
  toStoredSelections,
  type StoredSelection,
} from "./product-options.mapper.js";
import { ProductOptionsRepository } from "./product-options.repository.js";
import type {
  AddProductOptionValueBody,
  PutProductOptionsBody,
} from "./product-options.schemas.js";

const CONFLICT_DETAIL =
  "The change conflicts with records that still refer to the option values (for example media).";

@Injectable()
export class ProductOptionsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly productDetails: ProductsService,
    private readonly productOptions: ProductOptionsRepository,
    private readonly generation: VariantGenerationService,
    private readonly variants: VariantsRepository,
    @Inject(DRIZZLE) private readonly database: Database,
  ) {}

  /**
   * Replaces the options and chosen values of a draft product. Core decides what changed
   * (`planProductOptionChange`). Adding options, removing options or removing values rebuilds all variants (the
   * first one becomes the default); only adding values keeps the existing variants and creates the new ones.
   */
  async put(productId: string, body: PutProductOptionsBody): Promise<ProductDetailResponse> {
    const desired: ProductOptionSelection[] = body.options;
    return this.run(async (tx, log) => {
      const product = await this.lockProduct(tx, productId);
      const current = await this.currentSelections(tx, productId);
      const planned = planProductOptionChange({
        productStatus: toStatus(product),
        current,
        desired,
        allowedOptionIds: await this.productOptions.findAllowedOptionIds(tx, product.productTypeId),
      });
      if (!planned.ok) {
        throw toOptionChangeProblem(planned.errors, locateInPutBody(desired));
      }
      if (product.status !== "draft") {
        // Core accepts "no change" and "only new values" on a published product; those go through POST .../values.
        throw ruleViolation(
          "The options of a published product are frozen; add values with POST /admin/products/:id/options/:optionId/values.",
          "options_frozen",
        );
      }
      await this.assertValuesBelongToOptions(tx, desired);
      await this.apply(tx, log, product, current, desired, planned.plan);
      return this.productDetails.getIn(tx, productId);
    });
  }

  /**
   * Adds one value to an option of the product and generates the variants of the new combinations. Allowed in every
   * status for an option the product already uses. On a draft an unused option may be added with this value.
   */
  async addValue(
    productId: string,
    optionId: string,
    body: AddProductOptionValueBody,
  ): Promise<ProductDetailResponse> {
    return this.run(async (tx, log) => {
      const product = await this.lockProduct(tx, productId);
      if (!(await this.productOptions.optionExists(tx, optionId))) {
        throw notFound("Option");
      }
      const [valueRow] = await this.productOptions.findOptionValues(tx, [body.valueId]);
      if (valueRow === undefined || valueRow.optionId !== optionId) {
        throw validationFailed([
          {
            path: "valueId",
            code: "invalid_reference",
            message: "The value does not exist or belongs to another option.",
          },
        ]);
      }
      const current = await this.currentSelections(tx, productId);
      const desired: ProductOptionSelection[] = current.some(
        (selection) => selection.optionId === optionId,
      )
        ? current.map((selection) =>
            selection.optionId === optionId
              ? { optionId, valueIds: [...selection.valueIds, body.valueId] }
              : selection,
          )
        : [...current, { optionId, valueIds: [body.valueId] }];
      const planned = planProductOptionChange({
        productStatus: toStatus(product),
        current,
        desired,
        allowedOptionIds: await this.productOptions.findAllowedOptionIds(tx, product.productTypeId),
      });
      if (!planned.ok) {
        throw toOptionChangeProblem(planned.errors, (error) =>
          error.reason === "option_not_allowed" || error.reason === "too_many_options"
            ? "optionId"
            : "valueId",
        );
      }
      await this.apply(tx, log, product, current, desired, planned.plan);
      return this.productDetails.getIn(tx, productId);
    });
  }

  /** One transaction, run again when a proposed SKU lost a race; constraint violations become problems last. */
  private async run<T>(work: (tx: DbExecutor, log: ProposalLog) => Promise<T>): Promise<T> {
    try {
      return await retryOnProposedSkuCollision((log) =>
        withTransaction(this.database, (tx) => work(tx, log)),
      );
    } catch (error) {
      throw translatePostgresError(error, { detail: CONFLICT_DETAIL });
    }
  }

  private async lockProduct(tx: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findByIdForUpdate(tx, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async currentSelections(tx: DbExecutor, productId: string): Promise<StoredSelection[]> {
    return toStoredSelections(
      await this.products.listProductOptions(tx, productId),
      await this.products.listProductOptionValues(tx, productId),
    );
  }

  /** Every value must exist and belong to the option it is listed under (core only sees ids). */
  private async assertValuesBelongToOptions(
    tx: DbExecutor,
    desired: readonly ProductOptionSelection[],
  ): Promise<void> {
    const rows = await this.productOptions.findOptionValues(
      tx,
      desired.flatMap((selection) => selection.valueIds),
    );
    const optionOfValue = new Map(rows.map((row) => [row.id, row.optionId]));
    const problems = desired.flatMap((selection, index) =>
      selection.valueIds.flatMap((valueId, valueIndex) =>
        optionOfValue.get(valueId) === selection.optionId
          ? []
          : [
              {
                path: `options.${index}.valueIds.${valueIndex}`,
                code: "invalid_reference",
                message: "The value does not exist or belongs to another option.",
              },
            ],
      ),
    );
    if (problems.length > 0) {
      throw validationFailed(problems);
    }
  }

  private async apply(
    tx: DbExecutor,
    log: ProposalLog,
    product: ProductRow,
    current: readonly StoredSelection[],
    desired: readonly ProductOptionSelection[],
    plan: ProductOptionChangePlan,
  ): Promise<void> {
    const rebuildsVariants =
      plan.addedOptionIds.length > 0 ||
      plan.removedOptionIds.length > 0 ||
      plan.removedValues.length > 0;
    if (rebuildsVariants) {
      // A draft may have been sold and unpublished: deleting its variants would cascade their stock history away
      // (ADR 0014). The product row is already locked; this locks the variants and reads the history.
      const decision = canRebuildVariants({
        anyVariantHasStockHistory: await this.variants.anyHasStockHistory(tx, product.id),
      });
      if (!decision.allowed) {
        throw ruleViolation(
          "This change would rebuild the variants, but some of them have stock history; create a new product or switch variants off instead.",
          decision.reason,
        );
      }
      await this.generation.deleteAll(tx, product.id);
    }

    await this.productOptions.deleteProductOptions(tx, product.id, plan.removedOptionIds);
    for (const removed of plan.removedValues) {
      if (!plan.removedOptionIds.includes(removed.optionId)) {
        await this.productOptions.deleteProductOptionValues(
          tx,
          product.id,
          removed.optionId,
          removed.valueIds,
        );
      }
    }

    await this.productOptions.insertProductOptions(
      tx,
      product.id,
      desired.flatMap((selection, position) =>
        plan.addedOptionIds.includes(selection.optionId)
          ? [{ optionId: selection.optionId, position }]
          : [],
      ),
    );
    const storedByOption = new Map(current.map((selection) => [selection.optionId, selection]));
    await this.productOptions.insertProductOptionValues(
      tx,
      product.id,
      desired.flatMap((selection) => {
        const stored = storedByOption.get(selection.optionId);
        return selection.valueIds.flatMap((optionValueId, position) =>
          stored?.valuePositions.has(optionValueId) === true
            ? []
            : [{ optionId: selection.optionId, optionValueId, position }],
        );
      }),
    );

    // Keep the display order equal to the order of the request for what was already there.
    for (const [position, selection] of desired.entries()) {
      const stored = storedByOption.get(selection.optionId);
      if (stored === undefined) {
        continue;
      }
      if (stored.position !== position) {
        await this.productOptions.setOptionPosition(tx, product.id, selection.optionId, position);
      }
      for (const [valuePosition, optionValueId] of selection.valueIds.entries()) {
        const storedPosition = stored.valuePositions.get(optionValueId);
        if (storedPosition !== undefined && storedPosition !== valuePosition) {
          await this.productOptions.setValuePosition(
            tx,
            product.id,
            selection.optionId,
            optionValueId,
            valuePosition,
          );
        }
      }
    }

    if (plan.hasChanges) {
      await this.generation.generateMissing(tx, product, log);
    }
  }
}
