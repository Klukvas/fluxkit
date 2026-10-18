/**
 * Test support, not part of the package build: compares the hand-written types with the OpenAPI document.
 *
 * `Shape<T>` is a runtime description of a TypeScript type that the compiler forces to stay in step with `T`: change a
 * type and every shape built for it stops compiling. `compareShape` then checks a shape against a schema of
 * `docs/api/openapi.json` (OpenAPI 3.0), so a change on either side fails a test. The pair replaces a generator.
 */

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type Distribute<T> = T extends unknown ? Shape<T> : never;

export type Shape<T> = [T] extends [never]
  ? never
  : [T] extends [undefined]
    ? "none"
    : null extends T
      ? { nullable: Shape<NonNullable<T>> }
      : [T] extends [boolean]
        ? "boolean"
        : [T] extends [string]
          ? string extends T
            ? "string"
            : { enum: readonly T[] }
          : [T] extends [number]
            ? "integer" | "number"
            : true extends IsUnion<T>
              ? { oneOf: readonly Distribute<T>[] }
              : [T] extends [readonly (infer U)[]]
                ? { array: Shape<U> }
                : string extends keyof T
                  ? { record: Shape<T[string]> }
                  : {
                      object: {
                        [K in keyof T]-?: undefined extends T[K]
                          ? { optional: Shape<Exclude<T[K], undefined>> }
                          : Shape<T[K]>;
                      };
                    };

/** What the comparator reads: the loose runtime form of any `Shape<T>`. */
export type ShapeNode =
  | "none"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "any"
  | "never"
  | { enum: readonly string[] }
  | { nullable: ShapeNode }
  | { array: ShapeNode }
  | { record: ShapeNode }
  | { oneOf: readonly ShapeNode[] }
  | { object: Readonly<Record<string, ShapeNode | { optional: ShapeNode }>> };

export interface OpenApiSchema {
  type?: string;
  nullable?: boolean;
  enum?: readonly string[];
  properties?: Record<string, OpenApiSchema>;
  required?: readonly string[];
  items?: OpenApiSchema;
  additionalProperties?: OpenApiSchema | boolean;
  oneOf?: readonly OpenApiSchema[];
  anyOf?: readonly OpenApiSchema[];
  not?: OpenApiSchema;
  $ref?: string;
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchema> };
}

export interface OpenApiOperation {
  operationId?: string;
  parameters?: { name: string; in: string; required?: boolean; schema?: OpenApiSchema }[];
  requestBody?: { required?: boolean; content: Record<string, { schema: OpenApiSchema }> };
  responses: Record<
    string,
    { content?: Record<string, { schema?: OpenApiSchema }>; headers?: Record<string, unknown> }
  >;
}

function resolve(schema: OpenApiSchema, document: OpenApiDocument): OpenApiSchema {
  if (schema.$ref === undefined) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const target = document.components.schemas[name];
  if (target === undefined) throw new Error(`Unresolved $ref ${schema.$ref}`);
  return target;
}

const sameSet = (a: Iterable<string>, b: Iterable<string>) => {
  const left = [...new Set(a)].sort();
  const right = [...new Set(b)].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

/** Returns a list of differences; an empty list means the shape matches the schema. */
export function compareShape(
  shape: ShapeNode,
  rawSchema: OpenApiSchema,
  document: OpenApiDocument,
  at = "$",
): string[] {
  const schema = resolve(rawSchema, document);
  const isNullableShape = typeof shape === "object" && "nullable" in shape;
  const isNullableSchema = schema.nullable === true;
  if (isNullableShape !== isNullableSchema) {
    return [`${at}: nullable differs (types: ${isNullableShape}, openapi: ${isNullableSchema})`];
  }
  if (isNullableShape) {
    return compareShape(
      (shape as { nullable: ShapeNode }).nullable,
      { ...schema, nullable: false },
      document,
      at,
    );
  }

  if (shape === "any") return [];
  if (shape === "never") {
    return schema.not !== undefined && Object.keys(schema.not).length === 0
      ? []
      : [`${at}: openapi is not the empty-type schema {"not":{}}`];
  }
  if (shape === "none") return [`${at}: "none" is only for operations without a response body`];
  if (typeof shape === "string") {
    const expected = shape === "boolean" ? "boolean" : shape;
    const problems: string[] = [];
    if (schema.type !== expected)
      problems.push(`${at}: type is ${schema.type ?? "missing"} in openapi, ${expected} in types`);
    if (schema.enum !== undefined)
      problems.push(`${at}: openapi has an enum, the type is a plain ${shape}`);
    return problems;
  }
  if ("enum" in shape) {
    if (schema.type !== "string" || schema.enum === undefined)
      return [`${at}: openapi is not a string enum`];
    return sameSet(shape.enum, schema.enum)
      ? []
      : [
          `${at}: enum values differ (types: ${shape.enum.join("|")}, openapi: ${schema.enum.join("|")})`,
        ];
  }
  if ("array" in shape) {
    if (schema.type !== "array") return [`${at}: openapi is not an array`];
    if (shape.array === "any") {
      return schema.items === undefined
        ? []
        : [`${at}: openapi constrains the items, the type does not`];
    }
    return schema.items === undefined
      ? [`${at}: openapi has no items`]
      : compareShape(shape.array, schema.items, document, `${at}[]`);
  }
  if ("record" in shape) {
    const additional = schema.additionalProperties;
    if (schema.type !== "object" || typeof additional !== "object")
      return [`${at}: openapi is not a string-keyed map`];
    if (Object.keys(schema.properties ?? {}).length > 0)
      return [`${at}: openapi map also lists fixed properties`];
    return compareShape(shape.record, additional, document, `${at}{}`);
  }
  if ("oneOf" in shape) {
    const alternatives = schema.oneOf ?? schema.anyOf;
    if (alternatives === undefined) return [`${at}: openapi has no oneOf/anyOf`];
    const results = (shapes: readonly ShapeNode[], schemas: readonly OpenApiSchema[]) =>
      shapes.map((candidate) =>
        schemas.map(
          (alternative) => compareShape(candidate, alternative, document, at).length === 0,
        ),
      );
    const forward = results(shape.oneOf, alternatives);
    const problems: string[] = [];
    forward.forEach((matches, index) => {
      if (!matches.some(Boolean))
        problems.push(`${at}: type alternative ${index} matches no openapi alternative`);
    });
    alternatives.forEach((_alternative, index) => {
      if (!forward.some((matches) => matches[index] === true))
        problems.push(`${at}: openapi alternative ${index} matches no type alternative`);
    });
    return problems;
  }

  // object
  if (schema.type !== "object" || schema.properties === undefined)
    return [`${at}: openapi is not an object with properties`];
  const fields = Object.entries(shape.object);
  const keys = fields.map(([key]) => key);
  const problems: string[] = [];
  for (const key of keys) {
    if (!(key in schema.properties)) problems.push(`${at}.${key}: in the type, not in openapi`);
  }
  for (const key of Object.keys(schema.properties)) {
    if (!keys.includes(key)) problems.push(`${at}.${key}: in openapi, not in the type`);
  }
  const required = new Set(schema.required ?? []);
  for (const [key, field] of fields) {
    const optional = typeof field === "object" && "optional" in field;
    const property = schema.properties[key];
    if (property === undefined) continue;
    if (optional === required.has(key)) {
      problems.push(
        `${at}.${key}: ${optional ? "optional in the type, required in openapi" : "required in the type, optional in openapi"}`,
      );
    }
    const inner = optional ? (field as { optional: ShapeNode }).optional : (field as ShapeNode);
    problems.push(...compareShape(inner, property, document, `${at}.${key}`));
  }
  return problems;
}
