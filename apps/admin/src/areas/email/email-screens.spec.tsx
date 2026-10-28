import type {
  AdminEmailMessage,
  AdminEmailMessageDetail,
  AdminEmailPreview,
  AdminEmailStatus,
} from "@fluxkit/api-client";
import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
  textAttributes,
} from "../../test-helpers";
import { formatDateTime } from "../../lib/format";
import { MESSAGE_FILES } from "./index";
import type { MessageListQuery } from "./message-list-query";
import {
  MessageActions,
  MessageFacts,
  MessageNoticeView,
  VariablesTable,
} from "./message-detail-view";
import { MessageResultsView, type MessageListState } from "./messages-view";
import { PREVIEW_SANDBOX, SandboxedMailFrame } from "./preview-frame";
import { StatusView, TestSendPanel, TestSendResult, type StatusState } from "./status-view";
import { PreviewBody, PreviewLocaleSwitch, TemplatesView } from "./templates-view";

const sentinel = sentinelTranslator();
const noop = () => undefined;
const NOW = new Date("2026-10-26T12:00:00.000Z");

function status(overrides: Partial<AdminEmailStatus> = {}): AdminEmailStatus {
  return {
    configured: true,
    providerCode: "resend",
    from: { address: "shop@example.com", displayName: "Demo Shop" },
    replyTo: null,
    since: "2026-10-25T12:00:00.000Z",
    counts: { pending: 2, sending: 0, sent: 40, failed: 1, unknown: 0, cancelled: 3 },
    queueDepth: 2,
    oldestPendingAt: "2026-10-26T11:30:00.000Z",
    errorCodes: [{ code: "rejected:validation_error", count: 1 }],
    ...overrides,
  };
}

function message(overrides: Partial<AdminEmailMessage> = {}): AdminEmailMessage {
  return {
    id: "0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f",
    templateKey: "order.placed",
    templateVersion: 1,
    locale: "uk",
    to: "anna@example.com",
    recipientKind: "customer",
    customerId: null,
    orderId: null,
    adminUserId: null,
    status: "sent",
    attempts: 1,
    nextAttemptAt: "2026-10-26T10:00:00.000Z",
    leaseUntil: null,
    deadlineAt: "2026-10-27T10:00:00.000Z",
    providerCode: "resend",
    providerMessageId: "pm-1",
    lastErrorCode: null,
    resendOf: null,
    createdByAdminId: null,
    createdAt: "2026-10-26T10:00:00.000Z",
    sentAt: "2026-10-26T10:00:05.000Z",
    updatedAt: "2026-10-26T10:00:05.000Z",
    canCancel: false,
    canResend: true,
    ...overrides,
  };
}

function detail(overrides: Partial<AdminEmailMessageDetail> = {}): AdminEmailMessageDetail {
  return { ...message(), variables: { orderNumber: "ORD-1" }, ...overrides };
}

const queryBare: MessageListQuery = {
  template: "",
  recipient: "",
  from: "",
  to: "",
  limit: 50,
  offset: 0,
};

function statusView(state: StatusState) {
  return renderInRouter(
    <StatusView
      t={sentinel}
      uiLocale="en"
      state={state}
      now={NOW}
      onRetry={noop}
      testSend={(current) => (
        <TestSendPanel
          t={sentinel}
          configured={current.configured}
          canManage
          locales={["uk", "en"]}
          locale="en"
          onLocaleChange={noop}
          busy={false}
          view={{ kind: "idle" }}
          onSend={noop}
        />
      )}
    />,
    "/email",
  );
}

describe("the status screen", () => {
  it("renders every state without hardcoded text", () => {
    const states: StatusState[] = [
      { status: "loading" },
      { status: "ready", data: status() },
      { status: "ready", data: status({ configured: false, providerCode: null, from: null }) },
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "network" } },
    ];
    for (const state of states) {
      const html = statusView(state);
      expect(
        leftoverText(
          html
            .split("Demo Shop")
            .join(" ")
            .split("shop@example.com")
            .join(" ")
            .split("resend")
            .join(" ")
            .split("rejected:validation_error")
            .join(" ")
            .split(/&lt;|&gt;/)
            .join(" "),
        ),
        state.status,
      ).toBe("");
    }
  });

  it("shows the setup steps, and no key, when no provider is configured", () => {
    const html = statusView({
      status: "ready",
      data: status({ configured: false, providerCode: null, from: null }),
    });
    expect(html).toContain("§mail.notConfigured.title");
    for (const step of ["step1", "step2", "step3", "step4"]) {
      expect(html).toContain(`§mail.setup.${step}`);
    }
  });

  it("does not show the setup steps when a provider is configured", () => {
    expect(statusView({ status: "ready", data: status() })).not.toContain("§mail.setup.");
  });

  it("lists the six statuses in an accessible table with a caption (no chart)", () => {
    const html = statusView({ status: "ready", data: status() });
    expect(html).toContain("<caption");
    expect(html).toContain("§mail.status.countsCaption");
    for (const entry of ["pending", "sending", "sent", "failed", "unknown", "cancelled"]) {
      expect(html).toContain(`§mail.status.${entry}`);
    }
    expect(html).not.toMatch(/<svg|<canvas/);
  });

  it("shows the sender and the oldest pending mail with its age, and the error codes translated plus raw", () => {
    const html = statusView({ status: "ready", data: status() });
    expect(html).toContain("Demo Shop &lt;shop@example.com&gt;");
    expect(html).toContain("§mail.status.oldestValue");
    expect(html).toContain("§mail.code.rejected");
    expect(html).toContain("rejected:validation_error");
  });

  it("shows 'nothing pending' and 'no errors' states for a quiet shop", () => {
    const html = statusView({
      status: "ready",
      data: status({ oldestPendingAt: null, queueDepth: 0, errorCodes: [] }),
    });
    expect(html).toContain("§mail.status.nonePending");
    expect(html).toContain("§mail.status.noErrorsTitle");
  });
});

describe("the test send panel", () => {
  function panel(overrides: { configured?: boolean; canManage?: boolean; busy?: boolean }) {
    return renderInRouter(
      <TestSendPanel
        t={sentinel}
        configured={overrides.configured ?? true}
        canManage={overrides.canManage ?? true}
        locales={["uk", "en"]}
        locale="en"
        onLocaleChange={noop}
        busy={overrides.busy ?? false}
        view={{ kind: "idle" }}
        onSend={noop}
      />,
    );
  }
  const button = (html: string) => /<button[^>]*>§mail\.test\.send<\/button>/.exec(html)?.[0] ?? "";

  it("disables the button without a provider and says why", () => {
    const html = panel({ configured: false });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>§mail\.test\.send<\/button>/);
    expect(html).toContain("§mail.test.disabled");
    expect(html).toContain('aria-describedby="email-test-disabled"');
  });

  it("enables the button with a provider", () => {
    expect(button(panel({}))).not.toMatch(/\sdisabled=""/);
  });

  it("disables the button while the request runs", () => {
    expect(panel({ busy: true })).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/);
  });

  it("renders no control for an admin who may not manage email", () => {
    const html = panel({ canManage: false });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<select");
  });

  it("renders the result states in words (queued with a link, refused, no answer)", () => {
    const queued = renderInRouter(
      <TestSendResult t={sentinel} view={{ kind: "queued", messageId: "m 1" }} />,
    );
    expect(queued).toContain('href="/admin-ui/email/messages/m%201"');
    const refused = renderInRouter(
      <TestSendResult
        t={sentinel}
        view={{
          kind: "refused",
          descriptor: { key: "mail.refusal.rateLimitedWait", values: { minutes: 5 } },
        }}
      />,
    );
    expect(refused).toContain("§mail.refusal.rateLimitedWait");
    const unknown = renderInRouter(<TestSendResult t={sentinel} view={{ kind: "unknown" }} />);
    expect(unknown).toContain("§mail.test.unknownBody");
    expect(unknown).toContain('href="/admin-ui/email/messages"');
  });
});

function results(state: MessageListState, query = queryBare) {
  return renderInRouter(
    <MessageResultsView
      t={sentinel}
      uiLocale="en"
      query={query}
      state={state}
      onRetry={noop}
      hrefForOffset={(offset) => `/email/messages?offset=${String(offset)}`}
    />,
    "/email/messages",
  );
}

describe("the message list", () => {
  const page = (items: AdminEmailMessage[], total = items.length): MessageListState => ({
    status: "ready",
    data: { items, total, limit: 50, offset: 0 },
  });

  it("renders every state without hardcoded text", () => {
    const states: MessageListState[] = [
      { status: "loading" },
      page([
        message(),
        message({ id: "x", status: "failed", lastErrorCode: "unavailable:timeout" }),
      ]),
      page([]),
      { status: "forbidden" },
      { status: "error", failure: { kind: "network" } },
    ];
    for (const state of states) {
      const html = results(state);
      expect(
        leftoverText(
          html
            .split("order.placed")
            .join(" ")
            .split("anna@example.com")
            .join(" ")
            .split("unavailable:timeout")
            .join(" ")
            .split(formatDateTime("2026-10-26T10:00:00.000Z", "en"))
            .join(" "),
        ),
        state.status,
      ).toBe("");
    }
  });

  it("links each row to its detail, shows the status as text with a tone, the address and the translated last error", () => {
    const html = results(
      page([message({ status: "failed", lastErrorCode: "rejected:validation_error" })]),
    );
    expect(html).toContain('href="/admin-ui/email/messages/0b5f8a52-7a9e-4c7a-9d0e-1a2b3c4d5e6f"');
    expect(html).toContain("§mail.status.failed");
    expect(html).toContain("border-danger");
    expect(html).toContain("anna@example.com");
    expect(html).toContain("§mail.code.rejected");
    expect(html).toContain("<caption");
  });

  it("tells an unfiltered empty list from a filtered one, and a page past the end", () => {
    expect(results(page([]))).toContain("§mail.list.emptyTitle");
    expect(results(page([]), { ...queryBare, status: "failed" })).toContain(
      "§mail.list.noMatchTitle",
    );
    expect(results(page([]), { ...queryBare, offset: 50 })).toContain("§mail.list.pastEnd");
  });

  it("pages with links and spells out the range", () => {
    const html = results(
      { status: "ready", data: { items: [message()], total: 120, limit: 50, offset: 50 } },
      { ...queryBare, offset: 50 },
    );
    expect(html).toContain("§mail.list.pageRange");
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });
});

describe("the message detail", () => {
  it("shows the journal fields of a failed mail with the translated code beside the raw one", () => {
    const html = renderInRouter(
      <MessageFacts
        t={sentinel}
        uiLocale="en"
        message={detail({ status: "failed", attempts: 3, lastErrorCode: "deadline_passed" })}
      />,
    );
    for (const label of [
      "status",
      "template",
      "attempts",
      "deadline",
      "lastError",
      "providerCode",
    ]) {
      expect(html).toContain(`§mail.detail.${label}`);
    }
    expect(html).toContain("§mail.code.deadline_passed");
    expect(html).toContain("deadline_passed");
  });

  it("shows the next attempt only while pending and the lease only while sending", () => {
    const pending = renderInRouter(
      <MessageFacts
        t={sentinel}
        uiLocale="en"
        message={detail({ status: "pending", canCancel: true })}
      />,
    );
    expect(pending).toContain("§mail.detail.nextAttempt");
    expect(pending).not.toContain("§mail.detail.leaseUntil");
    const sending = renderInRouter(
      <MessageFacts
        t={sentinel}
        uiLocale="en"
        message={detail({ status: "sending", leaseUntil: "2026-10-26T10:02:00.000Z" })}
      />,
    );
    expect(sending).toContain("§mail.detail.leaseUntil");
    expect(sending).not.toContain("§mail.detail.nextAttempt");
  });

  it("links the order, the customer and the original of a resend", () => {
    const html = renderInRouter(
      <MessageFacts
        t={sentinel}
        uiLocale="en"
        message={detail({
          orderId: "11111111-1111-4111-8111-111111111111",
          customerId: "22222222-2222-4222-8222-222222222222",
          resendOf: "33333333-3333-4333-8333-333333333333",
        })}
      />,
    );
    expect(html).toContain('href="/admin-ui/orders/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('href="/admin-ui/customers/22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('href="/admin-ui/email/messages/33333333-3333-4333-8333-333333333333"');
  });

  it("shows redacted values as hidden, never the marker, and hostile data as text", () => {
    const html = renderInRouter(
      <VariablesTable
        t={sentinel}
        variables={{ name: "[redacted]", note: '<img src=x onerror="alert(1)">' }}
      />,
    );
    expect(html).toContain("§mail.detail.redacted");
    expect(html).not.toContain("[redacted]");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<caption");
  });

  it("offers resend and cancel as buttons only when allowed", () => {
    const render = (m: AdminEmailMessage, canManage: boolean) =>
      renderInRouter(
        <MessageActions
          t={sentinel}
          message={detail(m)}
          canManage={canManage}
          busy={false}
          onAction={noop}
        />,
      );
    expect(render(message({ canResend: true }), true)).toContain("§mail.action.resend");
    expect(render(message({ canResend: true }), true)).not.toContain("§mail.action.cancel");
    expect(
      render(message({ canResend: false, canCancel: true, status: "pending" }), true),
    ).toContain("§mail.action.cancel");
    expect(render(message({ canResend: true }), false)).toBe("");
  });

  it("words each notice, and links the new message of a resend", () => {
    const resent = renderInRouter(
      <MessageNoticeView t={sentinel} notice={{ kind: "resent", messageId: "abc" }} />,
    );
    expect(resent).toContain('href="/admin-ui/email/messages/abc"');
    expect(
      renderInRouter(<MessageNoticeView t={sentinel} notice={{ kind: "cancelled" }} />),
    ).toContain("§mail.notice.cancelled");
    expect(
      renderInRouter(
        <MessageNoticeView t={sentinel} notice={{ kind: "lost", action: "resend" }} />,
      ),
    ).toContain("§mail.notice.lost.resend");
    expect(renderInRouter(<MessageNoticeView t={sentinel} notice={null} />)).toBe("");
  });
});

describe("the templates and the preview", () => {
  const templates = {
    items: [
      { key: "order.placed", version: 1, category: "order" as const, locales: ["uk", "en"] },
      {
        key: "customer.password_reset",
        version: 2,
        category: "account" as const,
        locales: ["uk", "en"],
      },
    ],
  };

  it("lists key, version, category and languages with links to the preview", () => {
    const html = renderInRouter(
      <TemplatesView t={sentinel} state={{ status: "ready", data: templates }} onRetry={noop} />,
    );
    expect(html).toContain('href="/admin-ui/email/templates/order.placed"');
    expect(html).toContain('href="/admin-ui/email/templates/order.placed?locale=uk"');
    expect(html).toContain("§mail.category.order");
    expect(html).toContain("<caption");
  });

  it("renders the empty and failed states", () => {
    expect(
      renderInRouter(
        <TemplatesView
          t={sentinel}
          state={{ status: "ready", data: { items: [] } }}
          onRetry={noop}
        />,
      ),
    ).toContain("§mail.templates.emptyTitle");
    expect(
      renderInRouter(<TemplatesView t={sentinel} state={{ status: "forbidden" }} onRetry={noop} />),
    ).toContain("§error.forbiddenData");
  });

  it("marks the shown language with aria-current", () => {
    const html = renderInRouter(
      <PreviewLocaleSwitch
        t={sentinel}
        templateKey="order.placed"
        locales={["uk", "en"]}
        current="en"
      />,
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*>§mail\.locale\.en|§mail\.locale\.en<\/a>/);
  });

  describe("the sandboxed frame", () => {
    const hostile = '<script>alert(1)</script><p style="color:red">Hi "there"</p>';
    const iframeTag = (html: string) => /<iframe\b[^>]*>/.exec(html)?.[0] ?? "";

    it("has an EMPTY sandbox: no scripts, no same-origin, no forms, no popups", () => {
      expect(PREVIEW_SANDBOX).toBe("");
      const tag = iframeTag(renderToStaticMarkup(<SandboxedMailFrame title="T" html={hostile} />));
      expect(tag).toMatch(/\bsandbox=""/);
      expect(tag).not.toMatch(/allow-/);
      expect(tag).not.toMatch(/allow-scripts|allow-same-origin/);
    });

    it("passes the HTML as srcdoc (escaped), never as a child or a src, with no referrer", () => {
      const markup = renderToStaticMarkup(<SandboxedMailFrame title="T" html={hostile} />);
      const tag = iframeTag(markup);
      expect(tag).toMatch(/\bsrcdoc="/i);
      expect(tag).not.toMatch(/\bsrc="/i);
      expect(tag).toMatch(/referrerpolicy="no-referrer"/i);
      // The markup is attribute-escaped: no script element exists in the admin page itself.
      expect(markup).not.toContain("<script");
      expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(markup).toContain("</iframe>");
      expect(markup.replace(iframeTag(markup), "")).toBe("</iframe>");
    });

    it("gives the frame an accessible name", () => {
      expect(
        iframeTag(renderToStaticMarkup(<SandboxedMailFrame title="Preview" html="" />)),
      ).toContain('title="Preview"');
    });
  });

  it("renders the preview: subject as text, plain-text part in a pre, the HTML only in the frame", () => {
    const preview: AdminEmailPreview = {
      key: "order.placed",
      version: 1,
      category: "order",
      locale: "en",
      subject: "Order <b>1</b>",
      html: "<!doctype html><p>Hello</p>",
      text: "Hello\nWorld",
    };
    const html = renderInRouter(<PreviewBody t={sentinel} preview={preview} />);
    expect(html).toContain("Order &lt;b&gt;1&lt;/b&gt;");
    expect(html).toContain("<pre");
    expect(html).toContain("Hello\nWorld");
    expect(html.match(/<iframe\b/g)).toHaveLength(1);
    expect(html).toMatch(/<iframe\b[^>]*\bsandbox=""/);
    expect(html).not.toContain("<p>Hello</p>");
    expect(html).toContain("§mail.preview.sampleNote");
  });
});

describe("with the real messages of the area (both languages)", () => {
  const messages = {} as Record<"uk" | "en", Awaited<ReturnType<typeof messagesForArea>>>;
  beforeAll(async () => {
    messages.uk = await messagesForArea("uk", MESSAGE_FILES);
    messages.en = await messagesForArea("en", MESSAGE_FILES);
  });

  it("renders the status screen with no key left over and no missing message", () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(messages[locale], locale);
      const html = renderInRouter(
        <StatusView
          t={t}
          uiLocale={locale}
          state={{ status: "ready", data: status({ configured: false, providerCode: null }) }}
          now={NOW}
          onRetry={noop}
          testSend={() => null}
        />,
      );
      expect(html, locale).not.toMatch(/mail\.[a-z]+\.[a-zA-Z]+/);
      expect(html, locale).toContain("EMAIL_PROVIDER");
      expect(html, locale).not.toMatch(/re_[A-Za-z0-9]{8,}/);
    }
  });

  it("gives the frame and every control an accessible name in words", () => {
    const t = createTranslator(messages.uk, "uk");
    const html = renderInRouter(
      <PreviewBody
        t={t}
        preview={{
          key: "order.placed",
          version: 1,
          category: "order",
          locale: "uk",
          subject: "S",
          html: "<p>x</p>",
          text: "x",
        }}
      />,
    );
    expect(textAttributes(html)).toContain("Перегляд HTML-листа");
  });
});
