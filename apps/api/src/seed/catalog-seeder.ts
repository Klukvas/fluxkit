import type { INestApplicationContext } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type {
  CatalogSeed,
  SeedAttribute,
  SeedCategory,
  SeedProduct,
  SeedShippingMethod,
  SeedSynonymGroup,
  SeedVariantCommerce,
} from "@fluxkit/seeds";
import type { z } from "zod";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { DRIZZLE, type Database } from "../database/database.module.js";
import {
  attribute,
  brand,
  category,
  option,
  product,
  productType,
  shippingMethod,
} from "../database/schema/index.js";
import { AttributesService } from "../catalog/admin/attributes/attributes.service.js";
import {
  createAttributeOptionSchema,
  createAttributeSchema,
} from "../catalog/admin/attributes/attributes.schemas.js";
import { BrandsService } from "../catalog/admin/brands/brands.service.js";
import { createBrandSchema } from "../catalog/admin/brands/brands.schemas.js";
import { CategoriesService } from "../catalog/admin/categories/categories.service.js";
import { createCategorySchema } from "../catalog/admin/categories/categories.schemas.js";
import { OptionsService } from "../catalog/admin/options/options.service.js";
import {
  createOptionSchema,
  createOptionValueSchema,
} from "../catalog/admin/options/options.schemas.js";
import { updateVariantSchema } from "../catalog/admin/variants/variants.schemas.js";
import { VariantsService } from "../catalog/admin/variants/variants.service.js";
import { InventoryService } from "../inventory/admin/inventory.service.js";
import { PricesService } from "../catalog/admin/prices/prices.service.js";
import { putProductPricesSchema } from "../catalog/admin/prices/prices.schemas.js";
import { adjustmentSchema } from "../inventory/admin/inventory.schemas.js";
import { PRICING_CONFIG, type PricingConfig } from "../common/pricing-config.js";
import {
  SEARCH_PORT,
  SEARCH_SYNONYM_SEEDER,
  type SearchPort,
  type SearchSynonymSeeder,
} from "../common/search-port.js";
import { ProductOptionsService } from "../catalog/admin/product-options/product-options.service.js";
import { putProductOptionsSchema } from "../catalog/admin/product-options/product-options.schemas.js";
import { ProductTypesService } from "../catalog/admin/product-types/product-types.service.js";
import {
  createProductTypeSchema,
  putProductTypeAttributeSchema,
  putProductTypeOptionSchema,
} from "../catalog/admin/product-types/product-types.schemas.js";
import { ProductsService } from "../catalog/admin/products/products.service.js";
import {
  createProductSchema,
  putProductCategoriesSchema,
  putProductMediaSchema,
} from "../catalog/admin/products/products.schemas.js";

import { createShippingMethodSchema } from "../shipping/admin/shipping-methods.schemas.js";
import { ShippingMethodsService } from "../shipping/admin/shipping-methods.service.js";
import { ShippingProviderRegistry } from "../shipping/registry/index.js";

/** The demo stock is received at the default location (the `main` location of the migration). */
const STOCK_REASON = "Demo seed";

export const SEED_ENTITY_KINDS = [
  "attributes",
  "options",
  "productTypes",
  "brands",
  "categories",
  "products",
  "shippingMethods",
] as const;
export type SeedEntityKind = (typeof SEED_ENTITY_KINDS)[number];

export interface SeedSummary {
  /** Entities that were missing and are now created. A product counts once; its variants are counted below. */
  created: Record<SeedEntityKind, number>;
  /** Entities found by code or slug and left exactly as they were (never updated, never deleted). */
  existing: Record<SeedEntityKind, number>;
  variantsCreated: number;
  /** Demo shipping methods not created because their provider is not loaded (`SHIPPING_PROVIDERS_ENABLED`), by code. */
  skippedShippingMethods: string[];
  /**
   * Demo synonym groups of catalog search: written only with `SEARCH_ENABLED=true` (with search off nothing reaches the
   * search tables). A group counts as existing when one of its terms is already in a group of its locale.
   */
  synonymGroups: {
    searchEnabled: boolean;
    created: number;
    existing: number;
    /** Locales of demo groups the shop does not serve (`LOCALES`), each once. */
    skippedLocales: string[];
  };
}

function emptyCounts(): Record<SeedEntityKind, number> {
  return {
    attributes: 0,
    options: 0,
    productTypes: 0,
    brands: 0,
    categories: 0,
    products: 0,
    shippingMethods: 0,
  };
}

/** Identifies a variant by its option values, the same way for the seed data and for the generated variants. */
function variantKey(optionValues: Readonly<Record<string, string>>): string {
  return Object.entries(optionValues)
    .map(([optionCode, valueCode]) => `${optionCode}=${valueCode}`)
    .sort()
    .join(";");
}

/** Same validation as the HTTP layer: the bodies go through the very schemas the admin controllers use. */
function parse<TSchema extends z.ZodType>(schema: TSchema, value: unknown): z.output<TSchema> {
  return new ZodValidationPipe(schema).transform(value);
}

/**
 * Creates the demo catalog through the admin services, so the seed obeys exactly the rules of the admin API.
 * Idempotent and non-destructive: an entity that exists (found by its stable code or slug) is left alone with all
 * its children, nothing is updated or deleted. A product that a crashed run left half built is therefore also left
 * alone; delete it in the admin and run the seed again.
 */
export class CatalogSeeder {
  private readonly summary: SeedSummary = {
    created: emptyCounts(),
    existing: emptyCounts(),
    variantsCreated: 0,
    skippedShippingMethods: [],
    synonymGroups: { searchEnabled: false, created: 0, existing: 0, skippedLocales: [] },
  };
  private readonly attributeIds = new Map<string, string>();
  private readonly optionIds = new Map<string, string>();
  /** `<option code>/<value code>` to the value id. */
  private readonly optionValueIds = new Map<string, string>();
  private readonly categoryIds = new Map<string, string>();
  private readonly brandIds = new Map<string, string>();
  private readonly productTypeIds = new Map<string, string>();

  constructor(
    private readonly database: Database,
    private readonly attributes: AttributesService,
    private readonly options: OptionsService,
    private readonly productTypes: ProductTypesService,
    private readonly brands: BrandsService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly productOptions: ProductOptionsService,
    private readonly prices: PricesService,
    private readonly variants: VariantsService,
    private readonly inventory: InventoryService,
    private readonly pricing: PricingConfig,
    private readonly shippingMethods: ShippingMethodsService,
    private readonly shippingProviders: ShippingProviderRegistry,
    /** `null` with search off: the demo synonym groups are then not written at all. */
    private readonly synonyms: SearchSynonymSeeder | null,
  ) {}

  static fromContext(app: INestApplicationContext): CatalogSeeder {
    // The services are not exported by their modules; `strict: false` finds them anywhere in the container.
    const get = <T>(token: new (...args: never[]) => T): T => app.get(token, { strict: false });
    // The search module provides the synonym writer only with search on; the port says which (no import of src/search/).
    const search = app.get<SearchPort>(SEARCH_PORT, { strict: false });
    const synonyms = search.enabled
      ? app.get<SearchSynonymSeeder>(SEARCH_SYNONYM_SEEDER, { strict: false })
      : null;
    return new CatalogSeeder(
      app.get<Database>(DRIZZLE, { strict: false }),
      get(AttributesService),
      get(OptionsService),
      get(ProductTypesService),
      get(BrandsService),
      get(CategoriesService),
      get(ProductsService),
      get(ProductOptionsService),
      get(PricesService),
      get(VariantsService),
      get(InventoryService),
      app.get<PricingConfig>(PRICING_CONFIG, { strict: false }),
      get(ShippingMethodsService),
      get(ShippingProviderRegistry),
      synonyms,
    );
  }

  async run(seed: CatalogSeed): Promise<SeedSummary> {
    for (const definition of seed.attributes) {
      await this.ensureAttribute(definition);
    }
    for (const definition of seed.options) {
      await this.ensureOption(definition);
    }
    for (const definition of seed.productTypes) {
      await this.ensureProductType(definition);
    }
    for (const definition of seed.brands) {
      await this.ensureBrand(definition);
    }
    for (const definition of seed.categories) {
      await this.ensureCategory(definition, null);
    }
    for (const definition of seed.products) {
      await this.ensureProduct(definition);
    }
    for (const definition of seed.shippingMethods) {
      await this.ensureShippingMethod(definition);
    }
    await this.ensureSynonymGroups(seed.synonymGroups);
    return this.summary;
  }

  /**
   * The demo synonym groups, through the admin search service (same rules as `POST /admin/search/synonyms`). With search
   * off there is no writer and nothing is written: the search tables stay untouched (feature matrix `search-off`). With
   * search on, job 13 applies the groups as an in-place settings update (`pnpm search:reindex` or the next tick).
   */
  private async ensureSynonymGroups(groups: readonly SeedSynonymGroup[]): Promise<void> {
    const summary = this.summary.synonymGroups;
    if (this.synonyms === null) {
      return;
    }
    summary.searchEnabled = true;
    for (const group of groups) {
      const outcome = await this.synonyms.ensureGroup(group.locale, group.terms);
      if (outcome === "created") {
        summary.created += 1;
      } else if (outcome === "existing") {
        summary.existing += 1;
      } else if (!summary.skippedLocales.includes(group.locale)) {
        summary.skippedLocales.push(group.locale);
      }
    }
  }

  /**
   * A demo delivery method, always created INACTIVE (the checkout of a fresh demo stays as it is without methods). A method
   * of a provider that is not loaded is skipped and reported: the admin service refuses it, and it could never be offered.
   */
  private async ensureShippingMethod(definition: SeedShippingMethod): Promise<void> {
    const [row] = await this.database
      .select({ id: shippingMethod.id })
      .from(shippingMethod)
      .where(eq(shippingMethod.code, definition.code));
    if (row !== undefined) {
      this.summary.existing.shippingMethods += 1;
      return;
    }
    if (
      definition.providerCode !== null &&
      this.shippingProviders.get(definition.providerCode) === undefined
    ) {
      this.summary.skippedShippingMethods.push(definition.code);
      return;
    }
    await this.shippingMethods.create(
      parse(createShippingMethodSchema, {
        code: definition.code,
        title: definition.title,
        description: definition.description,
        kind: definition.kind,
        providerCode: definition.providerCode,
        pricing: definition.pricing,
        countryCodes: definition.countryCodes,
        isActive: false,
        position: definition.position,
      }),
    );
    this.summary.created.shippingMethods += 1;
  }

  // Read-only lookups by the stable code or slug; every write goes through the admin services.
  private async findAttributeId(code: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: attribute.id })
      .from(attribute)
      .where(eq(attribute.code, code))
      .limit(1);
    return row?.id;
  }

  private async findOptionId(code: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: option.id })
      .from(option)
      .where(eq(option.code, code))
      .limit(1);
    return row?.id;
  }

  private async findProductTypeId(code: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: productType.id })
      .from(productType)
      .where(eq(productType.code, code))
      .limit(1);
    return row?.id;
  }

  private async findBrandId(slug: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: brand.id })
      .from(brand)
      .where(eq(brand.slug, slug))
      .limit(1);
    return row?.id;
  }

  private async findCategoryId(slug: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: category.id })
      .from(category)
      .where(eq(category.slug, slug))
      .limit(1);
    return row?.id;
  }

  private async findProductId(slug: string): Promise<string | undefined> {
    const [row] = await this.database
      .select({ id: product.id })
      .from(product)
      .where(eq(product.slug, slug))
      .limit(1);
    return row?.id;
  }

  private async ensureAttribute(definition: SeedAttribute): Promise<void> {
    const existingId = await this.findAttributeId(definition.code);
    if (existingId !== undefined) {
      this.attributeIds.set(definition.code, existingId);
      this.summary.existing.attributes += 1;
      return;
    }
    const created = await this.attributes.create(
      parse(createAttributeSchema, {
        code: definition.code,
        name: definition.name,
        inputType: definition.inputType,
        ...(definition.isLocalized === undefined ? {} : { isLocalized: definition.isLocalized }),
        ...(definition.unit === undefined ? {} : { unit: definition.unit }),
        ...(definition.validation === undefined ? {} : { validation: definition.validation }),
        ...(definition.isFilterable === undefined ? {} : { isFilterable: definition.isFilterable }),
        ...(definition.isSortable === undefined ? {} : { isSortable: definition.isSortable }),
        ...(definition.isInternal === undefined ? {} : { isInternal: definition.isInternal }),
      }),
    );
    for (const [position, choice] of (definition.options ?? []).entries()) {
      await this.attributes.createOption(
        created.id,
        parse(createAttributeOptionSchema, { code: choice.code, label: choice.label, position }),
      );
    }
    this.attributeIds.set(definition.code, created.id);
    this.summary.created.attributes += 1;
  }

  private async ensureOption(definition: CatalogSeed["options"][number]): Promise<void> {
    let optionId = await this.findOptionId(definition.code);
    if (optionId === undefined) {
      const created = await this.options.create(
        parse(createOptionSchema, { code: definition.code, name: definition.name }),
      );
      optionId = created.id;
      for (const [position, value] of definition.values.entries()) {
        await this.options.createValue(
          optionId,
          parse(createOptionValueSchema, { code: value.code, label: value.label, position }),
        );
      }
      this.summary.created.options += 1;
    } else {
      this.summary.existing.options += 1;
    }
    this.optionIds.set(definition.code, optionId);
    // Products need the value ids whether the option is new or was there before.
    for (const value of (await this.options.get(optionId)).values) {
      this.optionValueIds.set(`${definition.code}/${value.code}`, value.id);
    }
  }

  private async ensureProductType(definition: CatalogSeed["productTypes"][number]): Promise<void> {
    const existingId = await this.findProductTypeId(definition.code);
    if (existingId !== undefined) {
      this.productTypeIds.set(definition.code, existingId);
      this.summary.existing.productTypes += 1;
      return;
    }
    const created = await this.productTypes.create(
      parse(createProductTypeSchema, {
        code: definition.code,
        name: definition.name,
        requiresShipping: definition.requiresShipping,
      }),
    );
    for (const [position, assignment] of definition.attributes.entries()) {
      await this.productTypes.putAttribute(
        created.id,
        this.lookup(this.attributeIds, assignment.attributeCode, "attribute"),
        parse(putProductTypeAttributeSchema, {
          level: assignment.level,
          isRequired: assignment.isRequired ?? false,
          position,
        }),
      );
    }
    for (const [position, optionCode] of definition.optionCodes.entries()) {
      await this.productTypes.putOption(
        created.id,
        this.lookup(this.optionIds, optionCode, "option"),
        parse(putProductTypeOptionSchema, { position }),
      );
    }
    this.productTypeIds.set(definition.code, created.id);
    this.summary.created.productTypes += 1;
  }

  private async ensureBrand(definition: CatalogSeed["brands"][number]): Promise<void> {
    const existingId = await this.findBrandId(definition.slug);
    if (existingId !== undefined) {
      this.brandIds.set(definition.slug, existingId);
      this.summary.existing.brands += 1;
      return;
    }
    const created = await this.brands.create(
      parse(createBrandSchema, { slug: definition.slug, name: definition.name }),
    );
    this.brandIds.set(definition.slug, created.id);
    this.summary.created.brands += 1;
  }

  private async ensureCategory(definition: SeedCategory, parentId: string | null): Promise<void> {
    let categoryId = await this.findCategoryId(definition.slug);
    if (categoryId === undefined) {
      const created = await this.categories.create(
        parse(createCategorySchema, {
          slug: definition.slug,
          name: definition.name,
          parentId,
        }),
      );
      categoryId = created.id;
      this.summary.created.categories += 1;
    } else {
      this.summary.existing.categories += 1;
    }
    this.categoryIds.set(definition.slug, categoryId);
    for (const child of definition.children ?? []) {
      await this.ensureCategory(child, categoryId);
    }
  }

  private async ensureProduct(definition: SeedProduct): Promise<void> {
    if ((await this.findProductId(definition.slug)) !== undefined) {
      this.summary.existing.products += 1;
      return;
    }
    const created = await this.products.create(
      parse(createProductSchema, {
        productTypeId: this.lookup(this.productTypeIds, definition.productTypeCode, "product type"),
        brandId: this.lookup(this.brandIds, definition.brandSlug, "brand"),
        slug: definition.slug,
        title: definition.title,
        description: definition.description,
        attributes: definition.attributes,
      }),
    );
    const productId = created.id;

    // Choosing options generates one variant per combination (the default variant is replaced).
    if (definition.options.length > 0) {
      await this.productOptions.put(
        productId,
        parse(putProductOptionsSchema, {
          options: definition.options.map((selection) => ({
            optionId: this.lookup(this.optionIds, selection.optionCode, "option"),
            valueIds: selection.valueCodes.map((valueCode) =>
              this.lookup(
                this.optionValueIds,
                `${selection.optionCode}/${valueCode}`,
                "option value",
              ),
            ),
          })),
        }),
      );
    }

    const [firstCategorySlug] = definition.categorySlugs;
    await this.products.putCategories(
      productId,
      parse(putProductCategoriesSchema, {
        categories: definition.categorySlugs.map((slug) => ({
          categoryId: this.lookup(this.categoryIds, slug, "category"),
        })),
        primaryCategoryId:
          firstCategorySlug === undefined
            ? null
            : this.lookup(this.categoryIds, firstCategorySlug, "category"),
      }),
    );

    await this.products.putMedia(
      productId,
      parse(putProductMediaSchema, {
        media: definition.media.map((item) => ({
          url: item.url,
          alt: item.alt,
          ...(item.optionValue === undefined
            ? {}
            : {
                optionId: this.lookup(this.optionIds, item.optionValue.optionCode, "option"),
                optionValueId: this.lookup(
                  this.optionValueIds,
                  `${item.optionValue.optionCode}/${item.optionValue.valueCode}`,
                  "option value",
                ),
              }),
        })),
      }),
    );

    // Publishing needs a shop-currency price on every active variant, so prices go in before the product goes live.
    const { variants } = await this.products.get(productId);
    const commerceOf = new Map(
      definition.variants.map((commerce) => [variantKey(commerce.optionValues), commerce]),
    );
    const matched = variants.map((variant) => ({
      variant,
      commerce: this.lookupCommerce(
        commerceOf,
        variantKey(
          Object.fromEntries(variant.optionValues.map((pair) => [pair.optionCode, pair.valueCode])),
        ),
        definition.slug,
      ),
    }));
    if (commerceOf.size !== variants.length) {
      throw new Error(
        `Seed data for product "${definition.slug}" describes ${commerceOf.size} variants but its options generate ${variants.length}.`,
      );
    }
    await this.prices.putMany(
      productId,
      parse(putProductPricesSchema, {
        items: matched.map(({ variant, commerce }) => ({
          variantId: variant.id,
          currency: this.pricing.shopCurrency,
          amount: commerce.amount,
          ...(commerce.compareAtAmount === undefined
            ? {}
            : { compareAtAmount: commerce.compareAtAmount }),
        })),
      }),
    );

    for (const { variant, commerce } of matched) {
      if (commerce.allowBackorder === true) {
        await this.variants.update(
          productId,
          variant.id,
          parse(updateVariantSchema, { allowBackorder: true }),
        );
      }
      // A tracked variant with no stock gets no level row and no movement: its absence is the "out of stock" state.
      if (commerce.stock !== undefined && commerce.stock > 0) {
        // A system change: the seed has no admin user, so the journal row keeps a null actor.
        await this.inventory.adjust(
          productId,
          variant.id,
          parse(adjustmentSchema, { delta: commerce.stock, kind: "receipt", reason: STOCK_REASON }),
          null,
        );
      }
    }

    const published = await this.products.transition(productId, "publish");
    this.summary.variantsCreated += published.variants.length;
    this.summary.created.products += 1;
  }

  private lookupCommerce(
    commerceOf: ReadonlyMap<string, SeedVariantCommerce>,
    key: string,
    slug: string,
  ): SeedVariantCommerce {
    const commerce = commerceOf.get(key);
    if (commerce === undefined) {
      throw new Error(
        `Seed data for product "${slug}" has no price for the variant "${key || "default"}".`,
      );
    }
    return commerce;
  }

  /** A reference that resolves to nothing is a bug in the seed data or a half-seeded database: fail loudly. */
  private lookup(ids: ReadonlyMap<string, string>, key: string, kind: string): string {
    const id = ids.get(key);
    if (id === undefined) {
      throw new Error(`Seed data refers to a ${kind} "${key}" that does not exist.`);
    }
    return id;
  }
}
