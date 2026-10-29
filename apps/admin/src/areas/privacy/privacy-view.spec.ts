import type { AdminPrivacyRequest, PersonalDataExport } from "@fluxkit/api-client";
import { describe, expect, it } from "vitest";
import {
  EXPORT_CONTENT_TYPE,
  NOTE_MAX_LENGTH,
  confirmationMatches,
  createRequestBody,
  eraseNotice,
  erasureOutcome,
  exportBlob,
  exportBody,
  exportFileName,
  exportNotice,
  offeredRequestActions,
  resultRows,
  statusLabelKey,
} from "./privacy-view";

function request(extra: Partial<AdminPrivacyRequest> = {}): AdminPrivacyRequest {
  return {
    id: "0b4f7a8e-8f43-4a4e-9a4c-6f2f7f4e1a11",
    kind: "erasure",
    subjectKind: "email",
    subjectCustomerId: null,
    channel: "admin",
    status: "received",
    receivedAt: "2026-10-01T10:00:00.000Z",
    dueAt: "2026-10-31T10:00:00.000Z",
    completedAt: null,
    overdue: false,
    result: null,
    note: null,
    handledBy: null,
    ...extra,
  };
}

describe("offeredRequestActions", () => {
  it("offers nothing without privacy.manage, whatever the request is", () => {
    expect(offeredRequestActions(request(), false)).toEqual([]);
  });

  it("offers export, erase and reject for an open erasure request", () => {
    expect(offeredRequestActions(request(), true)).toEqual(["export", "erase", "reject"]);
    expect(offeredRequestActions(request({ status: "in_progress" }), true)).toEqual([
      "export",
      "erase",
      "reject",
    ]);
  });

  it("does not offer erase for an export request (the API answers not_an_erasure_request)", () => {
    expect(offeredRequestActions(request({ kind: "export" }), true)).toEqual(["export", "reject"]);
  });

  it("offers nothing for a closed request (the API answers request_closed)", () => {
    expect(offeredRequestActions(request({ status: "completed" }), true)).toEqual([]);
    expect(offeredRequestActions(request({ status: "rejected" }), true)).toEqual([]);
  });
});

describe("erasureOutcome", () => {
  it("states the counts only for a request the API reports as completed", () => {
    const done = request({
      status: "completed",
      result: { ordersAnonymised: 3, mailDeleted: 5, customerDeleted: true, orderNumbers: ["A-1"] },
    });
    expect(erasureOutcome(done)).toEqual({
      kind: "erased",
      orders: 3,
      mail: 5,
      accountDeleted: true,
    });
  });

  it("does not claim an erasure for a request that is not completed", () => {
    expect(erasureOutcome(request({ status: "in_progress" }))).toEqual({ kind: "not_completed" });
    expect(erasureOutcome(request({ status: "rejected" }))).toEqual({ kind: "not_completed" });
  });

  it("does not invent counts: a completed request without numbers says it was completed, nothing more", () => {
    expect(erasureOutcome(request({ status: "completed", result: null }))).toEqual({
      kind: "erased",
      orders: null,
      mail: null,
      accountDeleted: null,
    });
    expect(
      erasureOutcome(request({ status: "completed", result: { ordersAnonymised: "3" } })),
    ).toEqual({ kind: "erased", orders: null, mail: null, accountDeleted: null });
  });
});

describe("resultRows", () => {
  it("lists the known counts and flags with message keys, in a fixed order, and drops everything else", () => {
    const rows = resultRows({
      customerDeleted: false,
      zzUnknown: 9,
      mailDeleted: 2,
      ordersAnonymised: 1,
      orderNumbers: ["A-1", "A-2"],
    });
    expect(rows).toEqual([
      { id: "ordersAnonymised", labelKey: "personal.result.ordersAnonymised", value: 1 },
      { id: "mailDeleted", labelKey: "personal.result.mailDeleted", value: 2 },
      { id: "customerDeleted", labelKey: "personal.result.customerDeleted", value: false },
      { id: "orderNumbers", labelKey: "personal.result.orderNumbers", value: ["A-1", "A-2"] },
    ]);
  });

  it("is empty without a result", () => {
    expect(resultRows(null)).toEqual([]);
  });
});

describe("statusLabelKey", () => {
  it("has one key per status", () => {
    expect(statusLabelKey("received")).toBe("personal.status.received");
    expect(statusLabelKey("rejected")).toBe("personal.status.rejected");
  });
});

describe("confirmationMatches", () => {
  it("accepts the word typed with other case or surrounding spaces", () => {
    expect(confirmationMatches("  erase ", "ERASE")).toBe(true);
    expect(confirmationMatches("ВИДАЛИТИ", "видалити")).toBe(true);
  });

  it("refuses an empty, partial or different text, and an empty expected word", () => {
    expect(confirmationMatches("", "ERASE")).toBe(false);
    expect(confirmationMatches("eras", "ERASE")).toBe(false);
    expect(confirmationMatches("erase it", "ERASE")).toBe(false);
    expect(confirmationMatches("", "")).toBe(false);
  });
});

describe("exportBody", () => {
  it("sends nothing for a customer subject", () => {
    expect(exportBody(request({ subjectKind: "customer" }), "")).toEqual({ ok: true, body: {} });
  });

  it("sends the trimmed email again for an email subject (only a hash is stored)", () => {
    expect(exportBody(request(), "  Anna@Example.com ")).toEqual({
      ok: true,
      body: { email: "Anna@Example.com" },
    });
  });

  it("refuses an email subject without a usable address, before any request", () => {
    expect(exportBody(request(), "   ")).toEqual({ ok: false, reason: "email_required" });
    expect(exportBody(request(), "not-an-address")).toEqual({ ok: false, reason: "email_invalid" });
  });
});

describe("createRequestBody", () => {
  it("builds an email subject with a trimmed note", () => {
    expect(
      createRequestBody({
        kind: "export",
        subject: "address",
        customerId: null,
        email: " guest@example.com ",
        note: "  replied from the address  ",
      }),
    ).toEqual({
      ok: true,
      body: {
        kind: "export",
        subject: { email: "guest@example.com" },
        note: "replied from the address",
      },
    });
  });

  it("builds an account subject from the id of the found account and leaves an empty note out", () => {
    expect(
      createRequestBody({
        kind: "erasure",
        subject: "account",
        customerId: "11111111-1111-4111-8111-111111111111",
        email: "guest@example.com",
        note: "   ",
      }),
    ).toEqual({
      ok: true,
      body: { kind: "erasure", subject: { customerId: "11111111-1111-4111-8111-111111111111" } },
    });
  });

  it("refuses an account subject without an account, a bad address and a note over the limit", () => {
    expect(
      createRequestBody({
        kind: "export",
        subject: "account",
        customerId: null,
        email: "",
        note: "",
      }),
    ).toEqual({ ok: false, reason: "account_missing" });
    expect(
      createRequestBody({
        kind: "export",
        subject: "address",
        customerId: null,
        email: "x",
        note: "",
      }),
    ).toEqual({ ok: false, reason: "email_invalid" });
    expect(
      createRequestBody({
        kind: "export",
        subject: "address",
        customerId: null,
        email: "a@example.com",
        note: "x".repeat(NOTE_MAX_LENGTH + 1),
      }),
    ).toEqual({ ok: false, reason: "note_too_long" });
  });
});

describe("the notices after an action", () => {
  it("counts what the export held, from the document itself", () => {
    const notice = exportNotice({
      format: "fluxkit.personal-data-export/v1",
      generatedAt: "2026-10-29T10:00:00.000Z",
      subject: { kind: "customer" },
      account: null,
      orders: [{}, {}],
      mail: [{}],
      sessions: [],
      cart: null,
      processors: [],
    });
    expect(notice).toEqual({
      kind: "exported",
      file: "personal-data-2026-10-29.json",
      orders: 2,
      mail: 1,
      sessions: 0,
    });
  });

  it("says erased only for a completed request, else it claims nothing", () => {
    expect(
      eraseNotice(
        request({
          status: "completed",
          result: { ordersAnonymised: 1, mailDeleted: 0, customerDeleted: false },
        }),
      ),
    ).toEqual({ kind: "erased", orders: 1, mail: 0, accountDeleted: false });
    expect(eraseNotice(request({ status: "in_progress" }))).toEqual({ kind: "erase_unconfirmed" });
  });
});

describe("the exported file", () => {
  const document: PersonalDataExport = {
    format: "fluxkit.personal-data-export/v1",
    generatedAt: "2026-10-29T23:59:59.000Z",
    subject: { kind: "email" },
    account: null,
    orders: [],
    mail: [],
    sessions: [],
    cart: null,
    processors: [],
  };

  it("is named personal-data-<UTC date>.json, like the API's own Content-Disposition", () => {
    expect(exportFileName(document)).toBe("personal-data-2026-10-29.json");
    expect(exportFileName({ ...document, generatedAt: "garbage" })).toBe("personal-data.json");
  });

  it("is JSON of the document with the JSON media type, readable back to the same document", async () => {
    const blob = exportBlob(document);
    expect(EXPORT_CONTENT_TYPE).toBe("application/json");
    expect(blob.type).toBe("application/json");
    expect(JSON.parse(await blob.text())).toEqual(document);
  });
});
