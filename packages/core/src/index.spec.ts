import { describe, expect, it } from "vitest";
import * as auth from "./auth/index.js";
import * as cart from "./cart/index.js";
import * as catalog from "./catalog/index.js";
import * as email from "./email/index.js";
import * as core from "./index.js";
import * as inventory from "./inventory/index.js";
import * as media from "./media/index.js";
import * as orders from "./orders/index.js";
import * as payments from "./payments/index.js";
import * as pricing from "./pricing/index.js";
import * as search from "./search/index.js";
import * as shipping from "./shipping/index.js";

describe("public entry point", () => {
  it("exports the catalog domain functions", () => {
    const functions = [
      "validateI18nText",
      "resolveText",
      "resolveTextWithFallback",
      "validateAttributeValues",
      "parseAttributeValidation",
      "computeOptionSignature",
      "generateVariants",
      "checkVariantInvariants",
      "normalizeSku",
      "validateSku",
      "proposeSku",
      "proposeSkus",
      "validateSlug",
      "slugify",
      "transliterateUkrainian",
      "generateUniqueSlug",
      "wouldCreateCycle",
      "subtreeHeight",
      "depthOf",
      "validateMove",
      "validateNewNode",
      "validateTree",
      "canTransition",
      "canHardDelete",
      "publishPreconditions",
      "decideCodeChange",
      "decideProductOptionChange",
      "hasPermission",
      "permissionsOf",
      "validatePassword",
      "validateEmail",
      "normalizeEmail",
      "registerFailedLogin",
      "evaluateSession",
      "decideUserChange",
      "isSupportedCurrency",
      "exponentOf",
      "createMoney",
      "addMoney",
      "subtractMoney",
      "multiplyByQuantity",
      "compareMoney",
      "negateMoney",
      "isZero",
      "percentageOf",
      "toDecimalString",
      "parseDecimalString",
      "validatePrice",
      "pickSellablePrice",
      "availabilityOf",
      "decideReserve",
      "decideRelease",
      "decideCommit",
      "decideExpire",
      "decideAdjustment",
      "decideExtend",
      "addLine",
      "setLineQuantity",
      "removeLine",
      "mergeCarts",
      "priceCart",
      "computeOrderTotals",
      "buildOrderLine",
      "decideTransition",
      "stockEffectOf",
      "isTerminalStatus",
      "formatOrderNumber",
      "parseOrderNumber",
      "normalizePhone",
      "validatePersonName",
      "validateAddress",
      "shippingAddressRequired",
      "orderExpiresAt",
      "reservationExpiresAt",
      "guestAccessExpiresAt",
      "isGuestAccessValid",
    ] as const;
    for (const name of functions) {
      expect(typeof core[name], name).toBe("function");
    }
  });

  it("exports the limits", () => {
    expect(core.CATALOG_LIMITS.maxVariantsPerProduct).toBe(250);
    expect(core.TEXT_LIMITS.sku).toBe(64);
    expect(core.MAX_AMOUNT).toBe(1_000_000_000_000);
    expect(core.MAX_QUANTITY).toBe(1_000_000);
    expect(core.CURRENCIES.UAH).toBe(2);
    expect(core.MAX_ON_HAND).toBe(1_000_000_000);
    expect(core.MAX_CART_LINES).toBe(100);
    expect(core.MAX_LINE_QUANTITY).toBe(999);
    expect(core.ORDER_STATUSES).toHaveLength(5);
    expect(core.ORDER_ACTORS).toHaveLength(4);
    expect(core.ORDER_NUMBER_BYTES).toBe(5);
    expect(core.ORDER_PAYMENT_TTL_MINUTES.default).toBe(30);
    expect(core.RESERVATION_GRACE_MINUTES).toBe(10);
    expect(core.GUEST_ACCESS_DAYS.default).toBe(90);
  });

  it("exports the media rules and limits", () => {
    for (const name of [
      "sniffImageType",
      "checkDimensions",
      "isMediaKey",
      "keyToRelativePath",
      "generateMediaKey",
    ] as const) {
      expect(typeof core[name], name).toBe("function");
    }
    expect(core.MEDIA_LIMITS.maxSide).toBe(12_000);
    expect(core.MEDIA_STORAGE_PORT).toBe("fluxkit:media-storage-port");
  });

  it("exports the shipping rules, port constants and limits", () => {
    for (const name of [
      "validateShippingPricing",
      "decideShippingPrice",
      "buildShippingAdjustment",
      "decideMethodAvailability",
      "validateCountryCodes",
      "parseShippingSelection",
      "decideShippingRequirement",
      "checkSelectionForKind",
      "decideShipmentTransition",
      "isTerminalShipmentStatus",
      "isActiveShipmentStatus",
      "isTrackedShipmentStatus",
      "shipmentEventTypeFor",
      "buildShipmentEventPayload",
      "shippingProviderMetadata",
      "providerOk",
      "providerFailure",
    ] as const) {
      expect(typeof core[name], name).toBe("function");
    }
    expect(core.SHIPPING_PROVIDER_METADATA).toBe("fluxkit:shipping-provider");
    expect(core.SHIPMENT_STATUSES).toHaveLength(10);
    expect(core.SHIPPING_LIMITS.maxTiers).toBe(20);
  });

  it("exports the email rules, port constants and limits", () => {
    for (const name of [
      "validateEmailAddress",
      "validateDisplayName",
      "parseMailbox",
      "formatMailbox",
      "hasHeaderUnsafeCharacter",
      "validateSubject",
      "sanitizeSubject",
      "escapeHtml",
      "html",
      "unsafeRawHtml",
      "isSafeHtml",
      "authTokenExpiresAt",
      "customerAuthTokenMessage",
      "deriveCustomerAuthToken",
      "isCustomerAuthTokenFormat",
      "evaluateAuthToken",
      "decideEmailTransition",
      "isFinalEmailStatus",
      "emailRetentionDays",
      "nextEmailAttempt",
      "emailDeadlineAt",
      "isPastEmailDeadline",
      "emailProviderMetadata",
      "emailProviderOk",
      "emailProviderFailure",
      "validateOutgoingEmail",
      "checkEmailProviderContract",
      "emailTemplateMetadata",
      "isEmailTemplateKey",
      "isEmailLocale",
      "checkEmailTemplateDefinition",
      "checkEmailRenderOutput",
      "buildEmailDedupeKey",
    ] as const) {
      expect(typeof core[name], name).toBe("function");
    }
    expect(core.EMAIL_PROVIDER_METADATA).toBe("fluxkit:email-provider");
    expect(core.EMAIL_PROVIDER_PACKAGE_KIND).toBe("email");
    expect(core.EMAIL_TEMPLATE_METADATA).toBe("fluxkit:email-template");
    expect(core.EMAIL_MESSAGE_STATUSES).toHaveLength(6);
    expect(core.EMAIL_TEMPLATE_KEYS).toHaveLength(9);
    expect(core.EMAIL_LIMITS.subjectMaxLength).toBe(200);
    expect(core.EMAIL_DEADLINE_HOURS).toBe(12);
    expect(core.EMAIL_SEND_TIMEOUT_MS).toBe(10_000);
    expect(core.CUSTOMER_AUTH_TOKEN_LABEL).toBe("fluxkit:customer-auth-token:v1");
  });

  it("exports the payment rules, port constants and limits", () => {
    for (const name of [
      "paymentProviderMetadata",
      "paymentProviderOk",
      "paymentProviderFailure",
      "checkPaymentProviderContract",
      "providerPaymentFactProblems",
      "isProviderPaymentFact",
      "bindFact",
      "normalizeProviderFact",
      "decideOrderOutcome",
      "decidePaymentTransition",
      "decideRefundTransition",
      "isLivePaymentStatus",
      "isTerminalPaymentStatus",
      "isTerminalRefundStatus",
      "decideNewPaymentAttempt",
      "decideOrderPaymentGuard",
      "paymentStatusAfterCreate",
      "invoiceValidity",
      "decideExpiry",
      "remainingRefundable",
      "decideRefund",
      "refundStatusAfterCall",
      "decideRefundFromFact",
      "nextPaymentCheck",
      "buildProviderReference",
      "buildWebhookDedupeKey",
      "buildPollDedupeKey",
      "refundListCanonicalText",
      "buildPaymentLines",
      "buildPaymentEventPayload",
      "buildRefundEventPayload",
    ] as const) {
      expect(typeof core[name], name).toBe("function");
    }
    expect(core.PAYMENT_PROVIDER_METADATA).toBe("fluxkit:payment-provider");
    expect(core.PAYMENT_PROVIDER_PACKAGE_KIND).toBe("payment");
    expect(core.PAYMENT_STATUSES).toHaveLength(8);
    expect(core.REFUND_STATUSES).toHaveLength(5);
    expect(core.PAYMENT_PROVIDER_TIMEOUT_MS).toBe(10_000);
    expect(core.PAYMENT_EXPIRY_DEFERRAL.capMinutes).toBe(30);
    expect(core.PAYMENT_INVOICE_WINDOW.minimumMinutes).toBe(5);
  });

  it("does not export the internal guards of the payment rules", () => {
    for (const name of [
      "assertUuid",
      "assertPositiveMoney",
      "isPositiveMoney",
      "isUuid",
      "assertDate",
    ]) {
      expect(name in core, name).toBe(false);
    }
  });

  it("does not export the internal helpers of the email rules", () => {
    expect("codePointLengthUpTo" in core).toBe(false);
    expect("toBase64Url" in core).toBe(false);
  });

  it("exports the search rules and keeps the stemmer machinery and shape checks internal", () => {
    for (const name of [
      "parseSearchQuery",
      "normalizeSearchWords",
      "planTextQueries",
      "buildSearchFilter",
      "parseSelectionParams",
      "deriveFacetSpecs",
      "planSearchQueries",
      "validatePageRequest",
      "buildSearchDocuments",
      "deriveIndexSettings",
      "parseSearchSort",
      "engineSort",
      "stemToken",
      "prefixToken",
      "SEARCH_DOCUMENT_VERSION",
      "SEARCH_LIMITS",
    ]) {
      expect(name in core, name).toBe(true);
    }
    for (const name of [
      "stemUkrainian",
      "stemEnglish",
      "runStem",
      "hasControlCharacter",
      "UUID_PATTERN",
    ]) {
      expect(name in core, name).toBe(false);
    }
  });

  it("exports the new admin permissions", () => {
    for (const permission of [
      "orders.read",
      "orders.write",
      "customers.read",
      "customers.write",
      "shipping.manage",
      "email.manage",
      "payments.refund",
    ]) {
      expect(core.PERMISSIONS, permission).toContain(permission);
    }
  });

  it("loses no export: a name that two modules both export would be dropped by `export *`", () => {
    const parts = [
      auth,
      cart,
      catalog,
      email,
      inventory,
      media,
      orders,
      payments,
      pricing,
      search,
      shipping,
    ];
    const total = parts.reduce((sum, part) => sum + Object.keys(part).length, 0);
    expect(Object.keys(core).length).toBe(total);
  });
});
