import { z } from "zod";
import { timestampSchema, uuidSchema } from "../../../common/openapi-formats.js";
import { paginationQuerySchema } from "../../../common/pagination.js";
import { codeSchema, positionSchema, valueCodeSchema } from "../../shared/code-schemas.js";
import { i18nTextSchema } from "../../shared/i18n-validation.js";

// Schemas check structure and static limits. Locale rules run in the service with the core i18n functions.

/** `POST /admin/options`: a variant axis such as color or size. */
export const createOptionSchema = z.strictObject({
  code: codeSchema,
  name: i18nTextSchema,
});

/** `PATCH /admin/options/:id`. `code` is not accepted (400 unknown_field). */
export const updateOptionSchema = z.strictObject({
  name: i18nTextSchema.optional(),
});

export const listOptionsQuerySchema = paginationQuerySchema;

/** `POST /admin/options/:id/values`. */
export const createOptionValueSchema = z.strictObject({
  code: valueCodeSchema,
  label: i18nTextSchema,
  position: positionSchema.optional(),
});

/** `PATCH /admin/options/:id/values/:valueId`. `code` is not accepted. */
export const updateOptionValueSchema = z.strictObject({
  label: i18nTextSchema.optional(),
  position: positionSchema.optional(),
});

export const optionValueResponseSchema = z.object({
  id: uuidSchema,
  optionId: uuidSchema,
  code: z.string(),
  label: i18nTextSchema,
  position: z.number().int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const optionResponseSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: i18nTextSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/** `GET /admin/options/:id`: the option and its values ordered by position, then code. */
export const optionDetailResponseSchema = optionResponseSchema.extend({
  values: z.array(optionValueResponseSchema),
});

export type CreateOptionBody = z.output<typeof createOptionSchema>;
export type UpdateOptionBody = z.output<typeof updateOptionSchema>;
export type CreateOptionValueBody = z.output<typeof createOptionValueSchema>;
export type UpdateOptionValueBody = z.output<typeof updateOptionValueSchema>;
export type OptionResponse = z.output<typeof optionResponseSchema>;
export type OptionDetailResponse = z.output<typeof optionDetailResponseSchema>;
export type OptionValueResponse = z.output<typeof optionValueResponseSchema>;
