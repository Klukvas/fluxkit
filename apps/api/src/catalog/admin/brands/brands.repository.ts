import { Inject, Injectable } from "@nestjs/common";
import { asc, eq, like } from "drizzle-orm";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { brand } from "../../../database/schema/index.js";
import type { PaginationQuery } from "../../../common/pagination.js";

type BrandRow = typeof brand.$inferSelect;
type NewBrand = typeof brand.$inferInsert;
type BrandChanges = Partial<Omit<NewBrand, "id" | "createdAt" | "updatedAt">>;

/** Queries only (Drizzle query builder, parameterized). Business rules live in BrandsService. */
@Injectable()
export class BrandsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insert(values: NewBrand): Promise<BrandRow> {
    const [row] = await this.db.insert(brand).values(values).returning();
    return required(row);
  }

  async findById(id: string): Promise<BrandRow | undefined> {
    const [row] = await this.db.select().from(brand).where(eq(brand.id, id));
    return row;
  }

  /** Stable order: slug, then id. */
  async list(page: PaginationQuery): Promise<{ rows: BrandRow[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(brand)
        .orderBy(asc(brand.slug), asc(brand.id))
        .limit(page.limit)
        .offset(page.offset),
      this.db.$count(brand),
    ]);
    return { rows, total };
  }

  async update(id: string, changes: BrandChanges): Promise<BrandRow | undefined> {
    // `updated_at` is refreshed by the column's $onUpdate, which only the query builder applies.
    const [row] = await this.db.update(brand).set(changes).where(eq(brand.id, id)).returning();
    return row;
  }

  /** Returns false when no such brand exists. A referenced brand raises a foreign key violation (mapped to `in_use`). */
  async delete(id: string): Promise<boolean> {
    const rows = await this.db.delete(brand).where(eq(brand.id, id)).returning({ id: brand.id });
    return rows.length > 0;
  }

  /** Slugs that start with `prefix`, to let core pick the next free `-2`, `-3` suffix. `prefix` is a slug (a-z, 0-9, `-`). */
  async findSlugsStartingWith(prefix: string): Promise<Set<string>> {
    const rows = await this.db
      .select({ slug: brand.slug })
      .from(brand)
      .where(like(brand.slug, `${prefix}%`));
    return new Set(rows.map((row) => row.slug));
  }
}

function required<T>(row: T | undefined): T {
  if (row === undefined) {
    throw new Error("The database returned no row for a statement that must return one.");
  }
  return row;
}
