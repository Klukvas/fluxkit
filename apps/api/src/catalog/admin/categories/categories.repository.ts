import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, like, ne, sql } from "drizzle-orm";
import type { CategoryNode } from "@fluxkit/core";
import type { PaginationQuery } from "../../../common/pagination.js";
import type { DbExecutor } from "../../../common/transaction.js";
import { category, productCategory } from "../../../database/schema/index.js";
import { required } from "../../shared/rules.js";

type CategoryRow = typeof category.$inferSelect;
type NewCategory = typeof category.$inferInsert;
type CategoryChanges = Partial<
  Pick<NewCategory, "name" | "description" | "slug" | "isActive" | "parentId" | "position">
>;

/**
 * Advisory lock key for the whole category tree: every write that can change the tree shape (create, move, delete)
 * takes `pg_advisory_xact_lock(CATEGORY_TREE_LOCK_KEY)` first, so the tree it reads is the tree it writes into.
 * One constant for the tree, not per node: a move reads (and so depends on) the whole tree. It is a bigint
 * unique among the advisory keys of this application (the test-only schema lock uses another key). Never reuse it.
 */
export const CATEGORY_TREE_LOCK_KEY = 7_302_150_001;

/** Queries only (Drizzle query builder, parameterized). Business rules live in CategoriesService. */
@Injectable()
export class CategoriesRepository {
  /** Blocks until no other transaction holds the tree lock; released automatically at commit or rollback. */
  async lockTree(db: DbExecutor): Promise<void> {
    await db.execute(sql`select pg_advisory_xact_lock(${CATEGORY_TREE_LOCK_KEY})`);
  }

  async insert(db: DbExecutor, values: NewCategory): Promise<CategoryRow> {
    const [row] = await db.insert(category).values(values).returning();
    return required(row);
  }

  async findById(db: DbExecutor, id: string): Promise<CategoryRow | undefined> {
    const [row] = await db.select().from(category).where(eq(category.id, id));
    return row;
  }

  /** Stable order: position, slug, id. `parentId` narrows the list to the direct children of one category. */
  async list(
    db: DbExecutor,
    page: PaginationQuery,
    parentId: string | undefined,
  ): Promise<{ rows: CategoryRow[]; total: number }> {
    const filter = parentId === undefined ? undefined : eq(category.parentId, parentId);
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(category)
        .where(filter)
        .orderBy(asc(category.position), asc(category.slug), asc(category.id))
        .limit(page.limit)
        .offset(page.offset),
      db.$count(category, filter),
    ]);
    return { rows, total };
  }

  async update(
    db: DbExecutor,
    id: string,
    changes: CategoryChanges,
  ): Promise<CategoryRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await db.update(category).set(changes).where(eq(category.id, id)).returning();
    return row;
  }

  /** Returns false when no such category exists. A referenced category raises a foreign key violation. */
  async delete(db: DbExecutor, id: string): Promise<boolean> {
    const rows = await db
      .delete(category)
      .where(eq(category.id, id))
      .returning({ id: category.id });
    return rows.length > 0;
  }

  /** The whole tree as flat nodes, for the core tree rules. */
  async listNodes(db: DbExecutor): Promise<CategoryNode[]> {
    return db.select({ id: category.id, parentId: category.parentId }).from(category);
  }

  /** Siblings under `parentId` (`null` = root level) except `excludeId`, in display order. */
  async listSiblings(
    db: DbExecutor,
    parentId: string | null,
    excludeId: string | undefined,
  ): Promise<{ id: string; position: number }[]> {
    const sameParent =
      parentId === null ? isNull(category.parentId) : eq(category.parentId, parentId);
    return db
      .select({ id: category.id, position: category.position })
      .from(category)
      .where(excludeId === undefined ? sameParent : and(sameParent, ne(category.id, excludeId)))
      .orderBy(asc(category.position), asc(category.slug), asc(category.id));
  }

  async setPosition(db: DbExecutor, id: string, position: number): Promise<void> {
    await db.update(category).set({ position }).where(eq(category.id, id));
  }

  async hasChildren(db: DbExecutor, id: string): Promise<boolean> {
    const [row] = await db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.parentId, id))
      .limit(1);
    return row !== undefined;
  }

  async hasProducts(db: DbExecutor, id: string): Promise<boolean> {
    const [row] = await db
      .select({ productId: productCategory.productId })
      .from(productCategory)
      .where(eq(productCategory.categoryId, id))
      .limit(1);
    return row !== undefined;
  }

  /** Slugs that start with `prefix`, to let core pick the next free `-2`, `-3` suffix. `prefix` is a slug (a-z, 0-9, `-`). */
  async findSlugsStartingWith(db: DbExecutor, prefix: string): Promise<Set<string>> {
    const rows = await db
      .select({ slug: category.slug })
      .from(category)
      .where(like(category.slug, `${prefix}%`));
    return new Set(rows.map((row) => row.slug));
  }
}
