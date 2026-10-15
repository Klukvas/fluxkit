import { describe, expect, it } from "vitest";
import { isValidSku, normalizeSku, proposeSku, proposeSkus, validateSku } from "./sku.js";
import { deepFreeze } from "./test-support.js";

describe("normalizeSku", () => {
  it("trims and uppercases", () => {
    expect(normalizeSku("  abc-1 ")).toBe("ABC-1");
    expect(normalizeSku("futbolka-red-s")).toBe("FUTBOLKA-RED-S");
  });

  it("keeps inner characters as they are", () => {
    expect(normalizeSku("a b")).toBe("A B");
  });
});

describe("isValidSku", () => {
  it("accepts the documented alphabet", () => {
    for (const sku of ["A", "0", "ABC-123", "A.B_C-1", "FUTBOLKA-BASIC-RED-S", "A".repeat(64)]) {
      expect(isValidSku(sku)).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const sku of ["", "-A", ".A", "_A", "a", "A B", "A/B", "АВС", "A".repeat(65), "A\n"]) {
      expect(isValidSku(sku)).toBe(false);
    }
  });
});

describe("validateSku", () => {
  it("normalizes before validating", () => {
    expect(validateSku(" abc-1 ")).toEqual({ ok: true, sku: "ABC-1" });
  });

  it("reports why a SKU is rejected", () => {
    expect(validateSku("   ")).toEqual({ ok: false, reason: "empty" });
    expect(validateSku("a".repeat(65))).toEqual({ ok: false, reason: "too_long" });
    expect(validateSku("-abc")).toEqual({ ok: false, reason: "invalid_format" });
    expect(validateSku("a b")).toEqual({ ok: false, reason: "invalid_format" });
    expect(validateSku("футболка")).toEqual({ ok: false, reason: "invalid_format" });
  });

  it("accepts exactly 64 characters", () => {
    expect(validateSku("a".repeat(64))).toEqual({ ok: true, sku: "A".repeat(64) });
  });
});

describe("proposeSku", () => {
  const none: ReadonlySet<string> = new Set();

  it("joins the slug and the value codes in uppercase", () => {
    expect(proposeSku({ slug: "futbolka-basic", valueCodes: ["red", "s"], takenSkus: none })).toEqual(
      { ok: true, sku: "FUTBOLKA-BASIC-RED-S" },
    );
  });

  it("uses only the slug for a product without options", () => {
    expect(proposeSku({ slug: "vykrutka-ph2-100", valueCodes: [], takenSkus: none })).toEqual({
      ok: true,
      sku: "VYKRUTKA-PH2-100",
    });
  });

  it("keeps underscores of value codes", () => {
    expect(proposeSku({ slug: "shoes", valueCodes: ["dark_blue"], takenSkus: none })).toEqual({
      ok: true,
      sku: "SHOES-DARK_BLUE",
    });
  });

  it("appends -2, -3 on collision with a taken SKU", () => {
    const base = { slug: "futbolka", valueCodes: ["red"] };
    expect(proposeSku({ ...base, takenSkus: new Set(["FUTBOLKA-RED"]) })).toEqual({
      ok: true,
      sku: "FUTBOLKA-RED-2",
    });
    expect(
      proposeSku({ ...base, takenSkus: new Set(["FUTBOLKA-RED", "FUTBOLKA-RED-2"]) }),
    ).toEqual({ ok: true, sku: "FUTBOLKA-RED-3" });
  });

  it("truncates to 64 characters", () => {
    const result = proposeSku({ slug: `${"a".repeat(70)}`, valueCodes: ["red"], takenSkus: none });
    expect(result).toEqual({ ok: true, sku: "A".repeat(64) });
  });

  it("keeps the suffix inside the 64 character limit", () => {
    const taken = new Set(["A".repeat(64)]);
    const result = proposeSku({ slug: "a".repeat(70), valueCodes: [], takenSkus: taken });
    expect(result).toEqual({ ok: true, sku: `${"A".repeat(62)}-2` });
    if (result.ok) {
      expect(isValidSku(result.sku)).toBe(true);
    }
  });

  it("does not leave a separator at the cut", () => {
    const slug = `${"a".repeat(62)}-bbb`;
    const result = proposeSku({ slug, valueCodes: [], takenSkus: none });
    expect(result).toEqual({ ok: true, sku: "A".repeat(62) });
  });

  it("fails loudly when there is nothing to build a SKU from", () => {
    expect(proposeSku({ slug: "", valueCodes: [], takenSkus: none })).toEqual({
      ok: false,
      reason: "empty_base",
    });
    expect(proposeSku({ slug: "Futbolka Basic", valueCodes: [], takenSkus: none })).toEqual({
      ok: false,
      reason: "invalid_format",
    });
  });

  it("does not mutate the taken set or frozen input", () => {
    const taken = new Set(["FUTBOLKA-RED"]);
    const input = deepFreeze({ slug: "futbolka", valueCodes: ["red"], takenSkus: taken });
    expect(proposeSku(input)).toEqual(proposeSku(input));
    expect([...taken]).toEqual(["FUTBOLKA-RED"]);
  });
});

describe("proposeSkus (one batch)", () => {
  it("proposes distinct SKUs for a whole generate call", () => {
    const result = proposeSkus({
      slug: "futbolka",
      variants: [["red", "s"], ["red", "m"], ["black", "s"]],
      takenSkus: new Set(["FUTBOLKA-RED-M"]),
    });
    expect(result).toEqual([
      { ok: true, sku: "FUTBOLKA-RED-S" },
      { ok: true, sku: "FUTBOLKA-RED-M-2" },
      { ok: true, sku: "FUTBOLKA-BLACK-S" },
    ]);
  });

  it("avoids collisions inside the batch itself and leaves the taken set alone", () => {
    const taken = new Set<string>();
    const result = proposeSkus({
      slug: "futbolka",
      variants: [["red"], ["red"]],
      takenSkus: taken,
    });
    expect(result).toEqual([
      { ok: true, sku: "FUTBOLKA-RED" },
      { ok: true, sku: "FUTBOLKA-RED-2" },
    ]);
    expect(taken.size).toBe(0);
  });
});
