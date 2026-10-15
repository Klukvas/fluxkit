import { applyDecorators } from "@nestjs/common";
import {
  ApiBody,
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  getSchemaPath,
  type ApiResponseOptions,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { z } from "zod";
import { PROBLEM_CODES, PROBLEM_TITLE, type ProblemCode } from "./problem.js";

type JsonSchemaIo = "input" | "output";
/** A schema object or reference of the OpenAPI document (the swagger package does not export the type by name). */
type SchemaObject = NonNullable<NonNullable<OpenAPIObject["components"]>["schemas"]>[string];

/**
 * The OpenAPI 3.0 JSON schema of a zod schema, so the validation schema and the documentation cannot drift apart.
 * `input` describes what a client sends (defaults optional); `output` what the API returns.
 */
export function zodToOpenApiSchema(schema: z.ZodType, io: JsonSchemaIo): SchemaObject {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io,
    unrepresentable: "any",
    reused: "inline",
  });
  // zod's JSON schema type is a structural superset of the OpenAPI 3.0 schema object. The openapi-3.0 target
  // emits no `$schema` member (asserted in openapi.spec.ts through the committed document).
  return jsonSchema as SchemaObject;
}

/** Documents the request body of a route with the same zod schema the route validates with. */
export function ApiZodBody(schema: z.ZodType): MethodDecorator {
  return ApiBody({ required: true, schema: zodToOpenApiSchema(schema, "input") });
}

/** Documents a JSON response whose shape is a zod schema. */
export function ApiZodResponse(
  status: number,
  schema: z.ZodType,
  description: string,
): MethodDecorator & ClassDecorator {
  return ApiResponse({
    status,
    description,
    content: { "application/json": { schema: zodToOpenApiSchema(schema, "output") } },
  });
}

/** Documents `?limit` and `?offset` of a list route. */
export function ApiPaginationQuery(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiQuery({
      name: "limit",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    }),
    ApiQuery({
      name: "offset",
      required: false,
      schema: { type: "integer", minimum: 0, maximum: 10000, default: 0 },
    }),
  );
}

export class FieldErrorDoc {
  @ApiProperty({ example: "name.uk" })
  path!: string;
  @ApiProperty({ example: "required" })
  code!: string;
  @ApiPropertyOptional()
  message?: string;
}

/** Documentation-only model of the `application/problem+json` body (the real body is built by the problem filter). */
export class ProblemDetailsDoc {
  @ApiProperty({ example: "about:blank" })
  type!: string;
  @ApiProperty()
  title!: string;
  @ApiProperty()
  status!: number;
  @ApiProperty({ enum: PROBLEM_CODES })
  code!: ProblemCode;
  @ApiProperty()
  detail!: string;
  @ApiPropertyOptional({ type: () => [FieldErrorDoc] })
  errors?: FieldErrorDoc[];
  @ApiPropertyOptional({ description: "Request field that caused a conflict, when known." })
  field?: string;
  @ApiPropertyOptional({ description: "Database constraint name of a conflict or in-use problem." })
  constraint?: string;
  @ApiPropertyOptional({ description: "Core rule code of a rule_violation or invalid_transition." })
  rule?: string;
}

const PROBLEM_DESCRIPTION: Readonly<Record<number, string>> = {
  400: `${PROBLEM_TITLE.validation_failed}: malformed request or invalid fields (see errors).`,
  401: `${PROBLEM_TITLE.unauthorized}.`,
  403: "Forbidden: the role lacks the route's permission, or the X-Fluxkit-CSRF header or JSON content type is missing on a state-changing request.",
  404: `${PROBLEM_TITLE.not_found}.`,
  409: "Conflict: unique value taken, record in use, or a rule/transition is violated (see code).",
  429: `${PROBLEM_TITLE.too_many_requests}: try again after the number of seconds in the Retry-After header.`,
  500: `${PROBLEM_TITLE.internal_error}. Details are only in the server log.`,
};

/** Adds `application/problem+json` responses for the given statuses to a route or controller. */
export function ApiProblemResponses(
  ...statuses: (400 | 401 | 403 | 404 | 409 | 429 | 500)[]
): MethodDecorator & ClassDecorator {
  const options = (status: number): ApiResponseOptions => ({
    status,
    description: PROBLEM_DESCRIPTION[status] ?? "Problem.",
    content: { "application/problem+json": { schema: { $ref: getSchemaPath(ProblemDetailsDoc) } } },
  });
  return applyDecorators(
    ApiExtraModels(ProblemDetailsDoc, FieldErrorDoc),
    ...statuses.map((status) => ApiResponse(options(status))),
  );
}
