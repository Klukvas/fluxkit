import { describe, expect, it } from "vitest";
import * as core from "./index.js";

describe("public entry point", () => {
  it("exports the catalog domain functions", () => {
    const functions = [
      "validateI18nText",
      "resolveText",
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
  });
});
