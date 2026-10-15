import { Inject, Injectable } from "@nestjs/common";
import {
  CATALOG_LIMITS,
  canCreateVariantManually,
  canDeleteVariant,
  checkExactlyOneDefault,
  checkOptionCoverage,
  computeOptionSignature,
  proposeSku,
  publishPreconditions,
  validateAttributeValues,
  validateSku,
  type OptionValuePair,
  type ProductTypeDefinition,
  type VariantRuleDecision,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page } from "../../../common/pagination.js";
import { translatePostgresError } from "../../../common/postgres-errors.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import type { ProposalLog } from "../../shared/retry.js";
import {
  toProductSnapshot,
  toProductTypeDefinition,
  toStatus,
} from "../products/products.mapper.js";
import {
  ProductsRepository,
  type ProductRow,
  type VariantRow,
} from "../products/products.repository.js";
import {
  retryOnProposedSkuCollision,
  VariantGenerationService,
} from "./variant-generation.service.js";
import { toVariantResponses } from "./variants.mapper.js";
import { VariantsRepository, type VariantChanges } from "./variants.repository.js";
import type {
  CreateVariantBody,
  GenerateVariantsResponse,
  ListVariantsQuery,
  UpdateVariantBody,
  VariantResponse,
} from "./variants.schemas.js";

// proposeSku cuts the base to 64 characters and may drop one trailing separator, so a shorter prefix still
// matches every candidate it can produce.
const SKU_PREFIX_LENGTH = 60;
// On an active product these publish preconditions must keep holding after a variant edit (ADR 0006 section 6).
const ACTIVE_PRODUCT_VARIANT_RULES: ReadonlySet<string> = new Set([
  "default_variant_inactive",
  "no_active_variant",
]);

const FK_DETAIL = "The change conflicts with records that still refer to the variant.";

/** Turns a rejected core variant rule into `409 rule_violation` whose `rule` is the core reason code. */
function assertVariantRule(decision: VariantRuleDecision, detail: string): void {
  if (!decision.allowed) {
    throw ruleViolation(detail, decision.reason);
  }
}

@Injectable()
export class VariantsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly variants: VariantsRepository,
    private readonly generation: VariantGenerationService,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async list(productId: string, query: ListVariantsQuery): Promise<Page<VariantResponse>> {
    await this.requireProduct(this.database, productId);
    const { rows, total } = await this.variants.listPage(this.database, productId, query);
    const optionValues = await this.variants.listOptionValues(
      this.database,
      rows.map((row) => row.id),
    );
    return toPage(toVariantResponses(rows, optionValues), total, query);
  }

  async get(productId: string, variantId: string): Promise<VariantResponse> {
    await this.requireProduct(this.database, productId);
    return this.load(this.database, productId, variantId);
  }

  /** Creates one variant by hand. Draft products only: a manual variant changes the option structure. */
  async create(productId: string, body: CreateVariantBody): Promise<VariantResponse> {
    const work = (log?: ProposalLog) =>
      withTransaction(this.database, async (tx) => {
        const product = await this.lockProduct(tx, productId);
        assertVariantRule(
          canCreateVariantManually(toStatus(product)),
          "Variants are created by hand only while the product is a draft.",
        );
        const options = await this.products.listProductOptions(tx, productId);
        const chosen = await this.products.listProductOptionValues(tx, productId);

        const byId = new Map(chosen.map((value) => [value.optionValueId, value]));
        const unknown: FieldError[] = body.optionValueIds.flatMap((valueId, index) =>
          byId.has(valueId)
            ? []
            : [
                {
                  path: `optionValueIds.${index}`,
                  code: "invalid_reference",
                  message: "The product has not chosen this option value.",
                },
              ],
        );
        if (unknown.length > 0) {
          throw validationFailed(unknown);
        }
        const requested = body.optionValueIds.flatMap((valueId) => {
          const value = byId.get(valueId);
          const option = options.find((candidate) => candidate.optionId === value?.optionId);
          return value === undefined || option === undefined
            ? []
            : [{ ...value, optionCode: option.optionCode }];
        });
        const coverage = checkOptionCoverage(
          options.map((option) => option.optionCode),
          [
            {
              optionValues: requested.map(({ optionCode, valueCode }) => ({
                optionCode,
                valueCode,
              })),
            },
          ],
        );
        if (coverage.length > 0) {
          throw validationFailed(
            coverage.map((violation) => ({
              path: "optionValueIds",
              code: violation.code,
              ...(violation.optionCode === undefined
                ? {}
                : { message: `Option ${violation.optionCode}` }),
            })),
          );
        }
        // One value per option, in the order of the product's options (the order SKUs are built in).
        const ordered = options.flatMap((option) =>
          requested.filter((value) => value.optionId === option.optionId),
        );
        const pairs: OptionValuePair[] = ordered.map(({ optionCode, valueCode }) => ({
          optionCode,
          valueCode,
        }));

        const existing = await this.products.listVariants(tx, productId);
        if (existing.length >= CATALOG_LIMITS.maxVariantsPerProduct) {
          throw validationFailed([
            {
              path: "variants",
              code: "too_many_variants_total",
              message: `limit ${CATALOG_LIMITS.maxVariantsPerProduct}`,
            },
          ]);
        }
        const attributes = body.attributes ?? {};
        if (body.attributes !== undefined) {
          this.assertAttributeValues(await this.loadDefinition(tx, product), attributes, "draft");
        }
        const sku =
          body.sku === undefined
            ? await this.proposeSku(
                tx,
                product,
                pairs.map((pair) => pair.valueCode),
              )
            : this.normalizeSku(body.sku);
        log?.record(sku);

        const created = await this.variants.insertVariant(tx, {
          productId,
          sku,
          barcode: emptyToNullText(body.barcode),
          optionSignature: computeOptionSignature(pairs),
          isDefault: existing.length === 0,
          isActive: body.isActive ?? true,
          attributes,
          position: existing.reduce((highest, row) => Math.max(highest, row.position), -1) + 1,
        });
        await this.variants.insertOptionValues(
          tx,
          ordered.map((value) => ({
            variantId: created.id,
            productId,
            optionId: value.optionId,
            optionValueId: value.optionValueId,
          })),
        );
        return this.load(tx, productId, created.id);
      });
    // A proposed SKU may lose a race and is retried; a SKU the client sent answers 409 instead.
    try {
      return body.sku === undefined ? await retryOnProposedSkuCollision(work) : await work();
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "A variant with the same SKU or option combination already exists.",
        foreignKey: "invalid_reference",
      });
    }
  }

  async update(
    productId: string,
    variantId: string,
    body: UpdateVariantBody,
  ): Promise<VariantResponse> {
    try {
      return await withTransaction(this.database, async (tx) => {
        const product = await this.lockProduct(tx, productId);
        const current = await this.requireVariant(tx, productId, variantId);
        const all = await this.products.listVariants(tx, productId);

        if (body.attributes !== undefined) {
          // Writes to an active product are validated like a publish (ADR 0006 section 4).
          this.assertAttributeValues(
            await this.loadDefinition(tx, product),
            body.attributes,
            product.status === "active" ? "publish" : "draft",
          );
        }
        if (
          product.status === "active" &&
          body.isActive === true &&
          !current.isActive &&
          body.attributes === undefined
        ) {
          // Switching a variant on sells it: it needs its required attributes first (ADR 0008).
          this.assertAttributeValues(
            await this.loadDefinition(tx, product),
            current.attributes,
            "publish",
          );
        }
        const changes: VariantChanges = {
          ...(body.sku === undefined ? {} : { sku: this.normalizeSku(body.sku) }),
          ...(body.barcode === undefined ? {} : { barcode: emptyToNullText(body.barcode) }),
          ...(body.attributes === undefined ? {} : { attributes: body.attributes }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
          ...(body.position === undefined ? {} : { position: body.position }),
          ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
        };

        // The product keeps exactly one default variant: the one asked for, or, if nothing was asked, the current one.
        const resulting: VariantRow[] = all.map((row) => {
          if (row.id === variantId) {
            return { ...row, ...changes };
          }
          return body.isDefault === true ? { ...row, isDefault: false } : row;
        });
        const defaultProblem = checkExactlyOneDefault(resulting)[0];
        if (defaultProblem !== undefined) {
          throw ruleViolation(
            "A product always has exactly one default variant; make another variant the default instead.",
            defaultProblem.code,
          );
        }
        if (
          product.status === "active" &&
          (body.isActive !== undefined || body.isDefault !== undefined)
        ) {
          await this.assertActiveProductStillSellable(tx, product, resulting);
        }

        // The partial unique index allows one default at a time: unset the old one before setting the new one.
        if (body.isDefault === true && !current.isDefault) {
          const previous = all.find((row) => row.isDefault);
          if (previous !== undefined) {
            await this.variants.update(tx, previous.id, { isDefault: false });
          }
        }
        if (Object.keys(changes).length > 0) {
          await this.variants.update(tx, variantId, changes);
        }
        return this.load(tx, productId, variantId);
      });
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "Another variant already uses this SKU.",
        foreignKey: "invalid_reference",
      });
    }
  }

  /** Hard delete (core `canDeleteVariant`): draft products only, never the last or the default variant. */
  async delete(productId: string, variantId: string): Promise<void> {
    try {
      await withTransaction(this.database, async (tx) => {
        const product = await this.lockProduct(tx, productId);
        const current = await this.requireVariant(tx, productId, variantId);
        const all = await this.products.listVariants(tx, productId);
        assertVariantRule(
          canDeleteVariant({
            productStatus: toStatus(product),
            isDefault: current.isDefault,
            variantCount: all.length,
          }),
          "This variant cannot be deleted; switch it off instead.",
        );
        await this.variants.delete(tx, variantId);
      });
    } catch (error) {
      throw translatePostgresError(error, { detail: FK_DETAIL });
    }
  }

  /** Creates the variants missing for the product's current options. Idempotent; serialized by the product lock. */
  async generate(productId: string): Promise<GenerateVariantsResponse> {
    return retryOnProposedSkuCollision((log) =>
      withTransaction(this.database, async (tx) => {
        const product = await this.lockProduct(tx, productId);
        const outcome = await this.generation.generateMissing(tx, product, log);
        const rows = await this.products.listVariants(tx, productId);
        const optionValues = await this.products.listVariantOptionValues(tx, productId);
        return { ...outcome, variants: toVariantResponses(rows, optionValues) };
      }),
    );
  }

  private async load(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<VariantResponse> {
    const row = await this.requireVariant(db, productId, variantId);
    const optionValues = await this.variants.listOptionValues(db, [row.id]);
    const [response] = toVariantResponses([row], optionValues);
    if (response === undefined) {
      throw new Error("A variant row produced no response.");
    }
    return response;
  }

  private async requireVariant(
    db: DbExecutor,
    productId: string,
    variantId: string,
  ): Promise<VariantRow> {
    const row = await this.variants.findVariant(db, productId, variantId);
    if (row === undefined) {
      throw notFound("Variant");
    }
    return row;
  }

  private async requireProduct(db: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findById(db, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async lockProduct(tx: DbExecutor, productId: string): Promise<ProductRow> {
    const row = await this.products.findByIdForUpdate(tx, productId);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async loadDefinition(
    db: DbExecutor,
    product: ProductRow,
  ): Promise<ProductTypeDefinition> {
    const rows = await this.products.findProductTypeRows(db, product.productTypeId);
    if (rows === undefined) {
      throw new Error(`Product type ${product.productTypeId} of an existing product is missing.`);
    }
    return toProductTypeDefinition(rows);
  }

  /** Draft writes skip the required check; a write to an active product enforces it. */
  private assertAttributeValues(
    definition: ProductTypeDefinition,
    values: Record<string, unknown>,
    mode: "draft" | "publish",
  ): void {
    const result = validateAttributeValues(definition, "variant", values, {
      ...this.locale,
      mode,
    });
    if (!result.ok) {
      throw validationFailed(
        result.errors.map((error) => ({
          path: [
            "attributes",
            ...(error.attributeCode === null ? [] : [error.attributeCode]),
            ...(error.locale === undefined ? [] : [error.locale]),
          ].join("."),
          code: error.reason,
        })),
      );
    }
  }

  private normalizeSku(raw: string): string {
    const result = validateSku(raw);
    if (!result.ok) {
      throw validationFailed([{ path: "sku", code: result.reason }]);
    }
    return result.sku;
  }

  private async proposeSku(
    tx: DbExecutor,
    product: ProductRow,
    valueCodes: readonly string[],
  ): Promise<string> {
    const proposed = proposeSku({
      slug: product.slug,
      valueCodes,
      takenSkus: await this.products.findSkusStartingWith(
        tx,
        product.slug.toUpperCase().slice(0, SKU_PREFIX_LENGTH),
      ),
    });
    if (!proposed.ok) {
      throw validationFailed([
        {
          path: "slug",
          code: proposed.reason,
          message: "A SKU cannot be derived from this slug; provide a sku.",
        },
      ]);
    }
    return proposed.sku;
  }

  /**
   * Switching off the default variant, or the last active one, of a live product would break a publish
   * precondition. Core decides; only the two rules about active variants are enforced here, so unrelated gaps
   * (a generated variant that still lacks a required attribute) do not block an edit.
   */
  private async assertActiveProductStillSellable(
    tx: DbExecutor,
    product: ProductRow,
    resulting: readonly VariantRow[],
  ): Promise<void> {
    const options = await this.products.listProductOptions(tx, product.id);
    const optionValues = await this.products.listVariantOptionValues(tx, product.id);
    const definition = await this.loadDefinition(tx, product);
    const snapshot = toProductSnapshot(product, {
      variants: [...resulting],
      variantOptionValues: optionValues,
      options,
    });
    const violation = publishPreconditions(snapshot, definition, this.locale).find((candidate) =>
      ACTIVE_PRODUCT_VARIANT_RULES.has(candidate.code),
    );
    if (violation !== undefined) {
      throw ruleViolation(
        "A published product keeps an active default variant and at least one active variant.",
        violation.code,
      );
    }
  }
}

/** Barcodes are trimmed by the schema; an empty one means "no barcode". */
function emptyToNullText(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}
