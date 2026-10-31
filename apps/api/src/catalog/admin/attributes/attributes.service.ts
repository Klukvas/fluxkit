import { Inject, Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import {
  CATALOG_LIMITS,
  TEXT_LIMITS,
  attributeChangeAffectsSearchDocuments,
  decideDeleteAttribute,
  decideDeleteAttributeOption,
  decideInputTypeChange,
  decideLocalizationChange,
  decideUnitChange,
  normalizeAttributeDefinitionInput,
  parseAttributeValidation,
  type AttributeDefinitionError,
  type AttributeInputType,
} from "@fluxkit/core";
import { LOCALE_CONFIG, type LocaleConfig } from "../../../common/locale.js";
import { toPage, type Page, type PaginationQuery } from "../../../common/pagination.js";
import { translatePostgresError } from "../../../common/postgres-errors.js";
import {
  notFound,
  ruleViolation,
  validationFailed,
  type FieldError,
} from "../../../common/problem.js";
import { withTransaction } from "../../../common/transaction.js";
import { SEARCH_PORT, type SearchPort } from "../../../common/search-port.js";
import { DRIZZLE, type Database } from "../../../database/database.module.js";
import { attributeHasValues, attributeOptionCodeInUse } from "../../shared/attribute-usage.js";
import { i18nFieldErrors } from "../../shared/i18n-validation.js";
import { assertAllowed } from "../../shared/rules.js";
import { emptyToNull } from "../../shared/text.js";
import {
  toAttributeDetailResponse,
  toAttributeOptionResponse,
  toAttributeResponse,
} from "./attributes.mapper.js";
import { AttributesRepository } from "./attributes.repository.js";
import {
  inputTypeSchema,
  type AttributeDetailResponse,
  type AttributeOptionResponse,
  type AttributeResponse,
  type CreateAttributeBody,
  type CreateAttributeOptionBody,
  type UpdateAttributeBody,
  type UpdateAttributeOptionBody,
} from "./attributes.schemas.js";

const SELECTABLE_TYPES: readonly AttributeInputType[] = ["select", "multiselect"];

/** The products of every product type the attribute is assigned to. */
function productsWithAttribute(attributeId: string): SQL {
  return sql`
    select product.id from product
    join product_type_attribute assignment on assignment.product_type_id = product.product_type_id
    where assignment.attribute_id = ${attributeId}`;
}

@Injectable()
export class AttributesService {
  constructor(
    private readonly attributes: AttributesRepository,
    @Inject(DRIZZLE) private readonly database: Database,
    @Inject(LOCALE_CONFIG) private readonly locale: LocaleConfig,
    @Inject(SEARCH_PORT) private readonly search: SearchPort,
  ) {}

  async create(body: CreateAttributeBody): Promise<AttributeResponse> {
    const definition = normalizeAttributeDefinitionInput({
      inputType: body.inputType,
      isLocalized: body.isLocalized,
      unit: body.unit,
      isFilterable: body.isFilterable,
      isSearchable: body.isSearchable,
      isVisibleOnStorefront: body.isVisibleOnStorefront,
      isComparable: body.isComparable,
      isSortable: body.isSortable,
      isInternal: body.isInternal,
    });
    const validation = body.validation ?? {};
    const errors = [
      ...this.textErrors(body),
      ...(definition.ok ? [] : definitionFieldErrors(definition.errors)),
      ...validationErrors(body.inputType, validation),
    ];
    if (errors.length > 0 || !definition.ok) {
      throw validationFailed(errors);
    }
    try {
      const row = await this.attributes.insert(this.database, {
        code: body.code,
        name: body.name,
        description: emptyToNull(body.description),
        validation,
        ...definition.value,
      });
      return toAttributeResponse(row);
    } catch (error) {
      throw translatePostgresError(error, { detail: "Another attribute already uses this code." });
    }
  }

  async get(id: string): Promise<AttributeDetailResponse> {
    const row = await this.attributes.findById(this.database, id);
    if (row === undefined) {
      throw notFound("Attribute");
    }
    return toAttributeDetailResponse(row, await this.attributes.listOptions(this.database, id));
  }

  async list(page: PaginationQuery): Promise<Page<AttributeResponse>> {
    const { rows, total } = await this.attributes.list(this.database, page);
    return toPage(rows.map(toAttributeResponse), total, page);
  }

  async update(id: string, body: UpdateAttributeBody): Promise<AttributeResponse> {
    const textErrors = this.textErrors(body);
    if (textErrors.length > 0) {
      throw validationFailed(textErrors);
    }
    return withTransaction(this.database, async (tx) => {
      const current = await this.attributes.findByIdForUpdate(tx, id);
      if (current === undefined) {
        throw notFound("Attribute");
      }
      const inputType = inputTypeSchema.parse(current.inputType);
      const isInternal = body.isInternal ?? current.isInternal;
      const next = {
        inputType,
        isLocalized: current.isLocalized,
        unit: body.unit === undefined ? current.unit : body.unit,
        isFilterable: body.isFilterable ?? current.isFilterable,
        isSearchable: body.isSearchable ?? current.isSearchable,
        // Marking an attribute internal without saying more hides it, as on creation.
        isVisibleOnStorefront:
          body.isVisibleOnStorefront ??
          (body.isInternal === true ? false : current.isVisibleOnStorefront),
        isComparable: body.isComparable ?? current.isComparable,
        isSortable: body.isSortable ?? current.isSortable,
        isInternal,
      };
      const definition = normalizeAttributeDefinitionInput(next);
      const errors = [
        ...(definition.ok ? [] : definitionFieldErrors(definition.errors)),
        ...(body.validation === undefined ? [] : validationErrors(inputType, body.validation)),
      ];
      if (errors.length > 0) {
        throw validationFailed(errors);
      }

      // ADR 0006 section 5. The facts are read in this transaction with the attribute row locked.
      if (body.inputType !== undefined) {
        assertAllowed(
          decideInputTypeChange({ current: inputType, next: body.inputType }),
          "The input type of an attribute cannot change; create a new attribute.",
        );
      }
      if (body.isLocalized !== undefined) {
        assertAllowed(
          decideLocalizationChange({ current: current.isLocalized, next: body.isLocalized }),
          "Whether an attribute is localized cannot change; create a new attribute.",
        );
      }
      if (next.unit !== current.unit) {
        assertAllowed(
          decideUnitChange(
            { currentUnit: current.unit, nextUnit: next.unit },
            { valuesExist: await attributeHasValues(tx, current) },
          ),
          "The unit cannot change while products or variants hold values of this attribute.",
        );
      }

      const changes = {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: emptyToNull(body.description) }),
        ...(body.unit === undefined ? {} : { unit: body.unit }),
        ...(body.validation === undefined ? {} : { validation: body.validation }),
        ...(body.isFilterable === undefined ? {} : { isFilterable: body.isFilterable }),
        ...(body.isSearchable === undefined ? {} : { isSearchable: body.isSearchable }),
        ...(body.isComparable === undefined ? {} : { isComparable: body.isComparable }),
        ...(body.isSortable === undefined ? {} : { isSortable: body.isSortable }),
        ...(body.isInternal === undefined ? {} : { isInternal: body.isInternal }),
        ...(body.isVisibleOnStorefront === undefined && body.isInternal !== true
          ? {}
          : { isVisibleOnStorefront: next.isVisibleOnStorefront }),
      };
      const row =
        Object.keys(changes).length === 0
          ? current
          : ((await this.attributes.update(tx, id, changes)) ?? current);
      // Only what documents carry needs the products synced (above the fan-out limit: a full rebuild). `isFilterable`
      // changes the index settings alone, which job 13 applies in place through the settings hash (finding F2);
      // `isComparable`, `isSortable`, the texts and the validation reach no document and no setting.
      if (attributeChangeAffectsSearchDocuments(current, row)) {
        await this.search.productsChangedWhere(tx, productsWithAttribute(id), "attribute_changed");
      }
      return toAttributeResponse(row);
    });
  }

  async delete(id: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const current = await this.attributes.findByIdForUpdate(tx, id);
      if (current === undefined) {
        throw notFound("Attribute");
      }
      assertAllowed(
        decideDeleteAttribute({
          assignedToProductTypes: await this.attributes.isAssignedToProductTypes(tx, id),
        }),
        "The attribute is still assigned to product types.",
      );
      try {
        await this.attributes.delete(tx, id);
      } catch (error) {
        // product_type_attribute.attribute_id is RESTRICT: backstop when an assignment appears concurrently.
        throw translatePostgresError(error, {
          detail: "The attribute is still assigned to product types.",
        });
      }
    });
  }

  async createOption(
    attributeId: string,
    body: CreateAttributeOptionBody,
  ): Promise<AttributeOptionResponse> {
    const errors = i18nFieldErrors("label", body.label, this.locale, {
      required: true,
      maxLength: TEXT_LIMITS.label,
    });
    if (errors.length > 0) {
      throw validationFailed(errors);
    }
    return withTransaction(this.database, async (tx) => {
      const parent = await this.attributes.findByIdForUpdate(tx, attributeId);
      if (parent === undefined) {
        throw notFound("Attribute");
      }
      if (!SELECTABLE_TYPES.includes(inputTypeSchema.parse(parent.inputType))) {
        throw ruleViolation(
          "Only select and multiselect attributes have options.",
          "attribute_options_require_selectable_type",
        );
      }
      if (
        (await this.attributes.countOptions(tx, attributeId)) >=
        CATALOG_LIMITS.maxOptionsPerAttribute
      ) {
        throw validationFailed([
          {
            path: "",
            code: "limit_exceeded",
            message: `At most ${CATALOG_LIMITS.maxOptionsPerAttribute} options per attribute.`,
          },
        ]);
      }
      try {
        return toAttributeOptionResponse(
          await this.attributes.insertOption(tx, {
            attributeId,
            code: body.code,
            label: body.label,
            ...(body.position === undefined ? {} : { position: body.position }),
          }),
        );
      } catch (error) {
        throw translatePostgresError(error, {
          detail: "This attribute already has an option with this code.",
        });
      }
    });
  }

  async updateOption(
    attributeId: string,
    optionId: string,
    body: UpdateAttributeOptionBody,
  ): Promise<AttributeOptionResponse> {
    if (body.label !== undefined) {
      const errors = i18nFieldErrors("label", body.label, this.locale, {
        required: true,
        maxLength: TEXT_LIMITS.label,
      });
      if (errors.length > 0) {
        throw validationFailed(errors);
      }
    }
    const changes = {
      ...(body.label === undefined ? {} : { label: body.label }),
      ...(body.position === undefined ? {} : { position: body.position }),
    };
    const current = await this.attributes.findOption(this.database, attributeId, optionId);
    if (current === undefined) {
      throw notFound("Attribute option");
    }
    if (Object.keys(changes).length === 0) {
      return toAttributeOptionResponse(current);
    }
    return withTransaction(this.database, async (tx) => {
      const row = await this.attributes.updateOption(tx, optionId, changes);
      if (row === undefined) {
        throw notFound("Attribute option");
      }
      // A select label is searchable text of the products that hold the code.
      if (body.label !== undefined) {
        await this.search.productsChangedWhere(
          tx,
          productsWithAttribute(attributeId),
          "attribute_changed",
        );
      }
      return toAttributeOptionResponse(row);
    });
  }

  async deleteOption(attributeId: string, optionId: string): Promise<void> {
    await withTransaction(this.database, async (tx) => {
      const parent = await this.attributes.findByIdForUpdate(tx, attributeId);
      const option =
        parent === undefined
          ? undefined
          : await this.attributes.findOption(tx, attributeId, optionId);
      if (parent === undefined || option === undefined) {
        throw notFound("Attribute option");
      }
      assertAllowed(
        decideDeleteAttributeOption({
          valuesUseCode: await attributeOptionCodeInUse(tx, parent, option.code),
        }),
        "Products or variants still use this option code.",
      );
      await this.attributes.deleteOption(tx, optionId);
    });
  }

  /** Locale rules depend on configuration, so they run here with the core i18n validation. */
  private textErrors(body: { name?: unknown; description?: unknown }): FieldError[] {
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
    return errors;
  }
}

/** Core checks the combinations the database CHECK constraints forbid; one entry per core error. */
function definitionFieldErrors(errors: readonly AttributeDefinitionError[]): FieldError[] {
  return errors.map((error) => ({ path: error.field, code: error.reason }));
}

function validationErrors(inputType: AttributeInputType, validation: unknown): FieldError[] {
  const result = parseAttributeValidation(inputType, validation);
  if (result.ok) {
    return [];
  }
  return result.issues.map((issue) => ({
    path: issue.key === "" ? "validation" : `validation.${issue.key}`,
    code: issue.reason,
  }));
}
