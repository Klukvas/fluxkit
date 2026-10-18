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
import { cartSchema, type CartResponse } from "../cart/cart.schemas.js";
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
  // Placeholder: `documentStoreContract` replaces it with the full cart schema (a decorator cannot carry `required`).
  @ApiPropertyOptional({
    description: "Only on `cart_changed`: the fresh cart, exactly as `GET /store/cart` returns it.",
    type: "object",
    properties: {},
  })
  cart?: CartResponse;
}

const PROBLEM_DESCRIPTION: Readonly<Record<number, string>> = {
  400: `${PROBLEM_TITLE.validation_failed}: malformed request or invalid fields (see errors).`,
  401: `${PROBLEM_TITLE.unauthorized}.`,
  403: "Forbidden: the role lacks the route's permission, or the X-Fluxkit-CSRF header or JSON content type is missing on a state-changing request.",
  404: `${PROBLEM_TITLE.not_found}.`,
  409: "Conflict: unique value taken, record in use, or a rule/transition is violated (see code).",
  429: `${PROBLEM_TITLE.too_many_requests}: try again after the number of seconds in the Retry-After header.`,
  500: `${PROBLEM_TITLE.internal_error}. Details are only in the server log.`,
  503: `${PROBLEM_TITLE.service_unavailable}: a transient failure, try again after the number of seconds in the Retry-After header.`,
};

/** Adds `application/problem+json` responses for the given statuses to a route or controller. */
export function ApiProblemResponses(
  ...statuses: (400 | 401 | 403 | 404 | 409 | 429 | 500 | 503)[]
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

/** Where the store CSRF guard (`StoreCsrfGuard`, registered globally) applies: every state-changing method. */
const STORE_WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

/**
 * Documents the global store CSRF guard on every state-changing `/store` operation: the required `X-Fluxkit-CSRF: 1`
 * header and the `403` problem it answers with. Done on the finished document, like the guard itself, so a route added
 * later by any module (a feature included) is covered without repeating decorators on it.
 */
function documentStoreCsrf(document: OpenAPIObject): void {
  const problem = {
    "application/problem+json": { schema: { $ref: getSchemaPath(ProblemDetailsDoc) } },
  };
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/store/")) {
      continue;
    }
    for (const [method, operation] of Object.entries(item)) {
      if (!STORE_WRITE_METHODS.has(method) || typeof operation !== "object" || operation === null) {
        continue;
      }
      const target = operation as {
        parameters?: unknown[];
        responses: Record<string, unknown>;
      };
      target.parameters = [
        ...(target.parameters ?? []),
        {
          name: "X-Fluxkit-CSRF",
          in: "header",
          required: true,
          description:
            "Must be `1` on every state-changing store request (CSRF defence, ADR 0016). Requests with a body also need `Content-Type: application/json`.",
          schema: { type: "string", enum: ["1"] },
        },
      ];
      target.responses = {
        ...target.responses,
        "403": { description: STORE_CSRF_DESCRIPTION, content: problem },
      };
    }
  }
}

const STORE_CSRF_DESCRIPTION =
  "Forbidden: the X-Fluxkit-CSRF: 1 header is missing or not `1`, or a request with a body is not `Content-Type: application/json`. Checked before anything else.";

/**
 * The cart of a `cart_changed` problem is the cart of `GET /store/cart`: the same zod schema, so a generated client types
 * it (lines, notices, `requiresShipping`) instead of an open object, and the two cannot drift apart.
 */
function documentCartProblem(document: OpenAPIObject): void {
  const problem = document.components?.schemas?.["ProblemDetailsDoc"];
  if (problem === undefined || "$ref" in problem || problem.properties?.["cart"] === undefined) {
    throw new Error("ProblemDetailsDoc.cart is missing from the OpenAPI document");
  }
  const placeholder = problem.properties["cart"];
  problem.properties["cart"] = {
    ...zodToOpenApiSchema(cartSchema, "output"),
    ...("description" in placeholder ? { description: placeholder.description } : {}),
  };
}

/** Finishes the generated document with what decorators cannot say: the store contract (`docs/contracts/api.md`). */
export function documentStoreContract(document: OpenAPIObject): OpenAPIObject {
  documentStoreCsrf(document);
  documentCartProblem(document);
  return document;
}
