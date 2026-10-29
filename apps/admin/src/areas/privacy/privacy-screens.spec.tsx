import type {
  AdminErasurePreview,
  AdminPrivacyLookup,
  AdminPrivacyRequest,
} from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { CreateRequestFormView, LookupForm, LookupResultView } from "./lookup-view";
import type { RequestNotice } from "./privacy-view";
import {
  EraseDialog,
  ErasurePreviewView,
  RejectDialog,
  RequestButtons,
  RequestFacts,
  RequestNoticeView,
  SubjectEmailField,
} from "./request-detail-view";
import { RequestResultsView, type RequestListState } from "./requests-view";

const sentinel = sentinelTranslator();
const noop = () => undefined;

/** Leftover words of a screen with the English date parts (month names, "at", AM and PM) taken out. */
function words(text: string): string {
  return text.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|at|AM|PM)\b/g,
    "",
  );
}

function request(overrides: Partial<AdminPrivacyRequest> = {}): AdminPrivacyRequest {
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
    note: "replied from the address",
    handledBy: null,
    ...overrides,
  };
}

const lookup: AdminPrivacyLookup = {
  customer: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "anna@example.com",
    firstName: "Anna",
    lastName: "Kovalenko",
    isActive: true,
    createdAt: "2026-09-01T10:00:00.000Z",
    orderCount: 2,
  },
  guestOrders: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      number: "AB12-CD34",
      status: "fulfilled",
      placedAt: "2026-09-10T10:00:00.000Z",
      contactErased: false,
    },
  ],
  mailCount: 3,
  openRequests: [request()],
};

const preview: AdminErasurePreview = {
  accountFound: true,
  orders: 3,
  ordersToAnonymise: 2,
  mail: 4,
  blockers: [
    { orderNumber: "AB12-CD34", reason: "open_order" },
    { orderNumber: null, reason: "mail_sending" },
  ],
  reasons: ["open_order", "mail_sending"],
};

describe("request list", () => {
  const ready: RequestListState = {
    status: "ready",
    data: {
      items: [request(), request({ id: "x", overdue: true, kind: "export" })],
      total: 2,
      limit: 50,
      offset: 0,
    },
  };

  it("renders without hardcoded text in every state", () => {
    const states: RequestListState[] = [
      { status: "loading" },
      ready,
      { status: "ready", data: { items: [], total: 0, limit: 50, offset: 0 } },
      { status: "error", failure: { kind: "network" } },
      { status: "forbidden" },
      { status: "notFound" },
    ];
    for (const state of states) {
      const html = renderInRouter(
        <RequestResultsView
          t={sentinel}
          uiLocale="en"
          query={{ limit: 50, offset: 0 }}
          state={state}
          onRetry={noop}
          hrefForOffset={() => "/privacy"}
        />,
        "/privacy",
      );
      expect(words(leftoverText(html)), JSON.stringify(state)).not.toMatch(/[A-Za-z]{3}/);
      expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
    }
  });

  it("marks an overdue request and links each row to its detail", () => {
    const html = renderInRouter(
      <RequestResultsView
        t={sentinel}
        uiLocale="en"
        query={{ limit: 50, offset: 0 }}
        state={ready}
        onRetry={noop}
        hrefForOffset={() => "/privacy"}
      />,
      "/privacy",
    );
    expect(html).toContain("§personal.list.overdue");
    expect(html).toContain("/admin-ui/privacy/requests/0b4f7a8e-8f43-4a4e-9a4c-6f2f7f4e1a11");
  });
});

describe("lookup", () => {
  it("sends the address in a POST form: method post, no action, no query string", () => {
    const html = renderInRouter(
      <LookupForm
        t={sentinel}
        email="anna@example.com"
        onEmailChange={noop}
        onSubmit={noop}
        busy={false}
        error={null}
        fieldError={null}
      />,
    );
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).toContain('type="email"');
    expect(html).toContain('autoComplete="off"');
  });

  it("shows the account, the guest orders, the mail count and the open requests, without hardcoded text", () => {
    const html = renderInRouter(<LookupResultView t={sentinel} uiLocale="en" result={lookup} />);
    expect(html).toContain("anna@example.com");
    expect(html).toContain("AB12-CD34");
    expect(html).toContain("§personal.lookup.mailCount:3");
    expect(
      words(leftoverText(html.replaceAll("anna@example.com", "").replaceAll("AB12-CD34", ""))),
    ).not.toMatch(/[A-Za-z]{3}/);
  });

  it("says so when the shop holds nothing for the address", () => {
    const html = renderInRouter(
      <LookupResultView
        t={sentinel}
        uiLocale="en"
        result={{ customer: null, guestOrders: [], mailCount: 0, openRequests: [] }}
      />,
    );
    expect(html).toContain("§personal.lookup.nothing");
    expect(html).toContain("§personal.lookup.noAccount");
  });

  it("offers the account as a subject only when the lookup found one", () => {
    const form = {
      kind: "export",
      subject: "address",
      customerId: null,
      email: "a@example.com",
      note: "",
    } as const;
    const without = renderInRouter(
      <CreateRequestFormView
        t={sentinel}
        hasAccount={false}
        values={form}
        onChange={noop}
        onSubmit={noop}
        busy={false}
        issue={null}
        error={null}
      />,
    );
    const withAccount = renderInRouter(
      <CreateRequestFormView
        t={sentinel}
        hasAccount
        values={form}
        onChange={noop}
        onSubmit={noop}
        busy={false}
        issue={null}
        error={null}
      />,
    );
    expect(without).not.toContain("§personal.create.subjectAccount");
    expect(withAccount).toContain("§personal.create.subjectAccount");
    expect(withAccount).toMatch(/<form[^>]*method="post"/);
  });
});

describe("request detail", () => {
  it("shows the facts and the stored result (counts and codes), without hardcoded text", () => {
    const html = renderInRouter(
      <RequestFacts
        t={sentinel}
        uiLocale="en"
        request={request({
          status: "completed",
          completedAt: "2026-10-02T10:00:00.000Z",
          result: {
            ordersAnonymised: 2,
            mailDeleted: 1,
            customerDeleted: true,
            orderNumbers: ["AB12-CD34"],
          },
        })}
      />,
    );
    expect(html).toContain("AB12-CD34");
    expect(html).toContain("§personal.result.ordersAnonymised");
    expect(
      words(
        leftoverText(html.replaceAll("AB12-CD34", "").replaceAll("replied from the address", "")),
      ),
    ).not.toMatch(/[A-Za-z]{3}/);
  });

  it("asks the address of an email subject again, in an input that is never read from the URL", () => {
    const html = renderInRouter(
      <SubjectEmailField t={sentinel} value="" onChange={noop} error={null} disabled={false} />,
    );
    expect(html).toContain('type="email"');
    expect(html).toContain("§personal.detail.emailAgainHint");
  });

  it("lists the blockers of a preview in words, one line each, and says nothing was changed", () => {
    const html = renderInRouter(<ErasurePreviewView t={sentinel} preview={preview} />);
    expect(html).toContain("§personal.preview.blockedTitle");
    // An order's blocker is one sentence naming the order and the reason; a mail blocker has no order.
    expect(html).toContain("§personal.preview.blockerOrder");
    expect(html).toContain("§personal.blocker.mail_sending");
    expect(html).toContain("§personal.preview.nothingChanged");
    expect(html).not.toContain("§personal.preview.noBlockers");
  });

  it("tells that nothing is in the way when there are no blockers", () => {
    const html = renderInRouter(
      <ErasurePreviewView t={sentinel} preview={{ ...preview, blockers: [], reasons: [] }} />,
    );
    expect(html).toContain("§personal.preview.noBlockers");
    expect(html).not.toContain("§personal.preview.blockedTitle");
  });

  it("offers only the buttons the request allows, and keeps erase off until a clean preview", () => {
    const render = (actions: Parameters<typeof RequestButtons>[0]["actions"], canErase: boolean) =>
      renderInRouter(
        <RequestButtons
          t={sentinel}
          actions={actions}
          busy={false}
          canErase={canErase}
          onExport={noop}
          onPreview={noop}
          onErase={noop}
          onReject={noop}
        />,
      );
    expect(render([], true)).toBe("");
    const exportOnly = render(["export", "reject"], false);
    expect(exportOnly).not.toContain("§personal.action.erase");
    const full = render(["export", "erase", "reject"], false);
    expect(full).toMatch(/<button[^>]*disabled=""[^>]*>§personal\.action\.erase</);
    expect(render(["export", "erase", "reject"], true)).not.toMatch(
      /<button[^>]*disabled=""[^>]*>§personal\.action\.erase</,
    );
  });

  it("words every notice, and claims an erasure only when the API confirmed it", () => {
    const notices: RequestNotice[] = [
      { kind: "exported", file: "personal-data-2026-10-29.json", orders: 1, mail: 2, sessions: 3 },
      { kind: "erased", orders: 1, mail: 2, accountDeleted: true },
      { kind: "erased", orders: null, mail: null, accountDeleted: null },
      { kind: "erase_unconfirmed" },
      { kind: "rejected" },
      { kind: "lost", action: "export" },
      { kind: "lost", action: "erase" },
      { kind: "lost", action: "reject" },
    ];
    for (const notice of notices) {
      const html = renderInRouter(<RequestNoticeView t={sentinel} notice={notice} />);
      expect(html, notice.kind).not.toBe("");
    }
    const unconfirmed = renderInRouter(
      <RequestNoticeView t={sentinel} notice={{ kind: "erase_unconfirmed" }} />,
    );
    expect(unconfirmed).not.toContain("§personal.notice.erased");
    const lost = renderInRouter(
      <RequestNoticeView t={sentinel} notice={{ kind: "lost", action: "erase" }} />,
    );
    expect(lost).not.toContain('§personal.notice.erased"');
    expect(lost).toContain("§personal.notice.lost.erase");
  });
});

describe("the erase dialog", () => {
  function erase(overrides: Partial<Parameters<typeof EraseDialog>[0]> = {}) {
    return renderInRouter(
      <EraseDialog
        t={sentinel}
        open
        busy={false}
        typed=""
        onTypedChange={noop}
        typedError={null}
        error={null}
        reasons={[]}
        onSubmit={noop}
        onClose={noop}
        {...overrides}
      />,
    );
  }

  it("is an alert dialog that says what is deleted, kept and out of reach, and asks for a typed word", () => {
    const html = erase();
    expect(html).toContain('role="alertdialog"');
    for (const key of ["deletes", "keeps", "limits", "irreversible", "typeHint"]) {
      expect(html, key).toContain(`§personal.erase.${key}`);
    }
    expect(html).toContain('name="confirmation"');
    expect(html).toContain('form="privacy-erase"');
    // The focus starts on the safe choice.
    expect(html).toMatch(/data-autofocus=""[^>]*>§personal\.erase\.keep</);
  });

  it("shows a refusal with its blockers inside the dialog, and disables both buttons while the write runs", () => {
    const html = erase({
      busy: true,
      error: { key: "personal.refusal.erasure_blocked" },
      reasons: ["open_order", "brand_new_reason"],
    });
    expect(html).toContain("§personal.refusal.erasure_blocked");
    expect(html).toContain("§personal.blocker.open_order");
    expect(html).toContain("§personal.blocker.unknown");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("marks a wrong typed word on the field", () => {
    const html = erase({ typedError: { key: "personal.erase.typedMismatch" } });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("§personal.erase.typedMismatch");
  });
});

describe("the reject dialog", () => {
  it("offers the reason codes and an optional note, and is a post form", () => {
    const html = renderInRouter(
      <RejectDialog
        t={sentinel}
        open
        busy={false}
        reason="identity_not_confirmed"
        note=""
        onChange={noop}
        error={null}
        onSubmit={noop}
        onClose={noop}
      />,
    );
    expect(html).toMatch(/<form[^>]*method="post"/);
    for (const code of ["identity_not_confirmed", "duplicate_request", "not_applicable"]) {
      expect(html).toContain(`§personal.reject.option.${code}`);
    }
  });
});

describe("the count sentences of the notices (privacy UI review F4)", () => {
  async function notice(locale: "uk" | "en", value: RequestNotice): Promise<string> {
    const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
    return renderInRouter(<RequestNoticeView t={t} notice={value} />);
  }

  it("uses the singular and plural forms in English", async () => {
    const one = await notice("en", {
      kind: "exported",
      file: "personal-data-2026-10-29.json",
      orders: 1,
      mail: 1,
      sessions: 1,
    });
    expect(one).toContain("1 order, 1 mail, 1 session");
    const many = await notice("en", {
      kind: "exported",
      file: "personal-data-2026-10-29.json",
      orders: 0,
      mail: 2,
      sessions: 5,
    });
    expect(many).toContain("0 orders, 2 mails, 5 sessions");
    const erasedOne = await notice("en", {
      kind: "erased",
      orders: 1,
      mail: 1,
      accountDeleted: null,
    });
    expect(erasedOne).toContain("The contact data of 1 order was erased.");
    expect(erasedOne).toContain("1 stored mail was deleted.");
    const erasedMany = await notice("en", {
      kind: "erased",
      orders: 3,
      mail: 0,
      accountDeleted: null,
    });
    expect(erasedMany).toContain("The contact data of 3 orders was erased.");
    expect(erasedMany).toContain("0 stored mails were deleted.");
    expect(one + many + erasedOne + erasedMany).not.toMatch(/\b1 (orders|mails|sessions)\b/);
  });

  it("uses one, few and many forms in Ukrainian", async () => {
    const exported = (orders: number, mail: number, sessions: number) =>
      notice("uk", { kind: "exported", file: "f.json", orders, mail, sessions });
    expect(await exported(1, 1, 1)).toContain("1 замовлення, 1 лист, 1 сеанс");
    expect(await exported(2, 3, 4)).toContain("2 замовлення, 3 листи, 4 сеанси");
    expect(await exported(5, 11, 25)).toContain("5 замовлень, 11 листів, 25 сеансів");
    expect(await exported(21, 22, 0)).toContain("21 замовлення, 22 листи, 0 сеансів");
    const erased = (orders: number, mail: number) =>
      notice("uk", { kind: "erased", orders, mail, accountDeleted: null });
    const one = await erased(1, 1);
    expect(one).toContain("в 1 замовленні");
    expect(one).toContain("Видалено 1 збережений лист.");
    const few = await erased(2, 3);
    expect(few).toContain("в 2 замовленнях");
    expect(few).toContain("Видалено 3 збережені листи.");
    const many = await erased(5, 12);
    expect(many).toContain("в 5 замовленнях");
    expect(many).toContain("Видалено 12 збережених листів.");
  });
});

describe("with the real messages", () => {
  it("renders the screens, the dialogs and every notice in uk and en without a raw key", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      const parts = [
        renderInRouter(<LookupResultView t={t} uiLocale={locale} result={lookup} />),
        renderInRouter(<ErasurePreviewView t={t} preview={preview} />),
        renderInRouter(
          <RequestFacts t={t} uiLocale={locale} request={request({ result: { orders: 1 } })} />,
        ),
        renderInRouter(
          <EraseDialog
            t={t}
            open
            busy={false}
            typed=""
            onTypedChange={noop}
            typedError={null}
            error={{ key: "personal.refusal.erasure_blocked" }}
            reasons={["open_order"]}
            onSubmit={noop}
            onClose={noop}
          />,
        ),
      ];
      for (const kind of ["export", "erase", "reject"] as const) {
        parts.push(
          renderInRouter(<RequestNoticeView t={t} notice={{ kind: "lost", action: kind }} />),
        );
      }
      for (const html of parts) expect(html).not.toMatch(/personal\.[a-z]+\.[A-Za-z_]+/);
      // The blockers of the preview are named in words, with the order number.
      const previewHtml = parts[1] ?? "";
      expect(previewHtml).toContain("AB12-CD34");
      expect(previewHtml).toContain(t("personal.blocker.open_order"));
      expect(previewHtml).toContain(t("personal.blocker.mail_sending"));
    }
  });

  it("types the shown word in the dialog's own language (uk: the Ukrainian word, en: the English one)", async () => {
    const uk = createTranslator(await messagesForArea("uk", MESSAGE_FILES), "uk");
    const en = createTranslator(await messagesForArea("en", MESSAGE_FILES), "en");
    expect(uk("personal.erase.word")).toBe("ВИДАЛИТИ");
    expect(en("personal.erase.word")).toBe("ERASE");
  });
});
