import { Inject, Injectable } from "@nestjs/common";
import {
  generateUniqueSlug,
  slugLookupPrefix,
  TEXT_LIMITS,
  validateMove,
  validateNewNode,
  type CategoryMoveResult,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page } from "../../../common/pagination.js";
import { isUniqueViolation, translatePostgresError } from "../../../common/postgres-errors.js";
import {
  conflict,
  inUse,
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { retryLostRaces, type ProposalLog } from "../../shared/retry.js";
import { toCategoryResponse } from "./categories.mapper.js";
import { CategoriesRepository } from "./categories.repository.js";
import type {
  CategoryResponse,
  CreateCategoryBody,
  ListCategoriesQuery,
  MoveCategoryBody,
  UpdateCategoryBody,
} from "./categories.schemas.js";

const CATEGORY_SLUG_CONSTRAINT = "category_slug_key";
// A generated slug can lose a race against a concurrent insert or slug edit (neither takes the tree lock for the
// slug). Every lost round means another request won, so the bound only has to stop a pathological loop.
const MAX_SLUG_ATTEMPTS = 5;

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categories: CategoriesRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async create(body: CreateCategoryBody): Promise<CategoryResponse> {
    this.assertValidTexts(body);
    if (body.slug !== undefined) {
      const slug = body.slug;
      try {
        return await withTransaction(this.database, (tx) => this.createIn(tx, body, slug));
      } catch (error) {
        throw translatePostgresError(error, { detail: "Another category already uses this slug." });
      }
    }
    try {
      return await retryLostRaces(
        {
          maxAttempts: MAX_SLUG_ATTEMPTS,
          isLostRace: (error) => isUniqueViolation(error, CATEGORY_SLUG_CONSTRAINT),
          exhausted: () =>
            conflict("Could not allocate a unique slug; try again or provide one.", {
              field: "slug",
              constraint: CATEGORY_SLUG_CONSTRAINT,
            }),
        },
        // The slug candidate is computed inside the transaction; a unique violation aborts it, so the retry
        // starts a new transaction and reads the taken slugs again.
        (log) => withTransaction(this.database, (tx) => this.createIn(tx, body, undefined, log)),
      );
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  async get(id: string): Promise<CategoryResponse> {
    const row = await this.categories.findById(this.database, id);
    if (row === undefined) {
      throw notFound("Category");
    }
    return toCategoryResponse(row);
  }

  async list(query: ListCategoriesQuery): Promise<Page<CategoryResponse>> {
    const { rows, total } = await this.categories.list(this.database, query, query.parentId);
    return toPage(rows.map(toCategoryResponse), total, query);
  }

  async update(id: string, body: UpdateCategoryBody): Promise<CategoryResponse> {
    this.assertValidTexts(body);
    const changes = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: emptyToNull(body.description) }),
      ...(body.slug === undefined ? {} : { slug: body.slug }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    };
    if (Object.keys(changes).length === 0) {
      return this.get(id);
    }
    try {
      const row = await this.categories.update(this.database, id, changes);
      if (row === undefined) {
        throw notFound("Category");
      }
      return toCategoryResponse(row);
    } catch (error) {
      throw translatePostgresError(error, { detail: "Another category already uses this slug." });
    }
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      await this.categories.lockTree(tx);
      if ((await this.categories.findById(tx, id)) === undefined) {
        throw notFound("Category");
      }
      if (await this.categories.hasChildren(tx, id)) {
        throw inUse("The category has child categories; move or delete them first.", {
          constraint: "category_parent_id_fkey",
        });
      }
      if (await this.categories.hasProducts(tx, id)) {
        throw inUse("Products are assigned to this category; remove the assignments first.", {
          constraint: "product_category_category_id_fkey",
        });
      }
      try {
        await this.categories.delete(tx, id);
      } catch (error) {
        // Backstop: the foreign keys are RESTRICT, e.g. a product assigned through a path that skips the tree lock.
        throw translatePostgresError(error, { detail: "The category is still in use." });
      }
    });
  }

  async move(id: string, body: MoveCategoryBody): Promise<CategoryResponse> {
    return withTransaction(this.database, async (tx) => {
      await this.categories.lockTree(tx);
      // The tree is read after the lock: it cannot change until this transaction ends.
      const nodes = await this.categories.listNodes(tx);
      this.assertTreeAllows(validateMove(nodes, id, body.parentId));
      const siblings = await this.categories.listSiblings(tx, body.parentId, id);
      const index = clampIndex(body.position, siblings.length);
      const moved = await this.categories.update(tx, id, {
        parentId: body.parentId,
        position: index,
      });
      if (moved === undefined) {
        throw notFound("Category");
      }
      await this.renumberSiblings(tx, siblings, index);
      return toCategoryResponse(moved);
    });
  }

  private async createIn(
    tx: DbExecutor,
    body: CreateCategoryBody,
    explicitSlug: string | undefined,
    log?: ProposalLog,
  ): Promise<CategoryResponse> {
    const parentId = body.parentId ?? null;
    await this.categories.lockTree(tx);
    this.assertTreeAllows(validateNewNode(await this.categories.listNodes(tx), parentId));
    const slug = explicitSlug ?? (await this.generateSlug(tx, body.name));
    log?.record(slug);
    const siblings = await this.categories.listSiblings(tx, parentId, undefined);
    const index = clampIndex(body.position, siblings.length);
    const row = await this.categories.insert(tx, {
      parentId,
      slug,
      name: body.name,
      description: emptyToNull(body.description),
      position: index,
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
    });
    await this.renumberSiblings(tx, siblings, index);
    return toCategoryResponse(row);
  }

  private async generateSlug(tx: DbExecutor, name: Record<string, string>): Promise<string> {
    const title = name[this.locale.defaultLocale] ?? "";
    const prefix = slugLookupPrefix(title);
    const generated = generateUniqueSlug(
      title,
      prefix === "" ? new Set() : await this.categories.findSlugsStartingWith(tx, prefix),
    );
    if (!generated.ok) {
      throw validationFailed([
        {
          path: "slug",
          code: generated.reason,
          message: "A slug cannot be generated from this name; provide one.",
        },
      ]);
    }
    return generated.slug;
  }

  /**
   * The siblings (without the placed node) keep their order; those at or after `index` shift by one to make room.
   * Positions end up as 0..n-1 without gaps, so a position in a request is always an index.
   */
  private async renumberSiblings(
    tx: DbExecutor,
    siblings: readonly { id: string; position: number }[],
    index: number,
  ): Promise<void> {
    for (const [order, sibling] of siblings.entries()) {
      const position = order < index ? order : order + 1;
      if (sibling.position !== position) {
        await this.categories.setPosition(tx, sibling.id, position);
      }
    }
  }

  /** Maps a rejected core tree decision: unknown node 404, unknown parent 400, tree rules 409 `rule_violation`. */
  private assertTreeAllows(result: CategoryMoveResult): void {
    if (result.ok) {
      return;
    }
    const [first] = result.errors;
    switch (first?.reason) {
      case "node_not_found":
        throw notFound("Category");
      case "parent_not_found":
        throw validationFailed(
          [
            {
              path: "parentId",
              code: "invalid_reference",
              message: "The parent category does not exist.",
            },
          ],
          "The parent category does not exist.",
        );
      case "moved_under_itself":
        throw ruleViolation("A category cannot be moved under itself.", first.reason);
      case "would_create_cycle":
        throw ruleViolation(
          "A category cannot be moved under one of its descendants.",
          first.reason,
        );
      case "max_depth_exceeded":
        throw ruleViolation(
          `The category tree would be deeper than ${first.limit ?? "the"} levels.`,
          first.reason,
        );
      default:
        // A stored tree with a loop or a dangling parent cannot happen through this API; fail loudly, do not guess.
        throw new Error(`The category tree is corrupted: ${first?.reason ?? "unknown"}.`);
    }
  }

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private assertValidTexts(body: { name?: unknown; description?: unknown }): void {
    const errors: FieldError[] = [];
    if (body.name !== undefined) {
      errors.push(
        ...i18nFieldErrors("name", body.name, this.locale, {
          required: true,
          maxLength: TEXT_LIMITS.name,
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

/** Index among `count` siblings: omitted means last, too large means last. */
function clampIndex(position: number | undefined, count: number): number {
  return position === undefined ? count : Math.min(position, count);
}

/** An empty text map carries no information: store it as "no description". */
function emptyToNull(
  text: Record<string, string> | null | undefined,
): Record<string, string> | null {
  return text === undefined || text === null || Object.keys(text).length === 0 ? null : text;
}
