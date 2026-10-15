import type { PipeTransform } from "@nestjs/common";
import { z } from "zod";
import { validationFailed, type FieldError } from "./problem.js";

function joinPath(segments: readonly PropertyKey[]): string {
  return segments.map((segment) => String(segment)).join(".");
}

function valueAt(root: unknown, segments: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

/**
 * Converts a zod error into `errors[]` entries. `input` is the original value, used to tell a missing field
 * (`required`) from a field of the wrong type (`invalid_type`), because zod 4 reports both as `invalid_type`.
 * Custom refinements choose their own code with `params: { code }`.
 */
export function zodIssuesToFieldErrors(error: z.ZodError, input: unknown): FieldError[] {
  const errors: FieldError[] = [];
  for (const issue of error.issues) {
    const path = joinPath(issue.path);
    switch (issue.code) {
      case "invalid_type":
        errors.push({
          path,
          code: valueAt(input, issue.path) === undefined ? "required" : "invalid_type",
          message: issue.message,
        });
        break;
      case "unrecognized_keys":
        for (const key of issue.keys) {
          errors.push({ path: joinPath([...issue.path, key]), code: "unknown_field" });
        }
        break;
      case "too_small":
        errors.push({ path, code: "too_small", message: issue.message });
        break;
      case "too_big":
        errors.push({ path, code: "too_big", message: issue.message });
        break;
      case "invalid_format":
        errors.push({ path, code: "invalid_format", message: issue.message });
        break;
      case "invalid_value":
        errors.push({ path, code: "invalid_value", message: issue.message });
        break;
      case "custom": {
        const code: unknown = issue.params?.["code"];
        errors.push({
          path,
          code: typeof code === "string" ? code : "invalid",
          message: issue.message,
        });
        break;
      }
      default:
        errors.push({ path, code: "invalid", message: issue.message });
    }
  }
  return errors;
}

/**
 * Validates a request part (`@Body`, `@Query`, `@Param`) with a zod schema and hands the PARSED value to the
 * handler. A failure becomes `400 validation_failed` with one `errors[]` entry per issue.
 * `pathPrefix` names the parameter when the schema validates a bare value (`@Param("id", ...)`).
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(
    private readonly schema: TSchema,
    private readonly pathPrefix = "",
  ) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    const errors = zodIssuesToFieldErrors(result.error, value).map((entry) => ({
      ...entry,
      path: [this.pathPrefix, entry.path].filter((part) => part !== "").join("."),
    }));
    throw validationFailed(errors);
  }
}

/** Validates a UUID path parameter; the error path is the parameter name. */
export function uuidParam(name: string): ZodValidationPipe<z.ZodGUID> {
  return new ZodValidationPipe(z.guid(), name);
}
