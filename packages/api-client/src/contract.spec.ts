import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { OPERATIONS, type OperationName, type StoreClient, type StoreResult } from "./index.js";
import type {
  AccountResult,
  AddCartItemBody,
  AddressInput,
  Address,
  AttributeValue,
  AuthResult,
  Cart,
  CartLine,
  CartLineNotice,
  CategoryList,
  ChangePasswordBody,
  CheckoutBody,
  CheckoutResult,
  Customer,
  LoginBody,
  Money,
  Order,
  OrderAccessBody,
  OrderList,
  ProblemDetails,
  ProductDetail,
  ProductList,
  RegisterBody,
  SetCartItemQuantityBody,
  StoreConfig,
  UpdateAccountBody,
} from "./types.js";
import {
  compareShape,
  type OpenApiDocument,
  type OpenApiOperation,
  type Shape,
  type ShapeNode,
} from "./testing/shape.js";

const document = JSON.parse(
  readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
) as OpenApiDocument;

// ------------------------------------------------------------------ shapes
// Every constant is typed `Shape<T>`: change the hand-written type and this file stops compiling until the shape
// follows. The tests below then compare each shape with `docs/api/openapi.json`.

const money: Shape<Money> = { object: { amount: "integer", currency: "string" } };
const optionValues = { array: { object: { option: "string", value: "string" } } } as const;
const cartNotices = {
  array: { object: { code: { enum: ["quantity_capped", "lines_dropped"] } } },
} as const;
const image = { nullable: { object: { url: "string", alt: { nullable: "string" } } } } as const;
const availability = { enum: ["in_stock", "low_stock", "out_of_stock"] } as const;
const orderStatus = {
  enum: ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired"],
} as const;

const lineNotice: Shape<CartLineNotice> = {
  oneOf: [
    { object: { code: { enum: ["price_changed"] }, previousAmount: money } },
    { object: { code: { enum: ["unavailable"] } } },
    { object: { code: { enum: ["line_total_out_of_range"] } } },
    { object: { code: { enum: ["out_of_stock"] } } },
  ],
};

const cartLine: Shape<CartLine> = {
  object: {
    variantId: "string",
    productSlug: "string",
    sku: "string",
    title: "string",
    variantTitle: { nullable: "string" },
    optionValues,
    image,
    quantity: "integer",
    unitPrice: { nullable: money },
    compareAtAmount: { nullable: "integer" },
    lineTotal: { nullable: money },
    availability,
    notices: { array: lineNotice },
  },
};

const cart: Shape<Cart> = {
  object: {
    lines: { array: cartLine },
    subtotal: money,
    total: money,
    itemCount: "integer",
    purchasable: "boolean",
    requiresShipping: "boolean",
    notices: cartNotices,
  },
};

const customer: Shape<Customer> = {
  object: {
    id: "string",
    email: "string",
    firstName: "string",
    lastName: "string",
    phone: { nullable: "string" },
    createdAt: "string",
  },
};

const authResult: Shape<AuthResult> = { object: { customer, cartNotices } };
const accountResult: Shape<AccountResult> = { object: { customer } };

const address: Shape<Address> = {
  object: {
    countryCode: "string",
    region: { optional: "string" },
    city: "string",
    postalCode: { optional: "string" },
    line1: "string",
    line2: { optional: "string" },
    recipientFirstName: { optional: "string" },
    recipientLastName: { optional: "string" },
    recipientPhone: { optional: "string" },
  },
};

const addressInput: Shape<AddressInput> = {
  object: {
    countryCode: { optional: "string" },
    region: { optional: "string" },
    city: { optional: "string" },
    postalCode: { optional: "string" },
    line1: { optional: "string" },
    line2: { optional: "string" },
    recipientFirstName: { optional: "string" },
    recipientLastName: { optional: "string" },
    recipientPhone: { optional: "string" },
  },
};

const order: Shape<Order> = {
  object: {
    number: "string",
    status: orderStatus,
    placedAt: "string",
    expiresAt: "string",
    currency: "string",
    items: {
      array: {
        object: {
          sku: "string",
          productTitle: "string",
          variantTitle: { nullable: "string" },
          optionValues,
          imageUrl: { nullable: "string" },
          unitPrice: money,
          compareAtAmount: { nullable: "integer" },
          quantity: "integer",
          lineTotal: money,
        },
      },
    },
    subtotal: money,
    shippingTotal: money,
    discountTotal: money,
    taxTotal: money,
    total: money,
    adjustments: {
      array: {
        object: {
          kind: "string",
          code: "string",
          label: "string",
          amount: money,
          includedInPrice: "boolean",
        },
      },
    },
    contact: {
      object: { email: "string", phone: "string", firstName: "string", lastName: "string" },
    },
    shippingAddress: { nullable: address },
    billingAddress: { nullable: address },
    history: { array: { object: { status: orderStatus, at: "string" } } },
  },
};

const checkoutResult: Shape<CheckoutResult> = {
  object: { order, accessToken: { optional: "string" } },
};

const orderList: Shape<OrderList> = {
  object: {
    items: {
      array: {
        object: {
          number: "string",
          status: orderStatus,
          placedAt: "string",
          expiresAt: "string",
          total: money,
          itemCount: "integer",
        },
      },
    },
    total: "integer",
    limit: "integer",
    offset: "integer",
  },
};

const storeConfig: Shape<StoreConfig> = {
  object: {
    currency: "string",
    currencyExponent: "integer",
    pricesIncludeTax: "boolean",
    defaultLocale: "string",
    locales: { array: "string" },
  },
};

const priceRange = { object: { from: "integer", to: "integer", currency: "string" } } as const;
const brand = { nullable: { object: { slug: "string", name: "string" } } } as const;

const productList: Shape<ProductList> = {
  object: {
    items: {
      array: {
        object: {
          id: "string",
          slug: "string",
          title: "string",
          brand,
          image,
          publishedAt: "string",
          price: priceRange,
          availability,
        },
      },
    },
    total: "integer",
    limit: "integer",
    offset: "integer",
  },
};

const labelledCode = { object: { code: "string", label: "string" } } as const;
const attributeValue: Shape<AttributeValue> = {
  oneOf: [
    "string",
    "boolean",
    { object: { value: "number", unit: { nullable: "string" } } },
    labelledCode,
    { array: labelledCode },
  ],
};

const productDetail: Shape<ProductDetail> = {
  object: {
    id: "string",
    slug: "string",
    title: "string",
    description: { nullable: "string" },
    brand,
    publishedAt: "string",
    categories: { array: { object: { id: "string", slug: "string", name: "string" } } },
    attributes: { record: attributeValue },
    attributeDefinitions: {
      array: {
        object: {
          code: "string",
          name: "string",
          inputType: {
            enum: ["text", "number", "boolean", "select", "multiselect", "date"],
          },
          isLocalized: "boolean",
          unit: { nullable: "string" },
          isFilterable: "boolean",
          isComparable: "boolean",
          isSortable: "boolean",
          options: { array: labelledCode },
        },
      },
    },
    options: {
      array: {
        object: {
          id: "string",
          code: "string",
          name: "string",
          values: { array: { object: { id: "string", code: "string", name: "string" } } },
        },
      },
    },
    variants: {
      array: {
        object: {
          id: "string",
          sku: "string",
          optionValues: { array: { object: { optionCode: "string", valueCode: "string" } } },
          attributes: { record: attributeValue },
          price: {
            object: {
              amount: "integer",
              currency: "string",
              compareAtAmount: { nullable: "integer" },
            },
          },
          availability,
        },
      },
    },
    price: priceRange,
    availability,
    media: {
      array: {
        object: {
          url: "string",
          alt: { nullable: "string" },
          optionValueId: { nullable: "string" },
        },
      },
    },
  },
};

/** The category tree is five levels deep in the document; the last level's `children` can only be empty (`{ not: {} }`). */
const categoryLevel = (depth: number): ShapeNode => {
  const base = {
    id: "string",
    slug: "string",
    name: "string",
    description: { nullable: "string" },
  } as const;
  return {
    object: { ...base, children: { array: depth === 0 ? "never" : categoryLevel(depth - 1) } },
  };
};
const categoryList: Shape<CategoryList> = {
  object: { items: { array: categoryLevel(4) } },
} as Shape<CategoryList>;

const fieldError = {
  object: { path: "string", code: "string", message: { optional: "string" } },
} as const;
const problemDetails: Shape<ProblemDetails> = {
  object: {
    type: "string",
    title: "string",
    status: "number",
    code: {
      enum: [
        "validation_failed",
        "unauthorized",
        "forbidden",
        "not_found",
        "conflict",
        "in_use",
        "invalid_transition",
        "rule_violation",
        "too_many_requests",
        "internal_error",
        "cart_empty",
        "cart_changed",
        "checkout_refused",
        "idempotency_key_reused",
        "too_many_open_orders",
        "service_unavailable",
      ],
    },
    detail: "string",
    errors: { optional: { array: fieldError } },
    field: { optional: "string" },
    constraint: { optional: "string" },
    rule: { optional: "string" },
    cart: { optional: cart },
  },
};

// Request bodies: one per operation that takes a body.
const registerBody: Shape<RegisterBody> = {
  object: {
    email: "string",
    password: "string",
    firstName: "string",
    lastName: "string",
    phone: { optional: "string" },
  },
};
const loginBody: Shape<LoginBody> = { object: { email: "string", password: "string" } };
const updateAccountBody: Shape<UpdateAccountBody> = {
  object: {
    firstName: { optional: "string" },
    lastName: { optional: "string" },
    phone: { optional: { nullable: "string" } },
  },
};
const changePasswordBody: Shape<ChangePasswordBody> = {
  object: { currentPassword: "string", newPassword: "string" },
};
const addCartItemBody: Shape<AddCartItemBody> = {
  object: { variantId: "string", quantity: "integer" },
};
const setQuantityBody: Shape<SetCartItemQuantityBody> = { object: { quantity: "integer" } };
const checkoutBody: Shape<CheckoutBody> = {
  object: {
    email: { optional: "string" },
    phone: "string",
    firstName: "string",
    lastName: "string",
    shippingAddress: { optional: { nullable: addressInput } },
    billingAddress: { optional: { nullable: addressInput } },
    locale: { optional: "string" },
    expectedTotal: { object: { amount: "number", currency: "string" } },
  },
};
const orderAccessBody: Shape<OrderAccessBody> = {
  object: { number: "string", accessToken: "string" },
};

/** Success body per operation, typed by what the client function really returns. */
type DataOf<N extends OperationName> = Extract<
  Awaited<ReturnType<StoreClient[N]>>,
  { ok: true }
>["data"];

const RESPONSE_SHAPES: { [N in OperationName]: Shape<DataOf<N>> } = {
  register: authResult,
  login: authResult,
  logout: "none",
  getAccount: accountResult,
  updateAccount: accountResult,
  changePassword: "none",
  getCart: cart,
  clearCart: "none",
  addCartItem: cart,
  setCartItemQuantity: cart,
  removeCartItem: cart,
  acknowledgeCart: cart,
  checkout: checkoutResult,
  lookupOrder: order,
  cancelOrder: order,
  listAccountOrders: orderList,
  getAccountOrder: order,
  cancelAccountOrder: order,
  listCategories: categoryList,
  getConfig: storeConfig,
  listProducts: productList,
  getProduct: productDetail,
};

/** Request body per operation; `null` where the operation has none. */
const REQUEST_SHAPES: { [N in OperationName]: ShapeNode | null } = {
  register: registerBody,
  login: loginBody,
  logout: null,
  getAccount: null,
  updateAccount: updateAccountBody,
  changePassword: changePasswordBody,
  getCart: null,
  clearCart: null,
  addCartItem: addCartItemBody,
  setCartItemQuantity: setQuantityBody,
  removeCartItem: null,
  acknowledgeCart: null,
  checkout: checkoutBody,
  lookupOrder: orderAccessBody,
  cancelOrder: orderAccessBody,
  listAccountOrders: null,
  getAccountOrder: null,
  cancelAccountOrder: null,
  listCategories: null,
  getConfig: null,
  listProducts: null,
  getProduct: null,
};

// ------------------------------------------------------------------- tests

function storeOperations(): Map<string, OpenApiOperation> {
  const found = new Map<string, OpenApiOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/store")) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (method === "parameters") continue;
      found.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return found;
}

const openApiOperationFor = (name: OperationName): OpenApiOperation => {
  const spec = OPERATIONS[name];
  const operation = storeOperations().get(`${spec.method} ${spec.path}`);
  if (operation === undefined)
    throw new Error(`${name}: ${spec.method} ${spec.path} is not in openapi.json`);
  return operation;
};

const names = Object.keys(OPERATIONS) as OperationName[];

describe("operations against docs/api/openapi.json", () => {
  it("covers exactly the operations under /store and no admin route", () => {
    const documented = [...storeOperations().keys()].sort();
    const implemented = names
      .map((name) => `${OPERATIONS[name].method} ${OPERATIONS[name].path}`)
      .sort();
    expect(implemented).toEqual(documented);
    expect(implemented.some((entry) => entry.includes("/admin"))).toBe(false);
  });

  it.each(names)("%s: statuses, parameters, headers and content types match", (name) => {
    const spec = OPERATIONS[name];
    const operation = openApiOperationFor(name);
    const parameters = operation.parameters ?? [];

    const successStatuses = Object.keys(operation.responses).filter((status) =>
      status.startsWith("2"),
    );
    expect(successStatuses.sort()).toEqual(spec.successStatuses.map(String).sort());

    expect(
      parameters
        .filter((p) => p.in === "query")
        .map((p) => p.name)
        .sort(),
    ).toEqual([...spec.query].sort());
    const placeholders = [...spec.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    expect(
      parameters
        .filter((p) => p.in === "path")
        .map((p) => p.name)
        .sort(),
    ).toEqual(placeholders.sort());

    const headerNames = parameters
      .filter((p) => p.in === "header")
      .map((p) => p.name)
      .sort();
    const expectedHeaders = [
      ...(spec.method === "GET" ? [] : ["X-Fluxkit-CSRF"]),
      ...(spec.requiresIdempotencyKey ? ["Idempotency-Key"] : []),
    ].sort();
    expect(headerNames).toEqual(expectedHeaders);
    for (const header of parameters.filter((p) => p.in === "header"))
      expect(header.required).toBe(true);

    expect(operation.requestBody !== undefined).toBe(spec.hasBody);
    if (operation.requestBody !== undefined) {
      expect(Object.keys(operation.requestBody.content)).toEqual(["application/json"]);
    }

    for (const [status, response] of Object.entries(operation.responses)) {
      const content = Object.keys(response.content ?? {});
      if (status.startsWith("2")) {
        expect(content, `${name} ${status}`).toEqual(status === "204" ? [] : ["application/json"]);
      } else {
        expect(content, `${name} ${status}`).toEqual(["application/problem+json"]);
        expect(response.content?.["application/problem+json"]?.schema?.$ref).toBe(
          "#/components/schemas/ProblemDetailsDoc",
        );
      }
    }
  });

  it.each(names)("%s: the response and request types match the schemas", (name) => {
    const spec = OPERATIONS[name];
    const operation = openApiOperationFor(name);
    for (const status of spec.successStatuses) {
      const response = operation.responses[String(status)];
      const schema = response?.content?.["application/json"]?.schema;
      const shape = RESPONSE_SHAPES[name] as ShapeNode;
      if (status === 204) {
        expect(shape).toBe("none");
        continue;
      }
      expect(schema, `${name} ${status} schema`).toBeDefined();
      if (schema !== undefined) expect(compareShape(shape, schema, document)).toEqual([]);
    }
    const bodyShape = REQUEST_SHAPES[name];
    if (bodyShape === null) {
      expect(operation.requestBody).toBeUndefined();
    } else {
      const schema = operation.requestBody?.content["application/json"]?.schema;
      expect(schema).toBeDefined();
      if (schema !== undefined) expect(compareShape(bodyShape, schema, document)).toEqual([]);
    }
  });

  it("ProblemDetails matches ProblemDetailsDoc", () => {
    const schema = document.components.schemas.ProblemDetailsDoc;
    expect(schema).toBeDefined();
    if (schema !== undefined)
      expect(compareShape(problemDetails as ShapeNode, schema, document)).toEqual([]);
  });
});

describe("the comparison itself fails when the contract or the types drift", () => {
  const cartSchema = () => {
    const schema = structuredClone(
      document.paths["/store/cart"]?.get?.responses["200"]?.content?.["application/json"]?.schema,
    );
    if (schema === undefined) throw new Error("cart schema missing");
    return schema;
  };

  it("passes on the real document (control)", () => {
    expect(compareShape(cart as ShapeNode, cartSchema(), document)).toEqual([]);
  });

  it("detects requiresShipping changing type", () => {
    const schema = cartSchema();
    const property = schema.properties?.requiresShipping;
    if (property === undefined) throw new Error("requiresShipping missing");
    property.type = "string";
    expect(compareShape(cart as ShapeNode, schema, document)).toEqual([
      expect.stringContaining("$.requiresShipping: type is string in openapi, boolean in types"),
    ]);
  });

  it("detects a removed, added or renamed property", () => {
    const removed = cartSchema();
    delete removed.properties?.requiresShipping;
    expect(compareShape(cart as ShapeNode, removed, document).join("\n")).toContain(
      "requiresShipping: in the type, not in openapi",
    );

    const added = cartSchema();
    if (added.properties) added.properties.surprise = { type: "string" };
    expect(compareShape(cart as ShapeNode, added, document).join("\n")).toContain(
      "surprise: in openapi, not in the type",
    );
  });

  it("detects required and nullable changes and enum drift", () => {
    const optional = cartSchema();
    optional.required = (optional.required ?? []).filter((key) => key !== "requiresShipping");
    expect(compareShape(cart as ShapeNode, optional, document).join("\n")).toContain(
      "required in the type, optional in openapi",
    );

    const nullable = cartSchema();
    const lineSchema = nullable.properties?.lines?.items;
    const title = lineSchema?.properties?.variantTitle;
    if (title === undefined) throw new Error("variantTitle missing");
    title.nullable = false;
    expect(compareShape(cart as ShapeNode, nullable, document).join("\n")).toContain(
      "nullable differs",
    );

    const enumDrift = cartSchema();
    const availabilitySchema = enumDrift.properties?.lines?.items?.properties?.availability;
    if (availabilitySchema === undefined) throw new Error("availability missing");
    availabilitySchema.enum = ["in_stock", "out_of_stock"];
    expect(compareShape(cart as ShapeNode, enumDrift, document).join("\n")).toContain(
      "enum values differ",
    );
  });

  it("detects a changed union", () => {
    const schema = cartSchema();
    const notices = schema.properties?.lines?.items?.properties?.notices?.items;
    if (notices?.oneOf === undefined) throw new Error("notices oneOf missing");
    notices.oneOf = notices.oneOf.slice(1);
    expect(compareShape(cart as ShapeNode, schema, document).join("\n")).toContain("matches no");
  });
});

describe("types the storefront relies on", () => {
  it("are what the contract says", () => {
    expectTypeOf<Cart["requiresShipping"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Cart["purchasable"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Money["amount"]>().toEqualTypeOf<number>();
    expectTypeOf<ProblemDetails["cart"]>().toEqualTypeOf<Cart | undefined>();
    expectTypeOf<CheckoutResult["accessToken"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Order["status"]>().toEqualTypeOf<
      "awaiting_payment" | "paid" | "fulfilled" | "cancelled" | "expired"
    >();
    expectTypeOf<Awaited<ReturnType<StoreClient["getCart"]>>>().toEqualTypeOf<StoreResult<Cart>>();
  });
});
