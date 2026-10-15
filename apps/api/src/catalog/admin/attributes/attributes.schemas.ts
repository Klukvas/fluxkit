import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { codeSchema, positionSchema, valueCodeSchema } from "../../shared/code-schemas.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";
import { isDatabaseSafeText, UNSAFE_TEXT_MESSAGE } from "../../shared/text.js";

// Schemas check structure and static limits. Rules that depend on configuration (locales) or on other rows run
// in the service with the core functions; see AttributesService.

export const ATTRIBUTE_INPUT_TYPES = [
  "text",
  "number",
  "boolean",
  "select",
  "multiselect",
  "date",
] as const;

export const inputTypeSchema = z.enum(ATTRIBUTE_INPUT_TYPES);

const unitSchema = z.string().refine(isDatabaseSafeText, { error: UNSAFE_TEXT_MESSAGE });

const validationSchema = z.record(z.string(), z.unknown()).meta({
  description:
    "Validation keys of the input type (ADR 0006 section 4), e.g. `min_length` for text, `min`/`max` for number. Unknown keys are rejected.",
});

const flagsShape = {
  isFilterable: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  isVisibleOnStorefront: z.boolean().optional(),
  isComparable: z.boolean().optional(),
  isSortable: z.boolean().optional(),
  isInternal: z.boolean().optional(),
};

/**
 * `POST /admin/attributes`. Defaults come from core (`normalizeAttributeDefinitionInput`): `isLocalized` is true
 * for text only, `isVisibleOnStorefront` is `!isInternal`, the other flags are false.
 */
export const createAttributeSchema = z.strictObject({
  code: codeSchema,
  name: i18nTextSchema,
  description: i18nTextSchema.optional(),
  inputType: inputTypeSchema,
  isLocalized: z.boolean().optional(),
  unit: unitSchema.nullable().optional(),
  validation: validationSchema.optional(),
  ...flagsShape,
});

/**
 * `PATCH /admin/attributes/:id`. `code` is not accepted (400 unknown_field). `inputType` and `isLocalized` are
 * accepted only to answer 409 `input_type_immutable` / `is_localized_immutable` when they differ from the stored value.
 */
export const updateAttributeSchema = z.strictObject({
  name: i18nTextSchema.optional(),
  description: i18nTextSchema.nullable().optional(),
  inputType: inputTypeSchema.optional(),
  isLocalized: z.boolean().optional(),
  unit: unitSchema.nullable().optional(),
  validation: validationSchema.optional(),
  ...flagsShape,
});

export const listAttributesQuerySchema = paginationQuerySchema;

/** `POST /admin/attributes/:id/options`. */
export const createAttributeOptionSchema = z.strictObject({
  code: valueCodeSchema,
  label: i18nTextSchema,
  position: positionSchema.optional(),
});

/** `PATCH /admin/attributes/:id/options/:optionId`. `code` is not accepted. */
export const updateAttributeOptionSchema = z.strictObject({
  label: i18nTextSchema.optional(),
  position: positionSchema.optional(),
});

export const attributeOptionResponseSchema = z.object({
  id: uuidSchema,
  attributeId: uuidSchema,
  code: z.string(),
  label: i18nTextSchema,
  position: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const attributeResponseSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: i18nTextSchema,
  description: i18nTextSchema.nullable(),
  inputType: inputTypeSchema,
  isLocalized: z.boolean(),
  unit: z.string().nullable(),
  validation: validationSchema,
  isFilterable: z.boolean(),
  isSearchable: z.boolean(),
  isVisibleOnStorefront: z.boolean(),
  isComparable: z.boolean(),
  isSortable: z.boolean(),
  isInternal: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** `GET /admin/attributes/:id`: the attribute and its options ordered by position, then code. */
export const attributeDetailResponseSchema = attributeResponseSchema.extend({
  options: z.array(attributeOptionResponseSchema),
});

export type CreateAttributeBody = z.output<typeof createAttributeSchema>;
export type UpdateAttributeBody = z.output<typeof updateAttributeSchema>;
export type CreateAttributeOptionBody = z.output<typeof createAttributeOptionSchema>;
export type UpdateAttributeOptionBody = z.output<typeof updateAttributeOptionSchema>;
export type AttributeResponse = z.output<typeof attributeResponseSchema>;
export type AttributeDetailResponse = z.output<typeof attributeDetailResponseSchema>;
export type AttributeOptionResponse = z.output<typeof attributeOptionResponseSchema>;
