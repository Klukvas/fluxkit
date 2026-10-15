import {
  CODE_PATTERN,
  TEXT_LIMITS,
  VALUE_CODE_PATTERN,
  isValidCode,
  isValidValueCode,
} from "@fluxkit/core";
import { z } from "zod";

// Refinements are invisible in the JSON schema, so the documented constraints are repeated as metadata.

/** Code of an attribute, option or product type (`^[a-z][a-z0-9_]{0,63}$`). Immutable after creation. */
export const codeSchema = z
  .string()
  .meta({ pattern: CODE_PATTERN.source, maxLength: TEXT_LIMITS.code })
  .superRefine((code, context) => {
    if (!isValidCode(code)) {
      context.addIssue({
        code: "custom",
        message: "Must start with a lowercase letter and use only a-z, 0-9 and _ (at most 64).",
        params: { code: "invalid_code" },
      });
    }
  });

/** Code of an attribute option or option value; may also start with a digit (`42`, `2xl`). */
export const valueCodeSchema = z
  .string()
  .meta({ pattern: VALUE_CODE_PATTERN.source, maxLength: TEXT_LIMITS.code })
  .superRefine((code, context) => {
    if (!isValidValueCode(code)) {
      context.addIssue({
        code: "custom",
        message: "Must use only a-z, 0-9 and _ (at most 64).",
        params: { code: "invalid_code" },
      });
    }
  });

/** Display order inside a parent. Bounded so that it always fits the integer column. */
export const positionSchema = z.number().int().min(0).max(1_000_000);
