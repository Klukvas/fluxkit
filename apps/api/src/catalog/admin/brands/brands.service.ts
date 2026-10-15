import { Inject, Injectable } from "@nestjs/common";
import { generateUniqueSlug, slugLookupPrefix, TEXT_LIMITS } from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { isUniqueViolation, translatePostgresError } from "../../../common/postgres-errors.js";
import { conflict, notFound, validationFailed, type FieldError } from "../../../common/problem.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { retryLostRaces } from "../../shared/retry.js";
import { toBrandResponse } from "./brands.mapper.js";
import { BrandsRepository } from "./brands.repository.js";
import type { BrandResponse, CreateBrandBody, UpdateBrandBody } from "./brands.schemas.js";

const BRAND_SLUG_CONSTRAINT = "brand_slug_key";
// A generated slug can lose a race against a concurrent insert. Every lost round means another request won, so N concurrent
// creates need at most N attempts; the bound only has to stop a pathological loop.
const MAX_SLUG_ATTEMPTS = 5;

@Injectable()
export class BrandsService {
  constructor(
    private readonly brands: BrandsRepository,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
  ) {}

  async create(body: CreateBrandBody): Promise<BrandResponse> {
    this.assertValidTexts(body);
    const values = {
      name: body.name,
      description: emptyToNull(body.description),
      logoUrl: body.logoUrl ?? null,
    };
    if (body.slug !== undefined) {
      return this.insert({ ...values, slug: body.slug });
    }
    return this.insertWithGeneratedSlug(values, body.name);
  }

  async get(id: string): Promise<BrandResponse> {
    const row = await this.brands.findById(id);
    if (row === undefined) {
      throw notFound("Brand");
    }
    return toBrandResponse(row);
  }

  async list(page: PaginationQuery): Promise<Page<BrandResponse>> {
    const { rows, total } = await this.brands.list(page);
    return toPage(rows.map(toBrandResponse), total, page);
  }

  async update(id: string, body: UpdateBrandBody): Promise<BrandResponse> {
    this.assertValidTexts(body);
    const changes = {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: emptyToNull(body.description) }),
      ...(body.logoUrl === undefined ? {} : { logoUrl: body.logoUrl }),
      ...(body.slug === undefined ? {} : { slug: body.slug }),
    };
    if (Object.keys(changes).length === 0) {
      return this.get(id);
    }
    try {
      const row = await this.brands.update(id, changes);
      if (row === undefined) {
        throw notFound("Brand");
      }
      return toBrandResponse(row);
    } catch (error) {
      throw translatePostgresError(error, { detail: "Another brand already uses this slug." });
    }
  }

  async delete(id: string): Promise<void> {
    let deleted: boolean;
    try {
      deleted = await this.brands.delete(id);
    } catch (error) {
      // The product.brand_id foreign key is RESTRICT: the mapper answers 409 in_use by constraint name.
      throw translatePostgresError(error, { detail: "The brand is still used by products." });
    }
    if (!deleted) {
      throw notFound("Brand");
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

  private async insert(values: Parameters<BrandsRepository["insert"]>[0]): Promise<BrandResponse> {
    try {
      return toBrandResponse(await this.brands.insert(values));
    } catch (error) {
      throw translatePostgresError(error, { detail: "Another brand already uses this slug." });
    }
  }

  /**
   * Core proposes a slug from the default-locale name given the taken ones; the insert decides. On a unique
   * violation (a concurrent insert took the candidate) the taken set is read again and core proposes the next one.
   */
  private async insertWithGeneratedSlug(
    values: Omit<Parameters<BrandsRepository["insert"]>[0], "slug">,
    name: Record<string, string>,
  ): Promise<BrandResponse> {
    const title = name[this.locale.defaultLocale] ?? "";
    const prefix = slugLookupPrefix(title);
    try {
      return await retryLostRaces(
        {
          maxAttempts: MAX_SLUG_ATTEMPTS,
          isLostRace: (error) => isUniqueViolation(error, BRAND_SLUG_CONSTRAINT),
          exhausted: () =>
            conflict("Could not allocate a unique slug; try again or provide one.", {
              field: "slug",
              constraint: BRAND_SLUG_CONSTRAINT,
            }),
        },
        async (log) => {
          const generated = generateUniqueSlug(
            title,
            prefix === "" ? new Set() : await this.brands.findSlugsStartingWith(prefix),
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
          log.record(generated.slug);
          return toBrandResponse(await this.brands.insert({ ...values, slug: generated.slug }));
        },
      );
    } catch (error) {
      throw translatePostgresError(error);
    }
  }
}

/** An empty text map carries no information: store it as "no description". */
function emptyToNull(
  text: Record<string, string> | null | undefined,
): Record<string, string> | null {
  return text === undefined || text === null || Object.keys(text).length === 0 ? null : text;
}
