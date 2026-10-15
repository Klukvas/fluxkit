import { Injectable } from "@nestjs/common";
import { and, asc, count, eq } from "drizzle-orm";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  attribute,
  attributeOption,
  productTypeAttribute,
} from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";

type AttributeRow = typeof attribute.$inferSelect;
type NewAttribute = typeof attribute.$inferInsert;
type AttributeChanges = Partial<Omit<NewAttribute, "id" | "code" | "createdAt" | "updatedAt">>;
type AttributeOptionRow = typeof attributeOption.$inferSelect;
type NewAttributeOption = typeof attributeOption.$inferInsert;
type AttributeOptionChanges = Partial<Pick<NewAttributeOption, "label" | "position">>;

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class AttributesRepository {
  async insert(db: DbExecutor, values: NewAttribute): Promise<AttributeRow> {
    const [row] = await db.insert(attribute).values(values).returning();
    return required(row);
  }

  async findById(db: DbExecutor, id: string): Promise<AttributeRow | undefined> {
    const [row] = await db.select().from(attribute).where(eq(attribute.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so rule checks and the write see the same state. */
  async findByIdForUpdate(db: DbExecutor, id: string): Promise<AttributeRow | undefined> {
    const [row] = await db.select().from(attribute).where(eq(attribute.id, id)).for("update");
    return row;
  }

  /** Stable order: code, then id. */
  async list(
    db: DbExecutor,
    page: PaginationQuery,
  ): Promise<{ rows: AttributeRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(attribute)
        .orderBy(asc(attribute.code), asc(attribute.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(attribute),
    ]);
    return { rows, total };
  }

  async update(
    db: DbExecutor,
    id: string,
    changes: AttributeChanges,
  ): Promise<AttributeRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db.update(attribute).set(changes).where(eq(attribute.id, id)).returning();
    return row;
  }

  /** Returns false when no such attribute exists. */
  async delete(db: DbExecutor, id: string): Promise<boolean> {
    const rows = await db
      .delete(attribute)
      .where(eq(attribute.id, id))
      .returning({ id: attribute.id });
    return rows.length > 0;
  }

  async isAssignedToProductTypes(db: DbExecutor, attributeId: string): Promise<boolean> {
    const [row] = await db
      .select({ total: count() })
      .from(productTypeAttribute)
      .where(eq(productTypeAttribute.attributeId, attributeId));
    return (row?.total ?? 0) > 0;
  }

  /** Position, then code, then id. */
  listOptions(db: DbExecutor, attributeId: string): Promise<AttributeOptionRow[]> {
    return db
      .select()
      .from(attributeOption)
      .where(eq(attributeOption.attributeId, attributeId))
      .orderBy(asc(attributeOption.position), asc(attributeOption.code), asc(attributeOption.id));
  }

  countOptions(db: DbExecutor, attributeId: string): Promise<number> {
    return db.$count(attributeOption, eq(attributeOption.attributeId, attributeId));
  }

  async findOption(
    db: DbExecutor,
    attributeId: string,
    optionId: string,
  ): Promise<AttributeOptionRow | undefined> {
    const [row] = await db
      .select()
      .from(attributeOption)
      .where(and(eq(attributeOption.id, optionId), eq(attributeOption.attributeId, attributeId)));
    return row;
  }

  async insertOption(db: DbExecutor, values: NewAttributeOption): Promise<AttributeOptionRow> {
    const [row] = await db.insert(attributeOption).values(values).returning();
    return required(row);
  }

  async updateOption(
    db: DbExecutor,
    optionId: string,
    changes: AttributeOptionChanges,
  ): Promise<AttributeOptionRow | undefined> {
    const [row] = await db
      .update(attributeOption)
      .set(changes)
      .where(eq(attributeOption.id, optionId))
      .returning();
    return row;
  }

  async deleteOption(db: DbExecutor, optionId: string): Promise<void> {
    await db.delete(attributeOption).where(eq(attributeOption.id, optionId));
  }
}
