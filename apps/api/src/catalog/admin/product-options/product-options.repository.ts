import { Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../../common/transaction.js";
import {
  option,
  optionValue,
  productOption,
  productOptionValue,
  productTypeOption,
} from "../../../database/schema/index.js";

export interface OptionValueRow {
  id: string;
  optionId: string;
}

/** Queries only (Drizzle query builder, parameterized). Every method runs on the executor it is given. */
@Injectable()
export class ProductOptionsRepository {
  /** Ids of the options the product type allows (`product_type_option`). */
  async findAllowedOptionIds(db: DbExecutor, productTypeId: string): Promise<string[]> {
    const rows = await db
      .select({ optionId: productTypeOption.optionId })
      .from(productTypeOption)
      .where(eq(productTypeOption.productTypeId, productTypeId));
    return rows.map((row) => row.optionId);
  }

  async optionExists(db: DbExecutor, optionId: string): Promise<boolean> {
    return (await db.$count(option, eq(option.id, optionId))) > 0;
  }

  async findOptionValues(db: DbExecutor, ids: readonly string[]): Promise<OptionValueRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return db
      .select({ id: optionValue.id, optionId: optionValue.optionId })
      .from(optionValue)
      .where(inArray(optionValue.id, [...ids]));
  }

  async insertProductOptions(
    db: DbExecutor,
    productId: string,
    rows: readonly { optionId: string; position: number }[],
  ): Promise<void> {
    if (rows.length > 0) {
      await db.insert(productOption).values(rows.map((row) => ({ productId, ...row })));
    }
  }

  /** Cascades to the option's `product_option_value` rows. */
  async deleteProductOptions(
    db: DbExecutor,
    productId: string,
    optionIds: readonly string[],
  ): Promise<void> {
    if (optionIds.length > 0) {
      await db
        .delete(productOption)
        .where(
          and(
            eq(productOption.productId, productId),
            inArray(productOption.optionId, [...optionIds]),
          ),
        );
    }
  }

  async insertProductOptionValues(
    db: DbExecutor,
    productId: string,
    rows: readonly { optionId: string; optionValueId: string; position: number }[],
  ): Promise<void> {
    if (rows.length > 0) {
      await db.insert(productOptionValue).values(rows.map((row) => ({ productId, ...row })));
    }
  }

  async deleteProductOptionValues(
    db: DbExecutor,
    productId: string,
    optionId: string,
    optionValueIds: readonly string[],
  ): Promise<void> {
    if (optionValueIds.length > 0) {
      await db
        .delete(productOptionValue)
        .where(
          and(
            eq(productOptionValue.productId, productId),
            eq(productOptionValue.optionId, optionId),
            inArray(productOptionValue.optionValueId, [...optionValueIds]),
          ),
        );
    }
  }

  async setOptionPosition(
    db: DbExecutor,
    productId: string,
    optionId: string,
    position: number,
  ): Promise<void> {
    await db
      .update(productOption)
      .set({ position })
      .where(and(eq(productOption.productId, productId), eq(productOption.optionId, optionId)));
  }

  async setValuePosition(
    db: DbExecutor,
    productId: string,
    optionId: string,
    optionValueId: string,
    position: number,
  ): Promise<void> {
    await db
      .update(productOptionValue)
      .set({ position })
      .where(
        and(
          eq(productOptionValue.productId, productId),
          eq(productOptionValue.optionId, optionId),
          eq(productOptionValue.optionValueId, optionValueId),
        ),
      );
  }
}
