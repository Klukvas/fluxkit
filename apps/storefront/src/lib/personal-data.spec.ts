import type { PersonalDataExport, ProblemDetails, StoreFailure } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  BLOCK_REASONS,
  EXPORT_CONTENT_TYPE,
  blockReasonKey,
  confirmationMatches,
  deleteBody,
  exportBlob,
  exportFileName,
  mapDeleteFailure,
  mapExportFailure,
  readBlockReasons,
  waitParts,
} from "./personal-data";

function failure(
  status: number,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = null,
): StoreFailure {
  const code = typeof extra["code"] === "string" ? extra["code"] : "validation_failed";
  return {
    ok: false,
    status,
    retryAfter,
    problem: {
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "SECRET-ENGLISH-DETAIL",
      ...extra,
    } as ProblemDetails,
  };
}

describe("waitParts", () => {
  it("rounds a wait up to whole minutes under an hour and to whole hours above", () => {
    expect(waitParts(1)).toEqual({ unit: "minutes", count: 1 });
    expect(waitParts(61)).toEqual({ unit: "minutes", count: 2 });
    expect(waitParts(3600)).toEqual({ unit: "minutes", count: 60 });
    expect(waitParts(3601)).toEqual({ unit: "hours", count: 2 });
    expect(waitParts(86_400)).toEqual({ unit: "hours", count: 24 });
  });

  it("names no wait for a missing or implausible number", () => {
    expect(waitParts(null)).toBeNull();
    expect(waitParts(0)).toBeNull();
    expect(waitParts(-5)).toBeNull();
  });
});

describe("mapExportFailure", () => {
  it("reads a 429 as the daily limit with the wait from Retry-After", () => {
    expect(mapExportFailure(failure(429, { code: "too_many_requests" }, "7200"))).toEqual({
      kind: "rate_limited",
      wait: { unit: "hours", count: 2 },
    });
    expect(mapExportFailure(failure(429, { code: "too_many_requests" }, null))).toEqual({
      kind: "rate_limited",
      wait: null,
    });
    expect(mapExportFailure(failure(429, { code: "too_many_requests" }, "soon"))).toEqual({
      kind: "rate_limited",
      wait: null,
    });
  });

  it("reads a 401 as an ended session and export_too_large as its own refusal", () => {
    expect(mapExportFailure(failure(401, { code: "unauthorized" }))).toEqual({
      kind: "signed_out",
    });
    expect(
      mapExportFailure(failure(409, { code: "rule_violation", rule: "export_too_large" })),
    ).toEqual({ kind: "too_large" });
  });

  it("leaves anything else to the shared failure message, never the English detail", () => {
    const mapped = mapExportFailure(failure(500, { code: "internal_error" }));
    expect(mapped.kind).toBe("other");
    expect(JSON.stringify(mapped)).not.toContain("SECRET");
  });
});

describe("blocked reasons", () => {
  it("lists the reasons of the plan, each with its own message key", () => {
    expect([...BLOCK_REASONS].sort()).toEqual(
      [
        "active_shipment",
        "mail_sending",
        "open_order",
        "payment_in_progress",
        "refund_in_progress",
      ].sort(),
    );
    for (const reason of BLOCK_REASONS) {
      expect(blockReasonKey(reason)).toBe(`account.data.blocked.${reason}`);
    }
    expect(blockReasonKey("brand_new")).toBe("account.data.blocked.unknown");
  });

  it("reads reasons from the answer: known ones in the documented order, unknown ones last, no duplicates, junk ignored", () => {
    const body = failure(409, {
      code: "rule_violation",
      rule: "erasure_blocked",
      reasons: ["active_shipment", "open_order", 7, "open_order", "new_one"],
    }).problem;
    expect(readBlockReasons(body)).toEqual(["open_order", "active_shipment", "new_one"]);
    expect(readBlockReasons(failure(409, { reasons: "open_order" }).problem)).toEqual([]);
  });
});

describe("mapDeleteFailure", () => {
  it("maps a wrong password to the password field, not to a general message", () => {
    const mapped = mapDeleteFailure(
      failure(400, { errors: [{ path: "password", code: "incorrect" }] }),
    );
    expect(mapped.kind).toBe("other");
    if (mapped.kind === "other") {
      expect(mapped.failure.fieldErrors).toEqual([
        { path: "password", code: "incorrect", messageKey: "account.data.delete.wrongPassword" },
      ]);
    }
  });

  it("maps erasure_blocked to its reasons and nothing else", () => {
    expect(
      mapDeleteFailure(
        failure(409, { code: "rule_violation", rule: "erasure_blocked", reasons: ["open_order"] }),
      ),
    ).toEqual({ kind: "blocked", reasons: ["open_order"] });
    // A refusal without readable reasons is still a refusal: the shopper is told something is in progress.
    expect(
      mapDeleteFailure(failure(409, { code: "rule_violation", rule: "erasure_blocked" })),
    ).toEqual({ kind: "blocked", reasons: [] });
  });

  it("maps a 429 and a 401, and leaves other answers to the shared message", () => {
    expect(mapDeleteFailure(failure(429, { code: "too_many_requests" }, "1800"))).toEqual({
      kind: "rate_limited",
      wait: { unit: "minutes", count: 30 },
    });
    expect(mapDeleteFailure(failure(401, { code: "unauthorized" }))).toEqual({
      kind: "signed_out",
    });
    expect(mapDeleteFailure(failure(500, { code: "internal_error" })).kind).toBe("other");
  });
});

describe("deleteBody and the typed word", () => {
  it("sends the password as typed (spaces are part of it) and confirm true, nothing else", () => {
    expect(deleteBody("  pass phrase  ")).toEqual({ password: "  pass phrase  ", confirm: true });
  });

  it("accepts the shown word typed with other case or spaces, and refuses everything else", () => {
    expect(confirmationMatches(" delete ", "DELETE")).toBe(true);
    expect(confirmationMatches("ВИДАЛИТИ", "видалити")).toBe(true);
    expect(confirmationMatches("", "DELETE")).toBe(false);
    expect(confirmationMatches("delet", "DELETE")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });
});

describe("the downloaded file", () => {
  const document: PersonalDataExport = {
    format: "fluxkit.personal-data-export/v1",
    generatedAt: "2026-10-29T23:59:59.000Z",
    subject: { kind: "customer" },
    account: null,
    orders: [],
    mail: [],
    sessions: [],
    cart: null,
    processors: [],
  };

  it("is named personal-data-<UTC date>.json like the API's own Content-Disposition", () => {
    expect(exportFileName(document)).toBe("personal-data-2026-10-29.json");
    expect(exportFileName({ ...document, generatedAt: "garbage" })).toBe("personal-data.json");
  });

  it("is JSON with the JSON media type that reads back to the same document", async () => {
    expect(EXPORT_CONTENT_TYPE).toBe("application/json");
    const blob = exportBlob(document);
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(document);
  });
});
