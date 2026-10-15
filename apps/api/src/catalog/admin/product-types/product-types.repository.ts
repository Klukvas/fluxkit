import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  attribute,
  option,
  product,
  productOption,
  productType,
  productTypeAttribute,
  productTypeOption,
} from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";

type ProductTypeRow = typeof productType.$inferSelect;
type NewProductType = typeof productType.$inferInsert;
type ProductTypeChanges = Partial<Pick<NewProductType, "name" | "requiresShipping">>;
type AttributeRow = typeof attribute.$inferSelect;
type OptionRow = typeof option.$inferSelect;

/** An attribute assignment joined with the attribute code. */
export interface AttributeAssignmentRow {
  productTypeId: string;
  attributeId: string;
  attributeCode: string;
  level: string;
  isRequired: boolean;
  position: number;
  createdAt: Date;
}

/** An option assignment joined with the option code. */
export interface OptionAssignmentRow {
  productTypeId: string;
  optionId: string;
  optionCode: string;
  position: number;
  createdAt: Date;
}

export interface AttributeAssignmentValues {
  level: string;
  isRequired: boolean;
  position: number;
}

const attributeAssignmentColumns = {
  productTypeId: productTypeAttribute.productTypeId,
  attributeId: productTypeAttribute.attributeId,
  attributeCode: attribute.code,
  level: productTypeAttribute.level,
  isRequired: productTypeAttribute.isRequired,
  position: productTypeAttribute.position,
  createdAt: productTypeAttribute.createdAt,
};

const optionAssignmentColumns = {
  productTypeId: productTypeOption.productTypeId,
  optionId: productTypeOption.optionId,
  optionCode: option.code,
  position: productTypeOption.position,
  createdAt: productTypeOption.createdAt,
};

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class ProductTypesRepository {
  async insert(db: DbExecutor, values: NewProductType): Promise<ProductTypeRow> {
    const [row] = await db.insert(productType).values(values).returning();
    return required(row);
  }

  async findById(db: DbExecutor, id: string): Promise<ProductTypeRow | undefined> {
    const [row] = await db.select().from(productType).where(eq(productType.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so assignment rules and writes see the same state. */
  async findByIdForUpdate(db: DbExecutor, id: string): Promise<ProductTypeRow | undefined> {
    const [row] = await db.select().from(productType).where(eq(productType.id, id)).for("update");
    return row;
  }

  /** Stable order: code, then id. */
  async list(
    db: DbExecutor,
    page: PaginationQuery,
  ): Promise<{ rows: ProductTypeRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(productType)
        .orderBy(asc(productType.code), asc(productType.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(productType),
    ]);
    return { rows, total };
  }

  async update(
    db: DbExecutor,
    id: string,
    changes: ProductTypeChanges,
  ): Promise<ProductTypeRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db
      .update(productType)
      .set(changes)
      .where(eq(productType.id, id))
      .returning();
    return row;
  }

  async delete(db: DbExecutor, id: string): Promise<void> {
    await db.delete(productType).where(eq(productType.id, id));
  }

  async hasProducts(db: DbExecutor, productTypeId: string): Promise<boolean> {
    return (await db.$count(product, eq(product.productTypeId, productTypeId))) > 0;
  }

  async findAttribute(db: DbExecutor, id: string): Promise<AttributeRow | undefined> {
    const [row] = await db.select().from(attribute).where(eq(attribute.id, id));
    return row;
  }

  async findOption(db: DbExecutor, id: string): Promise<OptionRow | undefined> {
    const [row] = await db.select().from(option).where(eq(option.id, id));
    return row;
  }

  /** Position, then attribute code. */
  listAttributeAssignments(
    db: DbExecutor,
    productTypeId: string,
  ): Promise<AttributeAssignmentRow[]> {
    return db
      .select(attributeAssignmentColumns)
      .from(productTypeAttribute)
      .innerJoin(attribute, eq(attribute.id, productTypeAttribute.attributeId))
      .where(eq(productTypeAttribute.productTypeId, productTypeId))
      .orderBy(asc(productTypeAttribute.position), asc(attribute.code));
  }

  countAttributeAssignments(db: DbExecutor, productTypeId: string): Promise<number> {
    return db.$count(productTypeAttribute, eq(productTypeAttribute.productTypeId, productTypeId));
  }

  async findAttributeAssignment(
    db: DbExecutor,
    productTypeId: string,
    attributeId: string,
  ): Promise<AttributeAssignmentRow | undefined> {
    const [row] = await db
      .select(attributeAssignmentColumns)
      .from(productTypeAttribute)
      .innerJoin(attribute, eq(attribute.id, productTypeAttribute.attributeId))
      .where(
        and(
          eq(productTypeAttribute.productTypeId, productTypeId),
          eq(productTypeAttribute.attributeId, attributeId),
        ),
      );
    return row;
  }

  async insertAttributeAssignment(
    db: DbExecutor,
    productTypeId: string,
    attributeId: string,
    values: AttributeAssignmentValues,
  ): Promise<void> {
    await db.insert(productTypeAttribute).values({ productTypeId, attributeId, ...values });
  }

  async updateAttributeAssignment(
    db: DbExecutor,
    productTypeId: string,
    attributeId: string,
    values: AttributeAssignmentValues,
  ): Promise<void> {
    await db
      .update(productTypeAttribute)
      .set(values)
      .where(
        and(
          eq(productTypeAttribute.productTypeId, productTypeId),
          eq(productTypeAttribute.attributeId, attributeId),
        ),
      );
  }

  async deleteAttributeAssignment(
    db: DbExecutor,
    productTypeId: string,
    attributeId: string,
  ): Promise<void> {
    await db
      .delete(productTypeAttribute)
      .where(
        and(
          eq(productTypeAttribute.productTypeId, productTypeId),
          eq(productTypeAttribute.attributeId, attributeId),
        ),
      );
  }

  /** Position, then option code. */
  listOptionAssignments(db: DbExecutor, productTypeId: string): Promise<OptionAssignmentRow[]> {
    return db
      .select(optionAssignmentColumns)
      .from(productTypeOption)
      .innerJoin(option, eq(option.id, productTypeOption.optionId))
      .where(eq(productTypeOption.productTypeId, productTypeId))
      .orderBy(asc(productTypeOption.position), asc(option.code));
  }

  async findOptionAssignment(
    db: DbExecutor,
    productTypeId: string,
    optionId: string,
  ): Promise<OptionAssignmentRow | undefined> {
    const [row] = await db
      .select(optionAssignmentColumns)
      .from(productTypeOption)
      .innerJoin(option, eq(option.id, productTypeOption.optionId))
      .where(
        and(
          eq(productTypeOption.productTypeId, productTypeId),
          eq(productTypeOption.optionId, optionId),
        ),
      );
    return row;
  }

  async insertOptionAssignment(
    db: DbExecutor,
    productTypeId: string,
    optionId: string,
    position: number,
  ): Promise<void> {
    await db.insert(productTypeOption).values({ productTypeId, optionId, position });
  }

  async updateOptionAssignment(
    db: DbExecutor,
    productTypeId: string,
    optionId: string,
    position: number,
  ): Promise<void> {
    await db
      .update(productTypeOption)
      .set({ position })
      .where(
        and(
          eq(productTypeOption.productTypeId, productTypeId),
          eq(productTypeOption.optionId, optionId),
        ),
      );
  }

  async deleteOptionAssignment(
    db: DbExecutor,
    productTypeId: string,
    optionId: string,
  ): Promise<void> {
    await db
      .delete(productTypeOption)
      .where(
        and(
          eq(productTypeOption.productTypeId, productTypeId),
          eq(productTypeOption.optionId, optionId),
        ),
      );
  }

  /** True when a product of this type chose the option (`product_option`). */
  async optionUsedByProductsOfType(
    db: DbExecutor,
    productTypeId: string,
    optionId: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ productId: productOption.productId })
      .from(productOption)
      .innerJoin(product, eq(product.id, productOption.productId))
      .where(and(eq(productOption.optionId, optionId), eq(product.productTypeId, productTypeId)))
      .limit(1);
    return rows.length > 0;
  }
}
