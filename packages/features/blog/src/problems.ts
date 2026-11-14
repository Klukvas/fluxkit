import { ProblemException, type FieldError } from "@fluxkit/api-kit";
import type { z } from "zod";

/*
 * The API problems the blog raises, through the kit's `ProblemException` (ADR 0049): the API's problem filter turns them
 * into `application/problem+json` with `code`, `errors[]` and the extension members. Field paths are dotted
 * (`body.uk`); details never carry internals.
 */

export function validationFailed(errors: readonly FieldError[]): ProblemException {
  return new ProblemException({
    code: "validation_failed",
    detail: "The request is not valid. See errors for the fields to fix.",
    errors,
  });
}

/** One body for every missing post (unknown, draft, scheduled, unreadable), so a caller learns nothing from it. */
export function postNotFound(): ProblemException {
  return new ProblemException({ code: "not_found", detail: "Blog post was not found." });
}

export function slugTaken(): ProblemException {
  return new ProblemException({
    code: "conflict",
    detail: "Another blog post already uses this slug.",
    extensions: { field: "slug", constraint: BLOG_POST_SLUG_CONSTRAINT },
  });
}

export function ruleViolation(
  rule: "slug_locked" | "translation_incomplete",
  detail: string,
  errors?: readonly FieldError[],
): ProblemException {
  return new ProblemException({
    code: "rule_violation",
    detail,
    extensions: { rule },
    ...(errors === undefined ? {} : { errors }),
  });
}

export const BLOG_POST_SLUG_CONSTRAINT = "blog_post_slug_key";

function joinPath(segments: readonly PropertyKey[]): string {
  return segments.map((segment) => String(segment)).join(".");
}

function valueAt(root: unknown, segments: readonly PropertyKey[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<PropertyKey, unknown>)[segment];
  }
  return current;
}

/**
 * Zod issues as `errors[]` entries, with the codes the API's own request validation uses (`required`, `invalid_type`,
 * `unknown_field`, `too_small`, `too_big`, `invalid_format`, `invalid_value`), so a client reads feature and core errors
 * the same way. `input` tells a missing field from one of the wrong type.
 */
export function zodFieldErrors(error: z.ZodError, input: unknown, prefix = ""): FieldError[] {
  const withPrefix = (path: string): string =>
    [prefix, path].filter((part) => part !== "").join(".");
  return error.issues.flatMap((issue): FieldError[] => {
    const path = withPrefix(joinPath(issue.path));
    switch (issue.code) {
      case "invalid_type":
        return [
          {
            path,
            code: valueAt(input, issue.path) === undefined ? "required" : "invalid_type",
            message: issue.message,
          },
        ];
      case "unrecognized_keys":
        return issue.keys.map((key) => ({
          path: withPrefix(joinPath([...issue.path, key])),
          code: "unknown_field",
        }));
      case "too_small":
      case "too_big":
      case "invalid_format":
      case "invalid_value":
        return [{ path, code: issue.code, message: issue.message }];
      default:
        return [{ path, code: "invalid", message: issue.message }];
    }
  });
}

/** Parses a request part with `schema`, or throws `400 validation_failed` with one error per issue. */
export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  prefix = "",
): z.output<TSchema> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw validationFailed(zodFieldErrors(result.error, input, prefix));
  }
  return result.data;
}

/** True when `error` (or one of its causes, as Drizzle wraps driver errors) is a Postgres unique violation of `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const candidate = current as Error & { code?: unknown; constraint?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
  }
  return false;
}
