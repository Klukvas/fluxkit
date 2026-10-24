import { describe, expect, it } from "vitest";
import * as auth from "./auth/index.js";
import * as cart from "./cart/index.js";
import * as catalog from "./catalog/index.js";
import * as core from "./index.js";
import * as inventory from "./inventory/index.js";
import * as media from "./media/index.js";
import * as orders from "./orders/index.js";
import * as pricing from "./pricing/index.js";
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

  it("exports the new admin permissions", () => {
    for (const permission of ["orders.read", "orders.write", "customers.read", "customers.write", "shipping.manage"]) {
      expect(core.PERMISSIONS, permission).toContain(permission);
    }
  });

  it("loses no export: a name that two modules both export would be dropped by `export *`", () => {
    const parts = [auth, cart, catalog, inventory, media, orders, pricing, shipping];
    const total = parts.reduce((sum, part) => sum + Object.keys(part).length, 0);
    expect(Object.keys(core).length).toBe(total);
  });
});
