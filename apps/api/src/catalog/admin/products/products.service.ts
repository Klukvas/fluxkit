import { Inject, Injectable } from "@nestjs/common";
import {
  canHardDelete,
  canTransition,
  computeOptionSignature,
  decideChangeProductType,
  generateUniqueSlug,
  nextPublishedAt,
  normalizeCategoryAssignments,
  proposeSku,
  publishPreconditions,
  slugLookupPrefix,
  TEXT_LIMITS,
  validateAttributeValues,
  type ProductStatus,
  type ProductTypeDefinition,
  type PublishViolation,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page } from "../../../common/pagination.js";
import { PRICING_CONFIG, type PricingConfig } from "../../../common/pricing-config.js";
import { isUniqueViolation, translatePostgresError } from "../../../common/postgres-errors.js";
import {
  conflict,
  invalidTransition,
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { retryLostRaces, type ProposalLog } from "../../shared/retry.js";
import { assertAllowed } from "../../shared/rules.js";
import { emptyToNull } from "../../shared/text.js";
import {
  toProductDetailResponse,
  toProductResponse,
  toProductSnapshot,
  toProductTypeDefinition,
  toStatus,
} from "./products.mapper.js";
import { ProductsRepository, type ProductRow } from "./products.repository.js";
import type {
  CreateProductBody,
  ListProductsQuery,
  ProductDetailResponse,
  ProductResponse,
  PutProductCategoriesBody,
  PutProductMediaBody,
  UpdateProductBody,
} from "./products.schemas.js";

const PRODUCT_SLUG_CONSTRAINT = "product_slug_key";
const VARIANT_SKU_CONSTRAINT = "variant_sku_key";
// A generated slug or SKU can lose a race against a concurrent create. Every lost round means another request won,
// so N concurrent creates need at most N attempts; the bound only has to stop a pathological loop.
const MAX_CREATE_ATTEMPTS = 8;
// proposeSku cuts the base to 64 characters and may drop one trailing separator, so a shorter prefix still
// matches every candidate it can produce.
const SKU_PREFIX_LENGTH = 60;

export type LifecycleAction = "publish" | "unpublish" | "archive" | "restore";

const TARGET_STATUS: Readonly<Record<LifecycleAction, ProductStatus>> = {
  publish: "active",
  unpublish: "draft",
  archive: "archived",
  restore: "draft",
};

// unpublish and restore both end in draft (core `canTransition` allows active to draft and archived to draft), so
// the action decides which source status it accepts. publish and archive are fully decided by core.
const REQUIRED_SOURCE: Readonly<Partial<Record<LifecycleAction, ProductStatus>>> = {
  unpublish: "active",
  restore: "archived",
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(PRICING_CONFIG) private readonly pricing: PricingConfig,
  ) {}

  /** Creates a draft and its single default variant in one transaction. */
  async create(body: CreateProductBody): Promise<ProductDetailResponse> {
    this.assertValidTexts(body);
    try {
      return await retryLostRaces(
        {
          maxAttempts: MAX_CREATE_ATTEMPTS,
          // A slug the client sent is never retried: the same slug would collide again.
          isLostRace: (error) =>
            isUniqueViolation(error, VARIANT_SKU_CONSTRAINT) ||
            (body.slug === undefined && isUniqueViolation(error, PRODUCT_SLUG_CONSTRAINT)),
          exhausted: () =>
            conflict("Could not allocate a unique slug and SKU; try again or provide a slug.", {
              field: "slug",
              constraint: PRODUCT_SLUG_CONSTRAINT,
            }),
        },
        // Slug and SKU candidates are computed inside the transaction; a unique violation aborts it, so the retry
        // starts a new transaction and reads the taken values again.
        (log) => withTransaction(this.database, (tx) => this.createIn(tx, body, log)),
      );
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "Another product already uses this slug.",
        foreignKey: "invalid_reference",
      });
    }
  }

  async get(id: string): Promise<ProductDetailResponse> {
    return this.loadDetail(this.database, id);
  }

  /** The detail read on a given executor, so option and variant writes answer from inside their transaction. */
  getIn(db: DbExecutor, id: string): Promise<ProductDetailResponse> {
    return this.loadDetail(db, id);
  }

  async list(query: ListProductsQuery): Promise<Page<ProductResponse>> {
    const { rows, total } = await this.products.list(this.database, query, query);
    return toPage(rows.map(toProductResponse), total, query);
  }

  async update(id: string, body: UpdateProductBody): Promise<ProductDetailResponse> {
    this.assertValidTexts(body);
    try {
      return await withTransaction(this.database, async (tx) => {
        const row = await this.lockProduct(tx, id);
        if (body.productTypeId !== undefined) {
          assertAllowed(
            decideChangeProductType({ currentId: row.productTypeId, nextId: body.productTypeId }),
            "A product keeps its product type; create a new product instead.",
          );
        }
        if (body.brandId !== undefined && body.brandId !== null) {
          await this.assertBrandExists(tx, body.brandId);
        }
        if (body.attributes !== undefined) {
          // Writes to an active product are validated like a publish (ADR 0006 section 4).
          const definition = await this.loadDefinition(tx, row.productTypeId);
          this.assertAttributeValues(
            definition,
            body.attributes,
            row.status === "active" ? "publish" : "draft",
          );
        }
        const changes = {
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.description === undefined ? {} : { description: emptyToNull(body.description) }),
          ...(body.brandId === undefined ? {} : { brandId: body.brandId }),
          ...(body.slug === undefined ? {} : { slug: body.slug }),
          ...(body.attributes === undefined ? {} : { attributes: body.attributes }),
        };
        if (Object.keys(changes).length > 0) {
          await this.products.update(tx, id, changes);
        }
        return this.loadDetail(tx, id);
      });
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "Another product already uses this slug.",
        foreignKey: "invalid_reference",
      });
    }
  }

  /** Only a product that was never published can be deleted for good (core `canHardDelete`). */
  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const row = await this.lockProduct(tx, id);
      if (!canHardDelete({ publishedAt: row.publishedAt?.toISOString() ?? null })) {
        throw ruleViolation(
          "A product that was published cannot be deleted; archive it instead.",
          "product_was_published",
        );
      }
      await this.products.delete(tx, id);
    });
  }

  /** publish, unpublish, archive or restore (ADR 0006 section 6). Publishing runs the core preconditions. */
  async transition(id: string, action: LifecycleAction): Promise<ProductDetailResponse> {
    const target = TARGET_STATUS[action];
    return withTransaction(this.database, async (tx) => {
      const row = await this.lockProduct(tx, id);
      const from = toStatus(row);
      if (!canTransition(from, target) || (REQUIRED_SOURCE[action] ?? from) !== from) {
        throw invalidTransition(
          `Cannot ${action} a product that is ${from}.`,
          `${from}_to_${target}`,
        );
      }
      if (target === "active") {
        await this.assertPublishable(tx, row);
      }
      await this.products.update(tx, id, {
        status: target,
        ...(target === "active"
          ? {
              publishedAt: new Date(
                nextPublishedAt(row.publishedAt?.toISOString() ?? null, new Date().toISOString()),
              ),
            }
          : {}),
      });
      return this.loadDetail(tx, id);
    });
  }

  /** Replaces the category set. Exactly one assignment is primary when the set is not empty. */
  async putCategories(id: string, body: PutProductCategoriesBody): Promise<ProductDetailResponse> {
    try {
      return await withTransaction(this.database, async (tx) => {
        await this.lockProduct(tx, id);
        const ids = body.categories.map((entry) => entry.categoryId);
        const existing = await this.products.findExistingCategoryIds(tx, ids);
        const unknown: FieldError[] = ids.flatMap((categoryId, index) =>
          existing.has(categoryId)
            ? []
            : [{ path: `categories.${index}.categoryId`, code: "invalid_reference" }],
        );
        if (unknown.length > 0) {
          throw validationFailed(unknown);
        }

        const current = await this.products.listCategoryAssignments(tx, id);
        const currentPrimary = current.find((assignment) => assignment.isPrimary)?.categoryId;
        // A given primary wins; otherwise the current one stays primary while it is still assigned. When it was
        // removed (or there never was one) core falls back to the lowest position.
        const preferredPrimary =
          body.primaryCategoryId ??
          (currentPrimary !== undefined && ids.includes(currentPrimary)
            ? currentPrimary
            : undefined);
        const normalized = normalizeCategoryAssignments({
          assignments: body.categories.map((entry, index) => ({
            categoryId: entry.categoryId,
            position: entry.position ?? index,
          })),
          primaryCategoryId: preferredPrimary,
        });
        if (!normalized.ok) {
          throw validationFailed(
            normalized.errors.map((error) =>
              error.reason === "primary_not_assigned"
                ? { path: "primaryCategoryId", code: error.reason }
                : {
                    path: `categories.${ids.lastIndexOf(error.categoryId)}.categoryId`,
                    code: error.reason,
                  },
            ),
          );
        }
        await this.products.replaceCategoryAssignments(tx, id, normalized.assignments);
        return this.loadDetail(tx, id);
      });
    } catch (error) {
      // A category deleted between the check and the insert (product_category.category_id is a plain foreign key).
      throw translatePostgresError(error, { foreignKey: "invalid_reference" });
    }
  }

  /** Replaces the media list. An option pair must be a value the product chose (`product_option_value`). */
  async putMedia(id: string, body: PutProductMediaBody): Promise<ProductDetailResponse> {
    const errors = body.media.flatMap((item, index) =>
      item.alt === undefined || item.alt === null
        ? []
        : i18nFieldErrors(`media.${index}.alt`, item.alt, this.locale, {
            required: false,
            maxLength: TEXT_LIMITS.alt,
          }),
    );
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    try {
      return await withTransaction(this.database, async (tx) => {
        await this.lockProduct(tx, id);
        const chosen = new Set(
          (await this.products.listProductOptionValues(tx, id)).map(
            (row) => `${row.optionId}:${row.optionValueId}`,
          ),
        );
        const unknownPairs: FieldError[] = body.media.flatMap((item, index) =>
          typeof item.optionId === "string" &&
          typeof item.optionValueId === "string" &&
          !chosen.has(`${item.optionId}:${item.optionValueId}`)
            ? [
                {
                  path: `media.${index}.optionValueId`,
                  code: "invalid_reference",
                  message: "The product has not chosen this option value.",
                },
              ]
            : [],
        );
        if (unknownPairs.length > 0) {
          throw validationFailed(unknownPairs);
        }
        await this.products.replaceMedia(
          tx,
          id,
          body.media.map((item, index) => ({
            url: item.url,
            alt: emptyToNull(item.alt),
            position: item.position ?? index,
            optionId: item.optionId ?? null,
            optionValueId: item.optionValueId ?? null,
          })),
        );
        return this.loadDetail(tx, id);
      });
    } catch (error) {
      throw translatePostgresError(error, { foreignKey: "invalid_reference" });
    }
  }

  private async createIn(
    tx: DbExecutor,
    body: CreateProductBody,
    log: ProposalLog,
  ): Promise<ProductDetailResponse> {
    const definition = await this.loadDefinition(tx, body.productTypeId, "productTypeId");
    if (body.brandId !== undefined && body.brandId !== null) {
      await this.assertBrandExists(tx, body.brandId);
    }
    const attributes = body.attributes ?? {};
    this.assertAttributeValues(definition, attributes, "draft");

    const slug = body.slug ?? (await this.generateSlug(tx, body.title));
    const sku = await this.proposeDefaultSku(tx, slug);
    log.record(slug, sku);
    const created = await this.products.insertProduct(tx, {
      productTypeId: body.productTypeId,
      brandId: body.brandId ?? null,
      slug,
      title: body.title,
      description: emptyToNull(body.description),
      attributes,
    });
    // The single default variant of a product without options (ADR 0006 section 3).
    await this.products.insertVariant(tx, {
      productId: created.id,
      sku,
      optionSignature: computeOptionSignature([]),
      isDefault: true,
      isActive: true,
      attributes: {},
      position: 0,
    });
    return this.loadDetail(tx, created.id);
  }

  private async generateSlug(tx: DbExecutor, title: Record<string, string>): Promise<string> {
    const source = title[this.locale.defaultLocale] ?? "";
    const prefix = slugLookupPrefix(source);
    const generated = generateUniqueSlug(
      source,
      prefix === "" ? new Set() : await this.products.findSlugsStartingWith(tx, prefix),
    );
    if (!generated.ok) {
      throw validationFailed([
        {
          path: "slug",
          code: generated.reason,
          message: "A slug cannot be generated from this title; provide one.",
        },
      ]);
    }
    return generated.slug;
  }

  private async proposeDefaultSku(tx: DbExecutor, slug: string): Promise<string> {
    const taken = await this.products.findSkusStartingWith(
      tx,
      slug.toUpperCase().slice(0, SKU_PREFIX_LENGTH),
    );
    const proposed = proposeSku({ slug, valueCodes: [], takenSkus: taken });
    if (!proposed.ok) {
      throw validationFailed([
        {
          path: "slug",
          code: proposed.reason,
          message: "A SKU cannot be derived from this slug; provide another slug.",
        },
      ]);
    }
    return proposed.sku;
  }

  private async assertPublishable(tx: DbExecutor, row: ProductRow): Promise<void> {
    const definition = await this.loadDefinition(tx, row.productTypeId);
    const [variants, variantOptionValues, options] = [
      await this.products.listVariants(tx, row.id),
      await this.products.listVariantOptionValues(tx, row.id),
      await this.products.listProductOptions(tx, row.id),
    ];
    const snapshot = toProductSnapshot(
      row,
      { variants, variantOptionValues, options },
      await this.products.findVariantIdsWithPrice(tx, row.id, this.pricing.shopCurrency),
    );
    const violations = publishPreconditions(snapshot, definition, this.locale);
    if (violations.length > 0) {
      throw validationFailed(
        violations.map((violation) =>
          toFieldError(
            violation,
            violation.variantIndex === undefined
              ? undefined
              : variants[violation.variantIndex]?.sku,
          ),
        ),
        "The product cannot be published yet.",
      );
    }
  }

  private async loadDetail(db: DbExecutor, id: string): Promise<ProductDetailResponse> {
    const row = await this.products.findById(db, id);
    if (row === undefined) {
      throw notFound("Product");
    }
    // Sequential on purpose: inside a transaction all queries share one connection.
    return toProductDetailResponse(row, {
      categories: await this.products.listCategoryAssignments(db, id),
      media: await this.products.listMedia(db, id),
      variants: await this.products.listVariants(db, id),
      variantOptionValues: await this.products.listVariantOptionValues(db, id),
      options: await this.products.listProductOptions(db, id),
      optionValues: await this.products.listProductOptionValues(db, id),
    });
  }

  private async lockProduct(tx: DbExecutor, id: string): Promise<ProductRow> {
    const row = await this.products.findByIdForUpdate(tx, id);
    if (row === undefined) {
      throw notFound("Product");
    }
    return row;
  }

  private async loadDefinition(
    db: DbExecutor,
    productTypeId: string,
    path?: string,
  ): Promise<ProductTypeDefinition> {
    const rows = await this.products.findProductTypeRows(db, productTypeId);
    if (rows === undefined) {
      if (path !== undefined) {
        throw validationFailed([{ path, code: "invalid_reference" }]);
      }
      throw new Error(`Product type ${productTypeId} of an existing product is missing.`);
    }
    return toProductTypeDefinition(rows);
  }

  private async assertBrandExists(db: DbExecutor, brandId: string): Promise<void> {
    if (!(await this.products.brandExists(db, brandId))) {
      throw validationFailed([{ path: "brandId", code: "invalid_reference" }]);
    }
  }

  /** Draft writes skip the required check; a write to an active product and a publish enforce it. */
  private assertAttributeValues(
    definition: ProductTypeDefinition,
    values: Record<string, unknown>,
    mode: "draft" | "publish",
  ): void {
    const result = validateAttributeValues(definition, "product", values, {
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

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private assertValidTexts(body: { title?: unknown; description?: unknown }): void {
    const errors: FieldError[] = [];
    if (body.title !== undefined) {
      errors.push(
        ...i18nFieldErrors("title", body.title, this.locale, {
          required: true,
          maxLength: TEXT_LIMITS.title,
        }),
      );
    }
    if (body.description !== undefined && body.description !== null) {
      errors.push(
        ...i18nFieldErrors("description", body.description, this.locale, {
          required: false,
          maxLength: TEXT_LIMITS.description,
        }),
      );
    }
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }
}

/** One `errors[]` entry per core publish violation; attribute and title problems keep the core reason as `code`. */
function toFieldError(violation: PublishViolation, sku: string | undefined): FieldError {
  const variantPath =
    violation.variantIndex === undefined ? "variants" : `variants.${violation.variantIndex}`;
  const where = sku === undefined ? undefined : `Variant ${sku}`;
  switch (violation.code) {
    case "title_invalid":
      return {
        path: ["title", violation.locale].filter((part) => part !== undefined).join("."),
        code: violation.reason ?? violation.code,
      };
    case "slug_missing":
    case "slug_invalid":
      return { path: "slug", code: violation.reason ?? violation.code };
    case "attribute_invalid": {
      const base = violation.level === "variant" ? `${variantPath}.attributes` : "attributes";
      return {
        path: [base, violation.attributeCode, violation.locale]
          .filter((part) => part !== undefined)
          .join("."),
        code: violation.reason ?? violation.code,
        ...(where === undefined ? {} : { message: where }),
      };
    }
    case "option_not_allowed":
      return { path: `options.${violation.optionCode ?? ""}`, code: violation.code };
    default:
      return {
        path: variantPath,
        code: violation.code,
        ...(where === undefined && violation.reason === undefined
          ? {}
          : { message: [where, violation.reason].filter((part) => part !== undefined).join(": ") }),
      };
  }
}
