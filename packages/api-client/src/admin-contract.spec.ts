import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_OPERATIONS,
  CSRF_HEADER,
  OPERATIONS,
  type AdminClient,
  type AdminOperationName,
  type AdminOperationPermission,
} from "./index.js";
import type {
  AdjustInventoryResult,
  AdminAttribute,
  AdminAttributeList,
  AdminAttributeOption,
  AdminAttributeWithOptions,
  AdminBrand,
  AdminBrandList,
  AdminCategory,
  AdminCategoryList,
  AdminConfig,
  AdminCustomer,
  AdminCustomerList,
  AdminCustomerSummary,
  AdminEmailMessage,
  AdminEmailMessageDetail,
  AdminEmailMessageId,
  AdminEmailMessageList,
  AdminEmailPreview,
  AdminEmailStatus,
  AdminEmailTemplateList,
  AdminInventoryLevel,
  AdminLocationList,
  AdminLoginResult,
  AdminMe,
  AdminMediaUpload,
  AdminOption,
  AdminOptionList,
  AdminOptionValue,
  AdminOptionWithValues,
  AdminOrder,
  AdminOrderList,
  AdminPrice,
  AdminPriceList,
  AdminProduct,
  AdminProductInventory,
  AdminProductList,
  AdminProductSummary,
  AdminProductType,
  AdminProductTypeAttributeAssignment,
  AdminProductTypeDetail,
  AdminProductTypeList,
  AdminProductTypeOptionAssignment,
  AdminReservationList,
  AdminSessionUser,
  AdminShipment,
  AdminShipmentCreateResult,
  AdminShipmentList,
  AdminShippingMethod,
  AdminShippingMethodList,
  AdminShippingPricing,
  AdminShippingProviderCheck,
  AdminShippingProviderSettings,
  AdminStockMovement,
  AdminStockMovementList,
  AdminUser,
  AdminUserList,
  AdminVariant,
  AdminVariantInventory,
  AdminVariantList,
  GenerateVariantsResult,
  JsonObject,
  LocalizedText,
} from "./admin-types.js";
import type * as Admin from "./admin-types.js";
import type { Address, Money, OrderContact } from "./types.js";
import {
  compareShape,
  type OpenApiDocument,
  type OpenApiOperation,
  type Shape,
  type ShapeNode,
} from "./testing/shape.js";

const document = JSON.parse(
  readFileSync(new URL("../../../docs/api/openapi.json", import.meta.url), "utf8"),
) as OpenApiDocument & {
  paths: Record<string, Record<string, OpenApiOperation & { "x-fluxkit-permission"?: string }>>;
};

// ------------------------------------------------------------------ shapes
// Every constant is typed `Shape<T>`: change a hand-written type and this file stops compiling until the shape follows.
// The tests below compare each shape with `docs/api/openapi.json`.

const localized: Shape<LocalizedText> = { record: "string" };
const json: Shape<JsonObject> = { record: "any" };
const money: Shape<Money> = { object: { amount: "integer", currency: "string" } };
/** Request bodies send `amount` as `number` in the document (the API checks the integer range itself). */
const moneyInput: Shape<Money> = { object: { amount: "number", currency: "string" } };
const orderStatus = {
  enum: ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired"],
} as const;
const inputType = {
  enum: ["text", "number", "boolean", "select", "multiselect", "date"],
} as const;
const productStatus = { enum: ["draft", "active", "archived"] } as const;
const role = { enum: ["owner", "manager", "viewer"] } as const;

function paginated<S>(items: S) {
  return {
    object: { items: { array: items }, total: "integer", limit: "integer", offset: "integer" },
  } as const;
}

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
const contact: Shape<OrderContact> = {
  object: { email: "string", phone: "string", firstName: "string", lastName: "string" },
};

// auth and users
const sessionUser: Shape<AdminSessionUser> = {
  object: {
    id: "string",
    email: "string",
    role,
    isActive: "boolean",
    lastLoginAt: { nullable: "string" },
  },
};
const loginResult: Shape<AdminLoginResult> = { object: { user: sessionUser } };
const me: Shape<AdminMe> = {
  object: {
    user: sessionUser,
    permissions: {
      array: {
        enum: [
          "catalog.read",
          "catalog.write",
          "catalog.publish",
          "users.manage",
          "orders.read",
          "orders.write",
          "customers.read",
          "customers.write",
          "shipping.manage",
          "email.manage",
          "payments.refund",
        ],
      },
    },
  },
};
const adminUser: Shape<AdminUser> = {
  object: {
    id: "string",
    email: "string",
    role,
    isActive: "boolean",
    lastLoginAt: { nullable: "string" },
    createdAt: "string",
    updatedAt: "string",
  },
};
const adminUserList: Shape<AdminUserList> = paginated(adminUser);

// config
const config: Shape<AdminConfig> = {
  object: {
    defaultLocale: "string",
    locales: { array: "string" },
    shopCurrency: "string",
    currencyExponent: "integer",
    supportedCurrencies: { array: { object: { code: "string", exponent: "integer" } } },
    pricesIncludeTax: "boolean",
    lowStockThreshold: "integer",
    emailDelivery: "boolean",
    onlinePayment: "boolean",
    media: {
      object: {
        uploadsEnabled: "boolean",
        maxBytes: "integer",
        contentTypes: { array: "string" },
      },
    },
  },
};

const mediaUpload: Shape<AdminMediaUpload> = {
  object: {
    id: "string",
    url: "string",
    contentType: { enum: ["image/jpeg", "image/png", "image/webp"] },
    byteSize: "integer",
    width: "integer",
    height: "integer",
    createdAt: "string",
  },
};

// customers
const customerSummary: Shape<AdminCustomerSummary> = {
  object: {
    id: "string",
    email: "string",
    firstName: "string",
    lastName: "string",
    isActive: "boolean",
    lastLoginAt: { nullable: "string" },
    createdAt: "string",
  },
};
const customer: Shape<AdminCustomer> = {
  object: {
    ...customerSummary.object,
    phone: { nullable: "string" },
    isLocked: "boolean",
    orderCount: "integer",
    updatedAt: "string",
  },
};
const customerList: Shape<AdminCustomerList> = paginated(customerSummary);

// inventory
const inventoryLevel: Shape<AdminInventoryLevel> = {
  object: {
    locationId: "string",
    locationCode: "string",
    onHand: "integer",
    reserved: "integer",
    available: "integer",
  },
};
const variantInventory: Shape<AdminVariantInventory> = {
  object: {
    variantId: "string",
    trackInventory: "boolean",
    allowBackorder: "boolean",
    levels: { array: inventoryLevel },
    totalAvailable: "integer",
  },
};
const productInventory: Shape<AdminProductInventory> = {
  object: { items: { array: variantInventory } },
};
const stockMovement: Shape<AdminStockMovement> = {
  object: {
    id: "string",
    variantId: "string",
    locationId: "string",
    locationCode: "string",
    kind: { enum: ["receipt", "adjustment", "sale", "return"] },
    delta: "integer",
    onHandAfter: "integer",
    reason: { nullable: "string" },
    reference: { nullable: "string" },
    actorId: { nullable: "string" },
    createdAt: "string",
  },
};
const stockMovementList: Shape<AdminStockMovementList> = paginated(stockMovement);
const adjustInventoryResult: Shape<AdjustInventoryResult> = {
  object: { level: inventoryLevel, movement: stockMovement },
};
const reservationList: Shape<AdminReservationList> = paginated({
  object: {
    status: { enum: ["active", "committed", "released", "expired"] },
    quantity: "integer",
    expiresAt: "string",
    reference: { nullable: "string" },
    orderId: { nullable: "string" },
    locationCode: "string",
    createdAt: "string",
  },
} as const);
const locationList: Shape<AdminLocationList> = {
  object: {
    items: {
      array: { object: { id: "string", code: "string", name: "string", isDefault: "boolean" } },
    },
  },
};

// orders
const orderList: Shape<AdminOrderList> = paginated({
  object: {
    id: "string",
    number: "string",
    status: orderStatus,
    placedAt: "string",
    expiresAt: "string",
    total: money,
    currency: "string",
    customerId: { nullable: "string" },
    email: "string",
    itemCount: "integer",
  },
} as const);
// shipments
const shipmentStatus = {
  enum: [
    "pending",
    "unknown",
    "created",
    "in_transit",
    "arrived",
    "delivered",
    "returning",
    "returned",
    "cancelled",
    "failed",
  ],
} as const;
const providerFailureReason = {
  enum: ["unavailable", "rejected", "invalid_credentials", "not_supported"],
} as const;
const shipment: Shape<AdminShipment> = {
  object: {
    id: "string",
    status: shipmentStatus,
    providerCode: "string",
    providerService: { nullable: "string" },
    trackingNumber: { nullable: "string" },
    carrierStatusCode: { nullable: "string" },
    carrierStatusAt: { nullable: "string" },
    clientReference: "string",
    declaredValue: money,
    carrierCost: { nullable: money },
    payer: { enum: ["sender", "recipient"] },
    weightGrams: "integer",
    lengthMm: "integer",
    widthMm: "integer",
    heightMm: "integer",
    seats: "integer",
    createdBy: { nullable: "string" },
    createdAt: "string",
    updatedAt: "string",
    cancelledAt: { nullable: "string" },
    deliveredAt: { nullable: "string" },
    nextTrackAt: { nullable: "string" },
    history: {
      array: {
        object: {
          fromStatus: { nullable: shipmentStatus },
          toStatus: shipmentStatus,
          carrierStatusCode: { nullable: "string" },
          actorType: { enum: ["admin", "system"] },
          actorAdminId: { nullable: "string" },
          at: "string",
        },
      },
    },
  },
};
const shipmentList: Shape<AdminShipmentList> = { object: { items: { array: shipment } } };
const shipmentCreateResult: Shape<AdminShipmentCreateResult> = {
  object: {
    shipment,
    failure: {
      nullable: { object: { reason: providerFailureReason, providerCodes: { array: "string" } } },
    },
  },
};

const order: Shape<AdminOrder> = {
  object: {
    id: "string",
    number: "string",
    status: orderStatus,
    locale: "string",
    currency: "string",
    customerId: { nullable: "string" },
    isGuest: "boolean",
    contact,
    shippingAddress: { nullable: address },
    billingAddress: { nullable: address },
    items: {
      array: {
        object: {
          position: "integer",
          productId: { nullable: "string" },
          variantId: { nullable: "string" },
          sku: "string",
          productTitle: localized,
          variantTitle: { nullable: localized },
          optionValues: { array: { object: { option: localized, value: localized } } },
          imageUrl: { nullable: "string" },
          unitPrice: money,
          compareAtAmount: { nullable: "integer" },
          quantity: "integer",
          lineTotal: money,
          requiresShipping: "boolean",
          reservations: { array: { object: { status: "string", quantity: "integer" } } },
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
          label: localized,
          amount: money,
          includedInPrice: "boolean",
          source: { nullable: "string" },
        },
      },
    },
    shipping: {
      nullable: {
        object: {
          methodId: { nullable: "string" },
          methodCode: "string",
          kind: { enum: ["address", "pickup_point", "store_pickup"] },
          providerCode: { nullable: "string" },
          amount: money,
          payer: { enum: ["shop_charge", "recipient_on_delivery"] },
          estimatedCarrierAmount: { nullable: money },
          destination: {
            nullable: {
              object: {
                providerRef: "string",
                number: "string",
                kind: { enum: ["branch", "locker"] },
                cityRef: "string",
                cityName: "string",
                description: "string",
              },
            },
          },
          providerService: { nullable: "string" },
          title: localized,
        },
      },
    },
    shipments: { array: shipment },
    history: {
      array: {
        object: {
          fromStatus: { nullable: orderStatus },
          toStatus: orderStatus,
          actorType: { enum: ["customer", "guest", "admin", "system"] },
          actorAdminId: { nullable: "string" },
          reason: { nullable: "string" },
          at: "string",
        },
      },
    },
    placedAt: "string",
    expiresAt: "string",
    paidAt: { nullable: "string" },
    fulfilledAt: { nullable: "string" },
    cancelledAt: { nullable: "string" },
    expiredAt: { nullable: "string" },
    cancellationReason: { nullable: "string" },
    paymentReference: { nullable: "string" },
  },
};

// attributes
const attribute: Shape<AdminAttribute> = {
  object: {
    id: "string",
    code: "string",
    name: localized,
    description: { nullable: localized },
    inputType,
    isLocalized: "boolean",
    unit: { nullable: "string" },
    validation: json,
    isFilterable: "boolean",
    isSearchable: "boolean",
    isVisibleOnStorefront: "boolean",
    isComparable: "boolean",
    isSortable: "boolean",
    isInternal: "boolean",
    createdAt: "string",
    updatedAt: "string",
  },
};
const attributeOption: Shape<AdminAttributeOption> = {
  object: {
    id: "string",
    attributeId: "string",
    code: "string",
    label: localized,
    position: "integer",
    createdAt: "string",
    updatedAt: "string",
  },
};
const attributeWithOptions: Shape<AdminAttributeWithOptions> = {
  object: { ...attribute.object, options: { array: attributeOption } },
};
const attributeList: Shape<AdminAttributeList> = paginated(attribute);

// shipping
const shippingKind = { enum: ["address", "pickup_point", "store_pickup"] } as const;
const shippingPricing: Shape<AdminShippingPricing> = {
  oneOf: [
    { object: { type: { enum: ["flat"] }, amount: "integer" } },
    { object: { type: { enum: ["free_over"] }, amount: "integer", freeFrom: "integer" } },
    {
      object: {
        type: { enum: ["tiers"] },
        tiers: { array: { object: { fromSubtotal: "integer", amount: "integer" } } },
      },
    },
    { object: { type: { enum: ["carrier_on_delivery"] } } },
  ],
};
const shippingMethod: Shape<AdminShippingMethod> = {
  object: {
    id: "string",
    code: "string",
    title: localized,
    description: { nullable: localized },
    kind: shippingKind,
    providerCode: { nullable: "string" },
    providerService: { nullable: "string" },
    pricing: shippingPricing,
    currency: "string",
    countryCodes: { array: "string" },
    isActive: "boolean",
    position: "integer",
    createdAt: "string",
    updatedAt: "string",
  },
};
const shippingMethodList: Shape<AdminShippingMethodList> = paginated(shippingMethod);
const shippingProviderSettings: Shape<AdminShippingProviderSettings> = {
  object: {
    providerCode: "string",
    settings: json,
    updatedAt: { nullable: "string" },
    updatedBy: { nullable: "string" },
  },
};
const shippingProviderCheck: Shape<AdminShippingProviderCheck> = {
  oneOf: [
    { object: { ok: { literal: true } } },
    {
      object: {
        ok: { literal: false },
        reason: { enum: ["unavailable", "rejected", "invalid_credentials", "not_supported"] },
        providerCodes: { array: "string" },
      },
    },
  ],
};

// email
const emailStatus = {
  enum: ["pending", "sending", "sent", "failed", "unknown", "cancelled"],
} as const;
const emailMailbox: Shape<Admin.AdminEmailMailbox> = {
  object: { address: "string", displayName: { nullable: "string" } },
};
const emailStatusResult: Shape<AdminEmailStatus> = {
  object: {
    configured: "boolean",
    providerCode: { nullable: "string" },
    from: { nullable: emailMailbox },
    replyTo: { nullable: emailMailbox },
    since: "string",
    counts: {
      object: {
        pending: "integer",
        sending: "integer",
        sent: "integer",
        failed: "integer",
        unknown: "integer",
        cancelled: "integer",
      },
    },
    queueDepth: "integer",
    oldestPendingAt: { nullable: "string" },
    errorCodes: { array: { object: { code: "string", count: "integer" } } },
  },
};
const emailMessage: Shape<AdminEmailMessage> = {
  object: {
    id: "string",
    templateKey: "string",
    templateVersion: "integer",
    locale: "string",
    to: "string",
    recipientKind: { enum: ["customer", "guest", "admin"] },
    customerId: { nullable: "string" },
    orderId: { nullable: "string" },
    adminUserId: { nullable: "string" },
    status: emailStatus,
    attempts: "integer",
    nextAttemptAt: "string",
    leaseUntil: { nullable: "string" },
    deadlineAt: "string",
    providerCode: { nullable: "string" },
    providerMessageId: { nullable: "string" },
    lastErrorCode: { nullable: "string" },
    resendOf: { nullable: "string" },
    createdByAdminId: { nullable: "string" },
    createdAt: "string",
    sentAt: { nullable: "string" },
    updatedAt: "string",
    canCancel: "boolean",
    canResend: "boolean",
  },
};
const emailMessageDetail: Shape<AdminEmailMessageDetail> = {
  object: { ...emailMessage.object, variables: json },
};
const emailMessageList: Shape<AdminEmailMessageList> = paginated(emailMessage);
const emailMessageId: Shape<AdminEmailMessageId> = { object: { messageId: "string" } };
const emailTemplateList: Shape<AdminEmailTemplateList> = {
  object: {
    items: {
      array: {
        object: {
          key: "string",
          version: "integer",
          category: { enum: ["account", "order"] },
          locales: { array: "string" },
        },
      },
    },
  },
};
const emailPreview: Shape<AdminEmailPreview> = {
  object: {
    key: "string",
    version: "integer",
    category: { enum: ["account", "order"] },
    locale: "string",
    subject: "string",
    html: "string",
    text: "string",
  },
};

// brands, categories
const brand: Shape<AdminBrand> = {
  object: {
    id: "string",
    slug: "string",
    name: localized,
    description: { nullable: localized },
    logoUrl: { nullable: "string" },
    createdAt: "string",
    updatedAt: "string",
  },
};
const brandList: Shape<AdminBrandList> = paginated(brand);
const category: Shape<AdminCategory> = {
  object: {
    id: "string",
    parentId: { nullable: "string" },
    slug: "string",
    name: localized,
    description: { nullable: localized },
    position: "integer",
    isActive: "boolean",
    createdAt: "string",
    updatedAt: "string",
  },
};
const categoryList: Shape<AdminCategoryList> = paginated(category);

// options
const option: Shape<AdminOption> = {
  object: {
    id: "string",
    code: "string",
    name: localized,
    createdAt: "string",
    updatedAt: "string",
  },
};
const optionValue: Shape<AdminOptionValue> = {
  object: {
    id: "string",
    optionId: "string",
    code: "string",
    label: localized,
    position: "integer",
    createdAt: "string",
    updatedAt: "string",
  },
};
const optionWithValues: Shape<AdminOptionWithValues> = {
  object: { ...option.object, values: { array: optionValue } },
};
const optionList: Shape<AdminOptionList> = paginated(option);

// product types
const level = { enum: ["product", "variant"] } as const;
const productType: Shape<AdminProductType> = {
  object: {
    id: "string",
    code: "string",
    name: localized,
    requiresShipping: "boolean",
    createdAt: "string",
    updatedAt: "string",
  },
};
const productTypeList: Shape<AdminProductTypeList> = paginated(productType);
const typeAttributeAssignment: Shape<AdminProductTypeAttributeAssignment> = {
  object: {
    productTypeId: "string",
    attributeId: "string",
    attributeCode: "string",
    level,
    isRequired: "boolean",
    position: "integer",
    createdAt: "string",
  },
};
const typeOptionAssignment: Shape<AdminProductTypeOptionAssignment> = {
  object: {
    productTypeId: "string",
    optionId: "string",
    optionCode: "string",
    position: "integer",
    createdAt: "string",
  },
};
const productTypeDetail: Shape<AdminProductTypeDetail> = {
  object: {
    ...productType.object,
    attributes: {
      array: { object: { ...typeAttributeAssignment.object, attribute: attributeWithOptions } },
    },
    options: { array: typeOptionAssignment },
  },
};

// prices
const price: Shape<AdminPrice> = {
  object: {
    id: "string",
    variantId: "string",
    currency: "string",
    amount: "integer",
    compareAtAmount: { nullable: "integer" },
    createdAt: "string",
    updatedAt: "string",
  },
};
const priceList: Shape<AdminPriceList> = { object: { items: { array: price } } };

// products and variants
const productSummary: Shape<AdminProductSummary> = {
  object: {
    id: "string",
    productTypeId: "string",
    brandId: { nullable: "string" },
    slug: "string",
    title: localized,
    description: { nullable: localized },
    status: productStatus,
    attributes: json,
    publishedAt: { nullable: "string" },
    createdAt: "string",
    updatedAt: "string",
  },
};
const productList: Shape<AdminProductList> = paginated(productSummary);
const variant: Shape<AdminVariant> = {
  object: {
    id: "string",
    sku: "string",
    barcode: { nullable: "string" },
    title: { nullable: localized },
    optionSignature: "string",
    isDefault: "boolean",
    isActive: "boolean",
    trackInventory: "boolean",
    allowBackorder: "boolean",
    attributes: json,
    position: "integer",
    optionValues: {
      array: {
        object: {
          optionId: "string",
          optionCode: "string",
          optionValueId: "string",
          valueCode: "string",
        },
      },
    },
    createdAt: "string",
    updatedAt: "string",
  },
};
const variantList: Shape<AdminVariantList> = paginated(variant);
const generateResult: Shape<GenerateVariantsResult> = {
  object: { created: "integer", skipped: "integer", variants: { array: variant } },
};
const product: Shape<AdminProduct> = {
  object: {
    ...productSummary.object,
    categories: {
      array: { object: { categoryId: "string", isPrimary: "boolean", position: "integer" } },
    },
    media: {
      array: {
        object: {
          id: "string",
          url: "string",
          alt: { nullable: localized },
          position: "integer",
          optionId: { nullable: "string" },
          optionValueId: { nullable: "string" },
          createdAt: "string",
          updatedAt: "string",
        },
      },
    },
    variants: { array: variant },
    options: {
      array: {
        object: {
          optionId: "string",
          optionCode: "string",
          position: "integer",
          values: {
            array: {
              object: { optionValueId: "string", valueCode: "string", position: "integer" },
            },
          },
        },
      },
    },
  },
};

// ------------------------------------------------------------ request bodies

const uuid = "string";
const body = {
  login: { object: { email: "string", password: "string" } } satisfies Shape<Admin.AdminLoginBody>,
  changePassword: {
    object: { currentPassword: "string", newPassword: "string" },
  } satisfies Shape<Admin.AdminChangePasswordBody>,
  createUser: {
    object: { email: "string", role, password: "string" },
  } satisfies Shape<Admin.CreateAdminUserBody>,
  updateUser: {
    object: { role: { optional: role }, isActive: { optional: "boolean" } },
  } satisfies Shape<Admin.UpdateAdminUserBody>,
  resetUserPassword: {
    object: { newPassword: "string" },
  } satisfies Shape<Admin.ResetAdminUserPasswordBody>,
  updateCustomer: {
    object: { isActive: "boolean" },
  } satisfies Shape<Admin.UpdateAdminCustomerBody>,
  adjustInventory: {
    object: {
      locationId: { optional: uuid },
      delta: { optional: "number" },
      setOnHand: { optional: "number" },
      kind: { enum: ["receipt", "adjustment", "return"] },
      reason: { optional: { nullable: "string" } },
      reference: { optional: { nullable: "string" } },
    },
  } satisfies Shape<Admin.AdjustInventoryBody>,
  cancelOrder: { object: { reason: "string" } } satisfies Shape<Admin.CancelAdminOrderBody>,
  createShipment: {
    object: {
      weightGrams: "integer",
      lengthMm: "integer",
      widthMm: "integer",
      heightMm: "integer",
      description: "string",
      declaredValue: { optional: moneyInput },
      payer: { optional: { enum: ["sender", "recipient"] } },
    },
  } satisfies Shape<Admin.CreateAdminShipmentBody>,
  markOrderPaid: {
    object: { reference: "string", amount: moneyInput },
  } satisfies Shape<Admin.MarkAdminOrderPaidBody>,
  createAttribute: {
    object: {
      code: "string",
      name: localized,
      description: { optional: localized },
      inputType,
      isLocalized: { optional: "boolean" },
      unit: { optional: { nullable: "string" } },
      validation: { optional: json },
      isFilterable: { optional: "boolean" },
      isSearchable: { optional: "boolean" },
      isVisibleOnStorefront: { optional: "boolean" },
      isComparable: { optional: "boolean" },
      isSortable: { optional: "boolean" },
      isInternal: { optional: "boolean" },
    },
  } satisfies Shape<Admin.CreateAdminAttributeBody>,
  updateAttribute: {
    object: {
      name: { optional: localized },
      description: { optional: { nullable: localized } },
      inputType: { optional: inputType },
      isLocalized: { optional: "boolean" },
      unit: { optional: { nullable: "string" } },
      validation: { optional: json },
      isFilterable: { optional: "boolean" },
      isSearchable: { optional: "boolean" },
      isVisibleOnStorefront: { optional: "boolean" },
      isComparable: { optional: "boolean" },
      isSortable: { optional: "boolean" },
      isInternal: { optional: "boolean" },
    },
  } satisfies Shape<Admin.UpdateAdminAttributeBody>,
  createAttributeOption: {
    object: { code: "string", label: localized, position: { optional: "integer" } },
  } satisfies Shape<Admin.CreateAdminAttributeOptionBody>,
  updateAttributeOption: {
    object: { label: { optional: localized }, position: { optional: "integer" } },
  } satisfies Shape<Admin.UpdateAdminAttributeOptionBody>,
  createShippingMethod: {
    object: {
      code: "string",
      title: localized,
      description: { optional: localized },
      kind: shippingKind,
      providerCode: { optional: { nullable: "string" } },
      providerService: { optional: { nullable: "string" } },
      pricing: shippingPricing,
      countryCodes: { array: "string" },
      isActive: { optional: "boolean" },
      position: { optional: "integer" },
    },
  } satisfies Shape<Admin.CreateAdminShippingMethodBody>,
  updateShippingMethod: {
    object: {
      title: { optional: localized },
      description: { optional: { nullable: localized } },
      kind: { optional: shippingKind },
      providerCode: { optional: { nullable: "string" } },
      providerService: { optional: { nullable: "string" } },
      pricing: { optional: shippingPricing },
      countryCodes: { optional: { array: "string" } },
      isActive: { optional: "boolean" },
      position: { optional: "integer" },
    },
  } satisfies Shape<Admin.UpdateAdminShippingMethodBody>,
  putShippingProviderSettings: {
    object: { settings: json },
  } satisfies Shape<Admin.PutAdminShippingProviderSettingsBody>,
  sendTestEmail: {
    object: { locale: { optional: "string" } },
  } satisfies Shape<Admin.SendAdminTestEmailBody>,
  createBrand: {
    object: {
      name: localized,
      description: { optional: localized },
      logoUrl: { optional: "string" },
      slug: { optional: "string" },
    },
  } satisfies Shape<Admin.CreateAdminBrandBody>,
  updateBrand: {
    object: {
      name: { optional: localized },
      description: { optional: { nullable: localized } },
      logoUrl: { optional: { nullable: "string" } },
      slug: { optional: "string" },
    },
  } satisfies Shape<Admin.UpdateAdminBrandBody>,
  createCategory: {
    object: {
      name: localized,
      description: { optional: localized },
      slug: { optional: "string" },
      parentId: { optional: { nullable: uuid } },
      position: { optional: "integer" },
      isActive: { optional: "boolean" },
    },
  } satisfies Shape<Admin.CreateAdminCategoryBody>,
  updateCategory: {
    object: {
      name: { optional: localized },
      description: { optional: { nullable: localized } },
      slug: { optional: "string" },
      isActive: { optional: "boolean" },
    },
  } satisfies Shape<Admin.UpdateAdminCategoryBody>,
  moveCategory: {
    object: { parentId: { nullable: uuid }, position: { optional: "integer" } },
  } satisfies Shape<Admin.MoveAdminCategoryBody>,
  createOption: {
    object: { code: "string", name: localized },
  } satisfies Shape<Admin.CreateAdminOptionBody>,
  updateOption: {
    object: { name: { optional: localized } },
  } satisfies Shape<Admin.UpdateAdminOptionBody>,
  createOptionValue: {
    object: { code: "string", label: localized, position: { optional: "integer" } },
  } satisfies Shape<Admin.CreateAdminOptionValueBody>,
  updateOptionValue: {
    object: { label: { optional: localized }, position: { optional: "integer" } },
  } satisfies Shape<Admin.UpdateAdminOptionValueBody>,
  createProductType: {
    object: { code: "string", name: localized, requiresShipping: { optional: "boolean" } },
  } satisfies Shape<Admin.CreateAdminProductTypeBody>,
  updateProductType: {
    object: { name: { optional: localized }, requiresShipping: { optional: "boolean" } },
  } satisfies Shape<Admin.UpdateAdminProductTypeBody>,
  putProductTypeAttribute: {
    object: {
      level,
      isRequired: { optional: "boolean" },
      position: { optional: "integer" },
    },
  } satisfies Shape<Admin.PutProductTypeAttributeBody>,
  putProductTypeOption: {
    object: { position: { optional: "integer" } },
  } satisfies Shape<Admin.PutProductTypeOptionBody>,
  putProductPrices: {
    object: {
      items: {
        array: {
          object: {
            variantId: uuid,
            currency: "string",
            amount: "number",
            compareAtAmount: { optional: { nullable: "number" } },
          },
        },
      },
    },
  } satisfies Shape<Admin.PutProductPricesBody>,
  putVariantPrice: {
    object: { amount: "number", compareAtAmount: { optional: { nullable: "number" } } },
  } satisfies Shape<Admin.PutVariantPriceBody>,
  createProduct: {
    object: {
      productTypeId: uuid,
      title: localized,
      description: { optional: localized },
      brandId: { optional: { nullable: uuid } },
      slug: { optional: "string" },
      attributes: { optional: json },
    },
  } satisfies Shape<Admin.CreateAdminProductBody>,
  updateProduct: {
    object: {
      productTypeId: { optional: uuid },
      title: { optional: localized },
      description: { optional: { nullable: localized } },
      brandId: { optional: { nullable: uuid } },
      slug: { optional: "string" },
      attributes: { optional: json },
    },
  } satisfies Shape<Admin.UpdateAdminProductBody>,
  putProductCategories: {
    object: {
      categories: { array: { object: { categoryId: uuid, position: { optional: "integer" } } } },
      primaryCategoryId: { optional: { nullable: uuid } },
    },
  } satisfies Shape<Admin.PutProductCategoriesBody>,
  putProductMedia: {
    object: {
      media: {
        array: {
          object: {
            url: "string",
            alt: { optional: { nullable: localized } },
            position: { optional: "integer" },
            optionId: { optional: { nullable: uuid } },
            optionValueId: { optional: { nullable: uuid } },
          },
        },
      },
    },
  } satisfies Shape<Admin.PutProductMediaBody>,
  putProductOptions: {
    object: { options: { array: { object: { optionId: uuid, valueIds: { array: uuid } } } } },
  } satisfies Shape<Admin.PutProductOptionsBody>,
  addProductOptionValue: {
    object: { valueId: uuid },
  } satisfies Shape<Admin.AddProductOptionValueBody>,
  createVariant: {
    object: {
      optionValueIds: { array: uuid },
      sku: { optional: "string" },
      barcode: { optional: { nullable: "string" } },
      attributes: { optional: json },
      isActive: { optional: "boolean" },
      trackInventory: { optional: "boolean" },
      allowBackorder: { optional: "boolean" },
    },
  } satisfies Shape<Admin.CreateAdminVariantBody>,
  updateVariant: {
    object: {
      sku: { optional: "string" },
      barcode: { optional: { nullable: "string" } },
      attributes: { optional: json },
      isActive: { optional: "boolean" },
      trackInventory: { optional: "boolean" },
      allowBackorder: { optional: "boolean" },
      position: { optional: "integer" },
      isDefault: { optional: "boolean" },
    },
  } satisfies Shape<Admin.UpdateAdminVariantBody>,
} as const;

// ------------------------------------------------- per-operation shape tables

/** Success body per operation, typed by what the client function really returns. */
type DataOf<N extends AdminOperationName> = Extract<
  Awaited<ReturnType<AdminClient[N]>>,
  { ok: true }
>["data"];

/** `[string, string]` for a path with two placeholders: the path parameters come first in every client function. */
type Placeholders<P extends string> = P extends `${string}{${string}}${infer Rest}`
  ? [string, ...Placeholders<Rest>]
  : [];

/** The JSON body parameter of the client function; `never` for an operation whose body is not JSON. */
type JsonBodyOf<N extends AdminOperationName> =
  (typeof ADMIN_OPERATIONS)[N]["bodyKind"] extends "json"
    ? Parameters<AdminClient[N]> extends [
        ...Placeholders<(typeof ADMIN_OPERATIONS)[N]["path"]>,
        infer B,
        ...unknown[],
      ]
      ? B
      : never
    : never;

/** `null` without a body, `"binary"` for raw bytes (checked against the `string`/`binary` schema), a `Shape` for JSON. */
type RequestShapeOf<N extends AdminOperationName> =
  (typeof ADMIN_OPERATIONS)[N]["bodyKind"] extends "none"
    ? null
    : (typeof ADMIN_OPERATIONS)[N]["bodyKind"] extends "binary"
      ? "binary"
      : Shape<JsonBodyOf<N>>;

/** `"pdf"` for the one file answer (the label `Blob`, checked against the `string`/`binary` schema), a `Shape` for JSON. */
type ResponseShapeOf<N extends AdminOperationName> = N extends "getShipmentLabel"
  ? "pdf"
  : Shape<DataOf<N>>;

const RESPONSE_SHAPES: { [N in AdminOperationName]: ResponseShapeOf<N> } = {
  login: loginResult,
  logout: "none",
  getMe: me,
  changePassword: "none",
  listUsers: adminUserList,
  createUser: adminUser,
  getUser: adminUser,
  updateUser: adminUser,
  resetUserPassword: "none",
  getConfig: config,
  uploadMedia: mediaUpload,
  listCustomers: customerList,
  getCustomer: customer,
  updateCustomer: customer,
  unlockCustomer: "none",
  getProductInventory: productInventory,
  getVariantInventory: variantInventory,
  adjustInventory: adjustInventoryResult,
  listStockMovements: stockMovementList,
  listReservations: reservationList,
  listLocations: locationList,
  listOrders: orderList,
  getOrder: order,
  cancelOrder: order,
  markOrderPaid: order,
  markOrderFulfilled: order,
  listShipments: shipmentList,
  createShipment: shipmentCreateResult,
  reconcileShipment: shipment,
  cancelShipment: shipment,
  refreshShipment: shipment,
  getShipmentLabel: "pdf",
  createAttribute: attribute,
  listAttributes: attributeList,
  getAttribute: attributeWithOptions,
  updateAttribute: attribute,
  deleteAttribute: "none",
  createAttributeOption: attributeOption,
  updateAttributeOption: attributeOption,
  deleteAttributeOption: "none",
  createShippingMethod: shippingMethod,
  listShippingMethods: shippingMethodList,
  getShippingMethod: shippingMethod,
  updateShippingMethod: shippingMethod,
  deleteShippingMethod: "none",
  getShippingProviderSettings: shippingProviderSettings,
  putShippingProviderSettings: shippingProviderSettings,
  checkShippingProvider: shippingProviderCheck,
  getEmailStatus: emailStatusResult,
  sendTestEmail: emailMessageId,
  listEmailMessages: emailMessageList,
  getEmailMessage: emailMessageDetail,
  resendEmailMessage: emailMessageId,
  cancelEmailMessage: emailMessage,
  listEmailTemplates: emailTemplateList,
  previewEmailTemplate: emailPreview,
  createBrand: brand,
  listBrands: brandList,
  getBrand: brand,
  updateBrand: brand,
  deleteBrand: "none",
  createCategory: category,
  listCategories: categoryList,
  getCategory: category,
  updateCategory: category,
  deleteCategory: "none",
  moveCategory: category,
  createOption: option,
  listOptions: optionList,
  getOption: optionWithValues,
  updateOption: option,
  deleteOption: "none",
  createOptionValue: optionValue,
  updateOptionValue: optionValue,
  deleteOptionValue: "none",
  createProductType: productType,
  listProductTypes: productTypeList,
  getProductType: productTypeDetail,
  updateProductType: productType,
  deleteProductType: "none",
  putProductTypeAttribute: typeAttributeAssignment,
  removeProductTypeAttribute: "none",
  putProductTypeOption: typeOptionAssignment,
  removeProductTypeOption: "none",
  listVariantPrices: priceList,
  listProductPrices: priceList,
  putProductPrices: priceList,
  putVariantPrice: price,
  deleteVariantPrice: "none",
  createProduct: product,
  listProducts: productList,
  getProduct: product,
  updateProduct: product,
  deleteProduct: "none",
  publishProduct: product,
  unpublishProduct: product,
  archiveProduct: product,
  restoreProduct: product,
  putProductCategories: product,
  putProductMedia: product,
  putProductOptions: product,
  addProductOptionValue: product,
  listVariants: variantList,
  createVariant: variant,
  generateVariants: generateResult,
  getVariant: variant,
  updateVariant: variant,
  deleteVariant: "none",
};

/** Request body per operation, typed by the body parameter of the client function; `null` where there is none. */
const REQUEST_SHAPES: { [N in AdminOperationName]: RequestShapeOf<N> } = {
  login: body.login,
  logout: null,
  getMe: null,
  changePassword: body.changePassword,
  listUsers: null,
  createUser: body.createUser,
  getUser: null,
  updateUser: body.updateUser,
  resetUserPassword: body.resetUserPassword,
  getConfig: null,
  uploadMedia: "binary",
  listCustomers: null,
  getCustomer: null,
  updateCustomer: body.updateCustomer,
  unlockCustomer: null,
  getProductInventory: null,
  getVariantInventory: null,
  adjustInventory: body.adjustInventory,
  listStockMovements: null,
  listReservations: null,
  listLocations: null,
  listOrders: null,
  getOrder: null,
  cancelOrder: body.cancelOrder,
  markOrderPaid: body.markOrderPaid,
  markOrderFulfilled: null,
  listShipments: null,
  createShipment: body.createShipment,
  reconcileShipment: null,
  cancelShipment: null,
  refreshShipment: null,
  getShipmentLabel: null,
  createAttribute: body.createAttribute,
  listAttributes: null,
  getAttribute: null,
  updateAttribute: body.updateAttribute,
  deleteAttribute: null,
  createAttributeOption: body.createAttributeOption,
  updateAttributeOption: body.updateAttributeOption,
  deleteAttributeOption: null,
  createShippingMethod: body.createShippingMethod,
  listShippingMethods: null,
  getShippingMethod: null,
  updateShippingMethod: body.updateShippingMethod,
  deleteShippingMethod: null,
  getShippingProviderSettings: null,
  putShippingProviderSettings: body.putShippingProviderSettings,
  checkShippingProvider: null,
  getEmailStatus: null,
  sendTestEmail: body.sendTestEmail,
  listEmailMessages: null,
  getEmailMessage: null,
  resendEmailMessage: null,
  cancelEmailMessage: null,
  listEmailTemplates: null,
  previewEmailTemplate: null,
  createBrand: body.createBrand,
  listBrands: null,
  getBrand: null,
  updateBrand: body.updateBrand,
  deleteBrand: null,
  createCategory: body.createCategory,
  listCategories: null,
  getCategory: null,
  updateCategory: body.updateCategory,
  deleteCategory: null,
  moveCategory: body.moveCategory,
  createOption: body.createOption,
  listOptions: null,
  getOption: null,
  updateOption: body.updateOption,
  deleteOption: null,
  createOptionValue: body.createOptionValue,
  updateOptionValue: body.updateOptionValue,
  deleteOptionValue: null,
  createProductType: body.createProductType,
  listProductTypes: null,
  getProductType: null,
  updateProductType: body.updateProductType,
  deleteProductType: null,
  putProductTypeAttribute: body.putProductTypeAttribute,
  removeProductTypeAttribute: null,
  putProductTypeOption: body.putProductTypeOption,
  removeProductTypeOption: null,
  listVariantPrices: null,
  listProductPrices: null,
  putProductPrices: body.putProductPrices,
  putVariantPrice: body.putVariantPrice,
  deleteVariantPrice: null,
  createProduct: body.createProduct,
  listProducts: null,
  getProduct: null,
  updateProduct: body.updateProduct,
  deleteProduct: null,
  publishProduct: null,
  unpublishProduct: null,
  archiveProduct: null,
  restoreProduct: null,
  putProductCategories: body.putProductCategories,
  putProductMedia: body.putProductMedia,
  putProductOptions: body.putProductOptions,
  addProductOptionValue: body.addProductOptionValue,
  listVariants: null,
  createVariant: body.createVariant,
  generateVariants: null,
  getVariant: null,
  updateVariant: body.updateVariant,
  deleteVariant: null,
};

// ------------------------------------------------------------------- tests

type DocumentOperation = OpenApiOperation & { "x-fluxkit-permission"?: string };

function adminOperations(): Map<string, DocumentOperation> {
  const found = new Map<string, DocumentOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith("/admin")) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (method === "parameters") continue;
      found.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return found;
}

const operationFor = (name: AdminOperationName): DocumentOperation => {
  const spec = ADMIN_OPERATIONS[name];
  const operation = adminOperations().get(`${spec.method} ${spec.path}`);
  if (operation === undefined)
    throw new Error(`${name}: ${spec.method} ${spec.path} is not in openapi.json`);
  return operation;
};

const names = Object.keys(ADMIN_OPERATIONS) as AdminOperationName[];
const KNOWN_PERMISSIONS: readonly AdminOperationPermission[] = [
  "catalog.read",
  "catalog.write",
  "catalog.publish",
  "users.manage",
  "orders.read",
  "orders.write",
  "customers.read",
  "customers.write",
  "shipping.manage",
  "email.manage",
  "payments.refund",
  "authenticated",
  "public",
  "denied",
];

describe("ADMIN_OPERATIONS against docs/api/openapi.json", () => {
  it("covers exactly the operations under /admin: every one, and nothing extra", () => {
    const documented = [...adminOperations().keys()].sort();
    const implemented = names
      .map((name) => `${ADMIN_OPERATIONS[name].method} ${ADMIN_OPERATIONS[name].path}`)
      .sort();
    expect(implemented).toEqual(documented);
    expect(documented.length).toBeGreaterThan(0);
  });

  it("only the media upload takes raw bytes, with catalog.write; every other body is JSON", () => {
    const binary = names.filter((name) => ADMIN_OPERATIONS[name].bodyKind === "binary");
    expect(binary).toEqual(["uploadMedia"]);
    expect(ADMIN_OPERATIONS.uploadMedia).toMatchObject({
      method: "POST",
      path: "/admin/media/uploads",
      successStatuses: [201],
      permission: "catalog.write",
      hasBody: true,
      bodyKind: "binary",
    });
  });

  it("only the shipment label answers a file (a PDF), with orders.read; every other success is JSON", () => {
    const files = names.filter((name) => ADMIN_OPERATIONS[name].responseKind === "pdf");
    expect(files).toEqual(["getShipmentLabel"]);
    expect(ADMIN_OPERATIONS.getShipmentLabel).toMatchObject({
      method: "GET",
      path: "/admin/orders/{id}/shipments/{shipmentId}/label",
      successStatuses: [200],
      permission: "orders.read",
      bodyKind: "none",
      responseKind: "pdf",
    });
  });

  it("shares no operation with the store table and lists no store route", () => {
    const store = new Set(Object.values(OPERATIONS).map((s) => `${s.method} ${s.path}`));
    for (const name of names) {
      const spec = ADMIN_OPERATIONS[name];
      expect(store.has(`${spec.method} ${spec.path}`)).toBe(false);
      expect(spec.path.startsWith("/admin/")).toBe(true);
    }
  });

  it("every operation name is also a client function name, and the response and request tables have a row each", () => {
    expect(Object.keys(RESPONSE_SHAPES).sort()).toEqual([...names].sort());
    expect(Object.keys(REQUEST_SHAPES).sort()).toEqual([...names].sort());
  });

  it.each(names)("%s: statuses, parameters, header, permission and content types match", (name) => {
    const spec = ADMIN_OPERATIONS[name];
    const operation = operationFor(name);
    const parameters = operation.parameters ?? [];

    expect(
      Object.keys(operation.responses)
        .filter((status) => status.startsWith("2"))
        .sort(),
    ).toEqual(spec.successStatuses.map(String).sort());

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
    expect(headerNames).toEqual(spec.method === "GET" ? [] : [CSRF_HEADER]);
    for (const header of parameters.filter((p) => p.in === "header"))
      expect(header.required).toBe(true);

    expect(operation["x-fluxkit-permission"]).toBe(spec.permission);
    expect(KNOWN_PERMISSIONS).toContain(spec.permission);

    expect(operation.requestBody !== undefined).toBe(spec.bodyKind !== "none");
    expect(spec.hasBody).toBe(spec.bodyKind !== "none");
    if (operation.requestBody !== undefined) {
      expect(Object.keys(operation.requestBody.content)).toEqual([
        spec.bodyKind === "binary" ? "application/octet-stream" : "application/json",
      ]);
      expect(operation.requestBody.required).toBe(true);
    }

    for (const [status, response] of Object.entries(operation.responses)) {
      const content = Object.keys(response.content ?? {});
      if (status.startsWith("2")) {
        const success = spec.responseKind === "pdf" ? "application/pdf" : "application/json";
        expect(content, `${name} ${status}`).toEqual(status === "204" ? [] : [success]);
      } else {
        expect(content, `${name} ${status}`).toEqual(["application/problem+json"]);
        expect(response.content?.["application/problem+json"]?.schema?.$ref).toBe(
          "#/components/schemas/ProblemDetailsDoc",
        );
      }
    }
  });

  it.each(names)("%s: the response and request types match the schemas", (name) => {
    const spec = ADMIN_OPERATIONS[name];
    const operation = operationFor(name);
    for (const status of spec.successStatuses) {
      const schema = operation.responses[String(status)]?.content?.["application/json"]?.schema;
      const shape = RESPONSE_SHAPES[name] as ShapeNode | "pdf";
      if (status === 204) {
        expect(shape).toBe("none");
        continue;
      }
      if (shape === "pdf") {
        expect(spec.responseKind).toBe("pdf");
        expect(
          operation.responses[String(status)]?.content?.["application/pdf"]?.schema,
        ).toMatchObject({ type: "string", format: "binary" });
        continue;
      }
      expect(schema, `${name} ${status} schema`).toBeDefined();
      if (schema !== undefined) expect(compareShape(shape, schema, document)).toEqual([]);
    }
    const bodyShape = REQUEST_SHAPES[name] as ShapeNode | "binary" | null;
    if (bodyShape === null) {
      expect(operation.requestBody).toBeUndefined();
    } else if (bodyShape === "binary") {
      expect(spec.bodyKind).toBe("binary");
      const schema = operation.requestBody?.content["application/octet-stream"]?.schema;
      expect(schema).toMatchObject({ type: "string", format: "binary" });
    } else {
      const schema = operation.requestBody?.content["application/json"]?.schema;
      expect(schema).toBeDefined();
      if (schema !== undefined) expect(compareShape(bodyShape, schema, document)).toEqual([]);
    }
  });
});

describe("the comparison fails when an admin type drifts from the contract", () => {
  const productSchema = () => {
    const schema = structuredClone(
      document.paths["/admin/products/{id}"]?.get?.responses["200"]?.content?.["application/json"]
        ?.schema,
    );
    if (schema === undefined) throw new Error("product schema missing");
    return schema;
  };
  const configSchema = () => {
    const schema = structuredClone(
      document.paths["/admin/config"]?.get?.responses["200"]?.content?.["application/json"]?.schema,
    );
    if (schema === undefined) throw new Error("config schema missing");
    return schema;
  };

  it("passes on the real document (control)", () => {
    expect(compareShape(product as ShapeNode, productSchema(), document)).toEqual([]);
    expect(compareShape(config as ShapeNode, configSchema(), document)).toEqual([]);
  });

  it("detects a changed, removed or added field", () => {
    const schema = configSchema();
    const exponent = schema.properties?.supportedCurrencies?.items?.properties?.exponent;
    if (exponent === undefined) throw new Error("exponent missing");
    exponent.type = "string";
    expect(compareShape(config as ShapeNode, schema, document).join("\n")).toContain(
      "supportedCurrencies[].exponent: type is string in openapi, integer in types",
    );

    const removed = configSchema();
    delete removed.properties?.lowStockThreshold;
    expect(compareShape(config as ShapeNode, removed, document).join("\n")).toContain(
      "lowStockThreshold: in the type, not in openapi",
    );

    const added = configSchema();
    if (added.properties) added.properties.surprise = { type: "string" };
    expect(compareShape(config as ShapeNode, added, document).join("\n")).toContain(
      "surprise: in openapi, not in the type",
    );
  });

  it("detects nullable, required and enum changes", () => {
    const nullable = productSchema();
    const brandId = nullable.properties?.brandId;
    if (brandId === undefined) throw new Error("brandId missing");
    brandId.nullable = false;
    expect(compareShape(product as ShapeNode, nullable, document).join("\n")).toContain(
      "nullable differs",
    );

    const required = productSchema();
    required.required = (required.required ?? []).filter((key) => key !== "status");
    expect(compareShape(product as ShapeNode, required, document).join("\n")).toContain(
      "required in the type, optional in openapi",
    );

    const enumDrift = productSchema();
    const status = enumDrift.properties?.status;
    if (status === undefined) throw new Error("status missing");
    status.enum = ["draft", "active"];
    expect(compareShape(product as ShapeNode, enumDrift, document).join("\n")).toContain(
      "enum values differ",
    );
  });

  it("detects a boolean literal that drifts (the shipping check result)", () => {
    const schema = structuredClone(
      document.paths["/admin/shipping/providers/{code}/check"]?.post?.responses["200"]?.content?.[
        "application/json"
      ]?.schema,
    );
    if (schema === undefined) throw new Error("check schema missing");
    expect(compareShape(shippingProviderCheck as ShapeNode, schema, document)).toEqual([]);
    const ok = schema.oneOf?.[0]?.properties?.ok;
    if (ok === undefined) throw new Error("ok missing");
    expect(compareShape({ literal: true }, ok, document)).toEqual([]);
    (ok as { enum?: unknown }).enum = [false];
    expect(compareShape({ literal: true }, ok, document).join("\n")).toContain(
      "openapi is not the boolean literal true",
    );
  });

  it("an attribute value schema that gains a constraint no longer matches 'any JSON'", () => {
    const schema = productSchema();
    const attributes = schema.properties?.attributes;
    if (attributes === undefined) throw new Error("attributes missing");
    attributes.additionalProperties = { type: "string" };
    expect(compareShape(product as ShapeNode, schema, document).join("\n")).toContain(
      "openapi constrains the value",
    );
  });
});
