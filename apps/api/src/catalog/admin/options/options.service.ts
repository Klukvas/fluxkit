import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  CATALOG_LIMITS,
  TEXT_LIMITS,
  decideDeleteOption,
  decideDeleteOptionValue,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { translatePostgresError } from "../../../common/postgres-errors.js";
import { notFound, validationFailed } from "../../../common/problem.js";
import { withTransaction } from "../../../common/transaction.js";
import { SEARCH_PORT, type SearchPort } from "../../../common/search-port.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { assertAllowed } from "../../shared/rules.js";
import {
  toOptionDetailResponse,
  toOptionResponse,
  toOptionValueResponse,
} from "./options.mapper.js";
import { OptionsRepository } from "./options.repository.js";
import type {
  CreateOptionBody,
  CreateOptionValueBody,
  OptionDetailResponse,
  OptionResponse,
  OptionValueResponse,
  UpdateOptionBody,
  UpdateOptionValueBody,
} from "./options.schemas.js";

@Injectable()
export class OptionsService {
  constructor(
    private readonly options: OptionsRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(SEARCH_PORT) private readonly search: SearchPort,
  ) {}

  async create(body: CreateOptionBody): Promise<OptionResponse> {
    this.assertValidText("name", body.name, TEXT_LIMITS.name);
    try {
      return toOptionResponse(
        await this.options.insert(this.database, { code: body.code, name: body.name }),
      );
    } catch (error) {
      throw translatePostgresError(error, { detail: "Another option already uses this code." });
    }
  }

  async get(id: string): Promise<OptionDetailResponse> {
    const row = await this.options.findById(this.database, id);
    if (row === undefined) {
      throw notFound("Option");
    }
    return toOptionDetailResponse(row, await this.options.listValues(this.database, id));
  }

  async list(page: PaginationQuery): Promise<Page<OptionResponse>> {
    const { rows, total } = await this.options.list(this.database, page);
    return toPage(rows.map(toOptionResponse), total, page);
  }

  async update(id: string, body: UpdateOptionBody): Promise<OptionResponse> {
    if (body.name !== undefined) {
      this.assertValidText("name", body.name, TEXT_LIMITS.name);
    }
    if (body.name === undefined) {
      const current = await this.options.findById(this.database, id);
      if (current === undefined) {
        throw notFound("Option");
      }
      return toOptionResponse(current);
    }
    const row = await this.options.update(this.database, id, { name: body.name });
    if (row === undefined) {
      throw notFound("Option");
    }
    return toOptionResponse(row);
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const current = await this.options.findByIdForUpdate(tx, id);
      if (current === undefined) {
        throw notFound("Option");
      }
      assertAllowed(
        decideDeleteOption({
          assignedToProductTypes: await this.options.isAssignedToProductTypes(tx, id),
          usedByProducts: await this.options.isUsedByProducts(tx, id),
        }),
        "The option is still assigned to product types or used by products.",
      );
      try {
        await this.options.delete(tx, id);
      } catch (error) {
        // product_type_option / product_option RESTRICT: backstop when a reference appears concurrently.
        throw translatePostgresError(error, {
          detail: "The option is still assigned to product types or used by products.",
        });
      }
    });
  }

  async createValue(optionId: string, body: CreateOptionValueBody): Promise<OptionValueResponse> {
    this.assertValidText("label", body.label, TEXT_LIMITS.label);
    return withTransaction(this.database, async (tx) => {
      if ((await this.options.findByIdForUpdate(tx, optionId)) === undefined) {
        throw notFound("Option");
      }
      if ((await this.options.countValues(tx, optionId)) >= CATALOG_LIMITS.maxValuesPerOption) {
        throw validationFailed([
          {
            path: "",
            code: "limit_exceeded",
            message: `At most ${CATALOG_LIMITS.maxValuesPerOption} values per option.`,
          },
        ]);
      }
      try {
        return toOptionValueResponse(
          await this.options.insertValue(tx, {
            optionId,
            code: body.code,
            label: body.label,
            ...(body.position === undefined ? {} : { position: body.position }),
          }),
        );
      } catch (error) {
        throw translatePostgresError(error, {
          detail: "This option already has a value with this code.",
        });
      }
    });
  }

  async updateValue(
    optionId: string,
    valueId: string,
    body: UpdateOptionValueBody,
  ): Promise<OptionValueResponse> {
    if (body.label !== undefined) {
      this.assertValidText("label", body.label, TEXT_LIMITS.label);
    }
    const changes = {
      ...(body.label === undefined ? {} : { label: body.label }),
      ...(body.position === undefined ? {} : { position: body.position }),
    };
    const current = await this.options.findValue(this.database, optionId, valueId);
    if (current === undefined) {
      throw notFound("Option value");
    }
    if (Object.keys(changes).length === 0) {
      return toOptionValueResponse(current);
    }
    return withTransaction(this.database, async (tx) => {
      const row = await this.options.updateValue(tx, valueId, changes);
      if (row === undefined) {
        throw notFound("Option value");
      }
      // The label is an `optionLabels` entry of every variant document that uses the value.
      if (body.label !== undefined) {
        await this.search.productsChangedWhere(
          tx,
          sql`select product_id from variant_option_value where option_value_id = ${valueId}`,
          "option_changed",
        );
      }
      return toOptionValueResponse(row);
    });
  }

  async deleteValue(optionId: string, valueId: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const parent = await this.options.findByIdForUpdate(tx, optionId);
      const value =
        parent === undefined ? undefined : await this.options.findValue(tx, optionId, valueId);
      if (value === undefined) {
        throw notFound("Option value");
      }
      assertAllowed(
        decideDeleteOptionValue({
          usedByProducts: await this.options.isValueUsedByProducts(tx, valueId),
        }),
        "Products still use this option value.",
      );
      try {
        await this.options.deleteValue(tx, valueId);
      } catch (error) {
        // product_option_value (and media) RESTRICT: backstop when a reference appears concurrently.
        throw translatePostgresError(error, { detail: "Products still use this option value." });
      }
    });
  }

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private assertValidText(path: string, value: unknown, maxLength: number): void {
    const errors = i18nFieldErrors(path, value, this.locale, { required: true, maxLength });
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
  }
}
