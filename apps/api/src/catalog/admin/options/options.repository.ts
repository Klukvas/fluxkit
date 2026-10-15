import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  option,
  optionValue,
  productOption,
  productOptionValue,
  productTypeOption,
} from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";

type OptionRow = typeof option.$inferSelect;
type NewOption = typeof option.$inferInsert;
type OptionChanges = Partial<Pick<NewOption, "name">>;
type OptionValueRow = typeof optionValue.$inferSelect;
type NewOptionValue = typeof optionValue.$inferInsert;
type OptionValueChanges = Partial<Pick<NewOptionValue, "label" | "position">>;

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class OptionsRepository {
  async insert(db: DbExecutor, values: NewOption): Promise<OptionRow> {
    const [row] = await db.insert(option).values(values).returning();
    return required(row);
  }

  async findById(db: DbExecutor, id: string): Promise<OptionRow | undefined> {
    const [row] = await db.select().from(option).where(eq(option.id, id));
    return row;
  }

  /** Locks the row until the transaction ends, so rule checks and the write see the same state. */
  async findByIdForUpdate(db: DbExecutor, id: string): Promise<OptionRow | undefined> {
    const [row] = await db.select().from(option).where(eq(option.id, id)).for("update");
    return row;
  }

  /** Stable order: code, then id. */
  async list(db: DbExecutor, page: PaginationQuery): Promise<{ rows: OptionRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(option)
        .orderBy(asc(option.code), asc(option.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(option),
    ]);
    return { rows, total };
  }

  async update(db: DbExecutor, id: string, changes: OptionChanges): Promise<OptionRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db.update(option).set(changes).where(eq(option.id, id)).returning();
    return row;
  }

  async delete(db: DbExecutor, id: string): Promise<void> {
    await db.delete(option).where(eq(option.id, id));
  }

  async isAssignedToProductTypes(db: DbExecutor, optionId: string): Promise<boolean> {
    return (await db.$count(productTypeOption, eq(productTypeOption.optionId, optionId))) > 0;
  }

  async isUsedByProducts(db: DbExecutor, optionId: string): Promise<boolean> {
    return (await db.$count(productOption, eq(productOption.optionId, optionId))) > 0;
  }

  async isValueUsedByProducts(db: DbExecutor, valueId: string): Promise<boolean> {
    return (await db.$count(productOptionValue, eq(productOptionValue.optionValueId, valueId))) > 0;
  }

  /** Position, then code, then id. */
  listValues(db: DbExecutor, optionId: string): Promise<OptionValueRow[]> {
    return db
      .select()
      .from(optionValue)
      .where(eq(optionValue.optionId, optionId))
      .orderBy(asc(optionValue.position), asc(optionValue.code), asc(optionValue.id));
  }

  countValues(db: DbExecutor, optionId: string): Promise<number> {
    return db.$count(optionValue, eq(optionValue.optionId, optionId));
  }

  async findValue(
    db: DbExecutor,
    optionId: string,
    valueId: string,
  ): Promise<OptionValueRow | undefined> {
    const [row] = await db
      .select()
      .from(optionValue)
      .where(and(eq(optionValue.id, valueId), eq(optionValue.optionId, optionId)));
    return row;
  }

  async insertValue(db: DbExecutor, values: NewOptionValue): Promise<OptionValueRow> {
    const [row] = await db.insert(optionValue).values(values).returning();
    return required(row);
  }

  async updateValue(
    db: DbExecutor,
    valueId: string,
    changes: OptionValueChanges,
  ): Promise<OptionValueRow | undefined> {
    const [row] = await db
      .update(optionValue)
      .set(changes)
      .where(eq(optionValue.id, valueId))
      .returning();
    return row;
  }

  async deleteValue(db: DbExecutor, valueId: string): Promise<void> {
    await db.delete(optionValue).where(eq(optionValue.id, valueId));
  }
}
