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
import { PROVIDER_FAILURE_REASONS, type ProviderFailureReason } from "@fluxkit/core";
import { z } from "zod";
import { cartSchema, type CartResponse } from "../cart/cart.schemas.js";
import {
  shippingChangedSchema,
  type ShippingChanged,
} from "../shipping/store/shipping-store.schemas.js";
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
  // Placeholder: `documentStoreContract` replaces it with the shipping option schema (as `cart` above).
  @ApiPropertyOptional({
    description:
      "Only on `shipping_changed`: the chosen method's fresh option, exactly as `GET /store/shipping/options` returns it, or `{methodCode, available: false, reason}` when the method is not offered any more.",
    type: "object",
    properties: {},
  })
  shipping?: ShippingChanged;
  @ApiPropertyOptional({
    description:
      "Only on a carrier failure of a shipment route (`shipping_provider_unavailable`, `rule_violation` `carrier_*`): the provider's typed reason.",
    enum: [...PROVIDER_FAILURE_REASONS],
  })
  reason?: ProviderFailureReason;
  @ApiPropertyOptional({
    description:
      "Only on a carrier failure of a shipment route: the raw carrier codes (never message text); may be empty.",
    type: [String],
  })
  providerCodes?: string[];
}

const PROBLEM_DESCRIPTION: Readonly<Record<number, string>> = {
  400: `${PROBLEM_TITLE.validation_failed}: malformed request or invalid fields (see errors).`,
  401: `${PROBLEM_TITLE.unauthorized}.`,
  403: "Forbidden: the role lacks the route's permission, or the X-Fluxkit-CSRF header or JSON content type is missing on a state-changing request.",
  404: `${PROBLEM_TITLE.not_found}.`,
  409: "Conflict: unique value taken, record in use, or a rule/transition is violated (see code).",
  413: "The request body is too large.",
  415: "The request body is not of the content type the route takes.",
  429: `${PROBLEM_TITLE.too_many_requests}: try again after the number of seconds in the Retry-After header.`,
  500: `${PROBLEM_TITLE.internal_error}. Details are only in the server log.`,
  503: `${PROBLEM_TITLE.service_unavailable}: a transient failure, try again after the number of seconds in the Retry-After header.`,
};

/** Adds `application/problem+json` responses for the given statuses to a route or controller. */
export function ApiProblemResponses(
  ...statuses: (400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 503)[]
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

/** Where the CSRF guards (store and admin) apply: every state-changing method. */
const CSRF_WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

interface CsrfDocumentation {
  /** Operations whose path starts with this prefix are documented. */
  readonly pathPrefix: string;
  readonly headerDescription: string;
  /** Replaces the `403` response of the operation; without it an existing `403` stays and a missing one gets `fallback403`. */
  readonly replace403?: string;
  readonly fallback403: string;
}

/**
 * Documents a global CSRF guard on every state-changing operation under a path prefix: the required `X-Fluxkit-CSRF: 1`
 * header and the `403` problem it answers with. Done on the finished document, like the guard itself, so a route added
 * later by any module (a feature included) is covered without repeating decorators on it.
 */
function documentCsrf(document: OpenAPIObject, config: CsrfDocumentation): void {
  const problem = {
    "application/problem+json": { schema: { $ref: getSchemaPath(ProblemDetailsDoc) } },
  };
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith(config.pathPrefix)) {
      continue;
    }
    for (const [method, operation] of Object.entries(item)) {
      if (!CSRF_WRITE_METHODS.has(method) || typeof operation !== "object" || operation === null) {
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
          description: config.headerDescription,
          schema: { type: "string", enum: ["1"] },
        },
      ];
      if (config.replace403 !== undefined) {
        target.responses = {
          ...target.responses,
          "403": { description: config.replace403, content: problem },
        };
      } else if (target.responses["403"] === undefined) {
        target.responses = {
          ...target.responses,
          "403": { description: config.fallback403, content: problem },
        };
      }
    }
  }
}

const STORE_CSRF_DESCRIPTION =
  "Forbidden: the X-Fluxkit-CSRF: 1 header is missing or not `1`, or a request with a body is not `Content-Type: application/json`. Checked before anything else.";

function documentStoreCsrf(document: OpenAPIObject): void {
  documentCsrf(document, {
    pathPrefix: "/store/",
    headerDescription:
      "Must be `1` on every state-changing store request (CSRF defence, ADR 0016). Requests with a body also need `Content-Type: application/json`.",
    replace403: STORE_CSRF_DESCRIPTION,
    fallback403: STORE_CSRF_DESCRIPTION,
  });
}

/**
 * Documents the admin CSRF guard (`AdminGuard`, ADR 0009) on every state-changing `/admin` operation, the sign-in
 * included: the required `X-Fluxkit-CSRF: 1` header. The `403` every admin route already documents (permission or CSRF)
 * stays as it is. Documentation only: the guard itself is unchanged.
 */
export function documentAdminCsrf(document: OpenAPIObject): OpenAPIObject {
  documentCsrf(document, {
    pathPrefix: "/admin/",
    headerDescription:
      "Must be `1` on every state-changing admin request, the sign-in included, also for anonymous callers (CSRF defence, ADR 0009). Requests with a body also need `Content-Type: application/json`.",
    fallback403: PROBLEM_DESCRIPTION[403] ?? "Forbidden.",
  });
  documentBinaryUploadCsrf(document);
  return document;
}

const BINARY_UPLOAD_TYPE = "application/octet-stream";

/**
 * The one admin route that takes a raw `application/octet-stream` body (`@AcceptsBinaryUpload()`, ADR 0028 decision 4)
 * documents its CSRF rule instead of the JSON one. Recognized by its documented request body type, so the text cannot
 * end up on a route whose body is JSON.
 */
function documentBinaryUploadCsrf(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/admin/")) {
      continue;
    }
    for (const [method, operation] of Object.entries(item)) {
      if (!CSRF_WRITE_METHODS.has(method) || typeof operation !== "object" || operation === null) {
        continue;
      }
      const target = operation as {
        parameters?: { name?: string; description?: string }[];
        requestBody?: { content?: Record<string, unknown> };
        responses: Record<string, { description?: string }>;
      };
      if (target.requestBody?.content?.[BINARY_UPLOAD_TYPE] === undefined) {
        continue;
      }
      for (const parameter of target.parameters ?? []) {
        if (parameter.name === "X-Fluxkit-CSRF") {
          parameter.description =
            "Must be `1` (CSRF defence, ADR 0009). This route is the one exception to the JSON rule (ADR 0028): its body must be `Content-Type: application/octet-stream`; every other type, JSON and multipart included, is refused with 403.";
        }
      }
      const forbidden = target.responses["403"];
      if (forbidden !== undefined) {
        forbidden.description =
          "Forbidden: the role lacks the route's permission, the X-Fluxkit-CSRF header is missing, or the body is not `Content-Type: application/octet-stream`.";
      }
    }
  }
}

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

/** The `shipping` of a `shipping_changed` problem is the option schema of `GET /store/shipping/options` (ADR 0029). */
function documentShippingProblem(document: OpenAPIObject): void {
  const problem = document.components?.schemas?.["ProblemDetailsDoc"];
  if (
    problem === undefined ||
    "$ref" in problem ||
    problem.properties?.["shipping"] === undefined
  ) {
    throw new Error("ProblemDetailsDoc.shipping is missing from the OpenAPI document");
  }
  const placeholder = problem.properties["shipping"];
  problem.properties["shipping"] = {
    ...zodToOpenApiSchema(shippingChangedSchema, "output"),
    ...("description" in placeholder ? { description: placeholder.description } : {}),
  };
}

/** Finishes the generated document with what decorators cannot say: the store contract (`docs/contracts/api.md`). */
export function documentStoreContract(document: OpenAPIObject): OpenAPIObject {
  documentStoreCsrf(document);
  documentCartProblem(document);
  documentShippingProblem(document);
  return document;
}
