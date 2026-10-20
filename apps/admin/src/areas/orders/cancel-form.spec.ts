import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDER_STATUSES, decideTransition, stockEffectOf } from "@fluxkit/core";
import { describe, expect, it } from "vitest";
import {
  CANCELLATION_REASON_MAX_LENGTH,
  EMPTY_CANCEL,
  cancelConsequence,
  isCancelDirty,
  planCancel,
} from "./cancel-form";

const openapi = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../../docs/api/openapi.json"), "utf8"),
) as {
  paths: Record<
    string,
    {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: { properties: Record<string, { description?: string }>; required: string[] };
            };
          };
        };
      };
    }
  >;
};
const cancelSchema =
  openapi.paths["/admin/orders/{id}/cancel"]?.post.requestBody.content["application/json"].schema;

describe("cancel form", () => {
  it("matches the API's body: a reason of 1 to 500 characters", () => {
    expect(Object.keys(cancelSchema?.properties ?? {})).toEqual(["reason"]);
    expect(cancelSchema?.required).toEqual(["reason"]);
    expect(cancelSchema?.properties.reason?.description).toContain(
      `1 to ${String(CANCELLATION_REASON_MAX_LENGTH)} characters`,
    );
  });

  it("requires a reason (never cancels without one)", () => {
    expect(EMPTY_CANCEL).toEqual({ reason: "" });
    expect(planCancel(EMPTY_CANCEL)).toEqual({ ok: false, issue: "required" });
    expect(planCancel({ reason: " \n\t " })).toEqual({ ok: false, issue: "required" });
  });

  it("sends the trimmed reason, line breaks inside kept", () => {
    expect(planCancel({ reason: "  Customer called.\nNo stock.  " })).toEqual({
      ok: true,
      body: { reason: "Customer called.\nNo stock." },
    });
  });

  it("refuses more than 500 characters after trimming and control characters", () => {
    expect(planCancel({ reason: "x".repeat(500) }).ok).toBe(true);
    expect(planCancel({ reason: ` ${"x".repeat(500)} ` }).ok).toBe(true);
    expect(planCancel({ reason: "x".repeat(501) })).toEqual({ ok: false, issue: "too_long" });
    expect(planCancel({ reason: "a\u0000b" })).toEqual({
      ok: false,
      issue: "invalid_characters",
    });
    expect(planCancel({ reason: "a\u001bb" })).toEqual({
      ok: false,
      issue: "invalid_characters",
    });
  });

  it("is dirty once a reason was typed", () => {
    expect(isCancelDirty(EMPTY_CANCEL)).toBe(false);
    expect(isCancelDirty({ reason: " " })).toBe(true);
  });
});

describe("what a cancel does to the stock (the warning in the dialog)", () => {
  it("follows core: release for an unpaid order, release_unsold (no restock, no refund) for a paid one", () => {
    for (const status of ORDER_STATUSES) {
      const allowed = decideTransition(status, "cancelled", "admin").ok;
      expect(cancelConsequence(status), status).toBe(
        allowed ? stockEffectOf(status, "cancelled") : null,
      );
    }
    expect(cancelConsequence("awaiting_payment")).toBe("release");
    expect(cancelConsequence("paid")).toBe("release_unsold");
    expect(cancelConsequence("fulfilled")).toBeNull();
  });
});
