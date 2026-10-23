import { Inject, Injectable } from "@nestjs/common";
import { generateUniqueSlug, slugLookupPrefix, TEXT_LIMITS } from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { isUniqueViolation, translatePostgresError } from "../../../common/postgres-errors.js";
import { conflict, notFound, validationFailed, type FieldError } from "../../../common/problem.js";
import { withTransaction, type DbExecutor } from "../../../common/transaction.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { MediaAttachService } from "../../../media/media-attach.service.js";
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
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(MediaAttachService) private readonly mediaAttachments: MediaAttachService,
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
      return await withTransaction(this.database, async (tx) => {
        const row = await this.brands.update(id, changes, tx);
        if (row === undefined) {
          throw notFound("Brand");
        }
        await this.markLogoAttached(tx, body.logoUrl);
        return toBrandResponse(row);
      });
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

  /**
   * ADR 0028: a logo URL under `MEDIA_PUBLIC_BASE_URL` must name an upload (`400 upload_not_found` at `logoUrl`); the
   * upload is marked attached in the save's transaction. Other URLs and `null` are not looked at.
   */
  private async markLogoAttached(
    tx: DbExecutor,
    logoUrl: string | null | undefined,
  ): Promise<void> {
    if (typeof logoUrl === "string") {
      await this.mediaAttachments.markAttached(tx, [{ path: "logoUrl", url: logoUrl }]);
    }
  }

  /** Inserts the brand and marks its uploaded logo attached, in one transaction. */
  private insertWithLogo(
    values: Parameters<BrandsRepository["insert"]>[0],
  ): Promise<ReturnType<typeof toBrandResponse>> {
    return withTransaction(this.database, async (tx) => {
      await this.markLogoAttached(tx, values.logoUrl);
      return toBrandResponse(await this.brands.insert(values, tx));
    });
  }

  private async insert(values: Parameters<BrandsRepository["insert"]>[0]): Promise<BrandResponse> {
    try {
      return await this.insertWithLogo(values);
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
          return this.insertWithLogo({ ...values, slug: generated.slug });
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
