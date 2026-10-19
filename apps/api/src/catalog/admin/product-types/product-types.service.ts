import { Inject, Injectable } from "@nestjs/common";
import {
  CATALOG_LIMITS,
  TEXT_LIMITS,
  decideDeleteProductType,
  decideLevelChange,
  decideRemoveAttributeFromType,
  decideRemoveOptionFromType,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { translatePostgresError } from "../../../common/postgres-errors.js";
import { notFound, validationFailed } from "../../../common/problem.js";
import { withTransaction } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { attributeHasValues } from "../../shared/attribute-usage.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { assertAllowed, required } from "../../shared/rules.js";
import {
  toAttributeAssignmentResponse,
  toOptionAssignmentResponse,
  toProductTypeDetailResponse,
  toProductTypeResponse,
} from "./product-types.mapper.js";
import { ProductTypesRepository } from "./product-types.repository.js";
import {
  attributeLevelSchema,
  type CreateProductTypeBody,
  type ProductTypeAttributeResponse,
  type ProductTypeDetailResponse,
  type ProductTypeOptionResponse,
  type ProductTypeResponse,
  type PutProductTypeAttributeBody,
  type PutProductTypeOptionBody,
  type UpdateProductTypeBody,
} from "./product-types.schemas.js";

@Injectable()
export class ProductTypesService {
  constructor(
    private readonly productTypes: ProductTypesRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async create(body: CreateProductTypeBody): Promise<ProductTypeResponse> {
    this.assertValidName(body.name);
    try {
      const row = await this.productTypes.insert(this.database, {
        code: body.code,
        name: body.name,
        ...(body.requiresShipping === undefined ? {} : { requiresShipping: body.requiresShipping }),
      });
      return toProductTypeResponse(row);
    } catch (error) {
      throw translatePostgresError(error, {
        detail: "Another product type already uses this code.",
      });
    }
  }

  async get(id: string): Promise<ProductTypeDetailResponse> {
    const row = await this.productTypes.findById(this.database, id);
    if (row === undefined) {
      throw notFound("Product type");
    }
    const [attributes, options] = await Promise.all([
      this.productTypes.listAttributeAssignments(this.database, id),
      this.productTypes.listOptionAssignments(this.database, id),
    ]);
    // Two more statements for the definitions of every assigned attribute, however many there are (no N+1).
    const attributeIds = attributes.map((assignment) => assignment.attributeId);
    const [definitions, definitionOptions] = await Promise.all([
      this.productTypes.listAttributesByIds(this.database, attributeIds),
      this.productTypes.listAttributeOptionsOf(this.database, attributeIds),
    ]);
    return toProductTypeDetailResponse(row, attributes, options, definitions, definitionOptions);
  }

  async list(page: PaginationQuery): Promise<Page<ProductTypeResponse>> {
    const { rows, total } = await this.productTypes.list(this.database, page);
    return toPage(rows.map(toProductTypeResponse), total, page);
  }

  async update(id: string, body: UpdateProductTypeBody): Promise<ProductTypeResponse> {
    if (body.name !== undefined) {
      this.assertValidName(body.name);
    }
    const changes = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.requiresShipping === undefined ? {} : { requiresShipping: body.requiresShipping }),
    };
    const row =
      Object.keys(changes).length === 0
        ? await this.productTypes.findById(this.database, id)
        : await this.productTypes.update(this.database, id, changes);
    if (row === undefined) {
      throw notFound("Product type");
    }
    return toProductTypeResponse(row);
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      if ((await this.productTypes.findByIdForUpdate(tx, id)) === undefined) {
        throw notFound("Product type");
      }
      assertAllowed(
        decideDeleteProductType({ hasProducts: await this.productTypes.hasProducts(tx, id) }),
        "Products still use this product type.",
      );
      try {
        await this.productTypes.delete(tx, id);
      } catch (error) {
        // product.product_type_id is RESTRICT: backstop when a product appears concurrently.
        throw translatePostgresError(error, { detail: "Products still use this product type." });
      }
    });
  }

  /** Creates the assignment or replaces its level, required flag and position. */
  async putAttribute(
    productTypeId: string,
    attributeId: string,
    body: PutProductTypeAttributeBody,
  ): Promise<{ assignment: ProductTypeAttributeResponse; created: boolean }> {
    const values = {
      level: body.level,
      isRequired: body.isRequired ?? false,
      position: body.position ?? 0,
    };
    return withTransaction(this.database, async (tx) => {
      if ((await this.productTypes.findByIdForUpdate(tx, productTypeId)) === undefined) {
        throw notFound("Product type");
      }
      const attribute = await this.productTypes.findAttribute(tx, attributeId);
      if (attribute === undefined) {
        throw notFound("Attribute");
      }
      const existing = await this.productTypes.findAttributeAssignment(
        tx,
        productTypeId,
        attributeId,
      );
      if (existing === undefined) {
        if (
          (await this.productTypes.countAttributeAssignments(tx, productTypeId)) >=
          CATALOG_LIMITS.maxAttributesPerProductType
        ) {
          throw validationFailed([
            {
              path: "",
              code: "limit_exceeded",
              message: `At most ${CATALOG_LIMITS.maxAttributesPerProductType} attributes per product type.`,
            },
          ]);
        }
        await this.productTypes.insertAttributeAssignment(tx, productTypeId, attributeId, values);
      } else {
        const currentLevel = attributeLevelSchema.parse(existing.level);
        if (currentLevel !== values.level) {
          assertAllowed(
            decideLevelChange(
              { currentLevel, nextLevel: values.level },
              { valuesExist: await attributeHasValues(tx, attribute, productTypeId) },
            ),
            "The level cannot change while products or variants of this type hold values of the attribute.",
          );
        }
        await this.productTypes.updateAttributeAssignment(tx, productTypeId, attributeId, values);
      }
      const saved = required(
        await this.productTypes.findAttributeAssignment(tx, productTypeId, attributeId),
      );
      return { assignment: toAttributeAssignmentResponse(saved), created: existing === undefined };
    });
  }

  async removeAttribute(productTypeId: string, attributeId: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      if ((await this.productTypes.findByIdForUpdate(tx, productTypeId)) === undefined) {
        throw notFound("Product type");
      }
      const assignment = await this.productTypes.findAttributeAssignment(
        tx,
        productTypeId,
        attributeId,
      );
      const attribute = await this.productTypes.findAttribute(tx, attributeId);
      if (assignment === undefined || attribute === undefined) {
        throw notFound("Attribute assignment");
      }
      assertAllowed(
        decideRemoveAttributeFromType({
          valuesExist: await attributeHasValues(tx, attribute, productTypeId),
        }),
        "Products or variants of this type still hold values of the attribute; clear them first.",
      );
      await this.productTypes.deleteAttributeAssignment(tx, productTypeId, attributeId);
    });
  }

  /** Creates the assignment or replaces its position. */
  async putOption(
    productTypeId: string,
    optionId: string,
    body: PutProductTypeOptionBody,
  ): Promise<{ assignment: ProductTypeOptionResponse; created: boolean }> {
    const position = body.position ?? 0;
    return withTransaction(this.database, async (tx) => {
      if ((await this.productTypes.findByIdForUpdate(tx, productTypeId)) === undefined) {
        throw notFound("Product type");
      }
      if ((await this.productTypes.findOption(tx, optionId)) === undefined) {
        throw notFound("Option");
      }
      const existing = await this.productTypes.findOptionAssignment(tx, productTypeId, optionId);
      if (existing === undefined) {
        await this.productTypes.insertOptionAssignment(tx, productTypeId, optionId, position);
      } else {
        await this.productTypes.updateOptionAssignment(tx, productTypeId, optionId, position);
      }
      const saved = required(
        await this.productTypes.findOptionAssignment(tx, productTypeId, optionId),
      );
      return { assignment: toOptionAssignmentResponse(saved), created: existing === undefined };
    });
  }

  async removeOption(productTypeId: string, optionId: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      if ((await this.productTypes.findByIdForUpdate(tx, productTypeId)) === undefined) {
        throw notFound("Product type");
      }
      if (
        (await this.productTypes.findOptionAssignment(tx, productTypeId, optionId)) === undefined
      ) {
        throw notFound("Option assignment");
      }
      assertAllowed(
        decideRemoveOptionFromType({
          usedByProducts: await this.productTypes.optionUsedByProductsOfType(
            tx,
            productTypeId,
            optionId,
          ),
        }),
        "Products of this type still use the option.",
      );
      await this.productTypes.deleteOptionAssignment(tx, productTypeId, optionId);
    });
  }

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private assertValidName(name: unknown): void {
    const errors = i18nFieldErrors("name", name, this.locale, {
      required: true,
      maxLength: TEXT_LIMITS.name,
    });
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }
}
