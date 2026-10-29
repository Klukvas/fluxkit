import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { clientFailure, type Failure } from "../lib/failure";
import { mapDeleteFailure } from "../lib/personal-data";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { AccountDeletedView } from "./account-deleted";
import {
  BlockedView,
  DeleteSection,
  ExportSection,
  exportFailureText,
  waitText,
  type DeleteSectionProps,
  type ExportState,
} from "./account-data-views";
import { LegalNotice, noticeLinks } from "./legal-notice";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();

function deleteProps(overrides: Partial<DeleteSectionProps> = {}): DeleteSectionProps {
  return {
    t,
    values: { password: "", confirmWord: "" },
    onValueChange: vi.fn(),
    onSubmit: vi.fn(),
    pending: false,
    failure: null,
    blocked: null,
    summaryRef: null,
    blockedRef: null,
    ...overrides,
  };
}

function exportView(state: ExportState, translator = t): string {
  return renderToStaticMarkup(
    <ExportSection t={translator} state={state} onDownload={vi.fn()} statusRef={null} />,
  );
}

describe("download my data", () => {
  const states: ExportState[] = [
    { status: "idle" },
    { status: "pending" },
    { status: "done", file: "personal-data-2026-10-29.json" },
    { status: "failed", reason: { kind: "rate_limited", wait: { unit: "hours", count: 3 } } },
    { status: "failed", reason: { kind: "rate_limited", wait: null } },
    { status: "failed", reason: { kind: "too_large" } },
    { status: "failed", reason: { kind: "signed_out" } },
    { status: "failed", reason: { kind: "other", failure: clientFailure("errors.network") } },
  ];

  it("renders every state without hardcoded text, with the status line always in the page", () => {
    for (const state of states) {
      const html = exportView(state);
      expect(leftoverText(html).replace(/personal-data[\w.-]*/, ""), state.status).toBe("");
      expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
      // A live region has to exist before its content changes, or the change is not announced.
      expect(html, state.status).toMatch(/role="status"/);
      expect(html).toMatch(/<h2[^>]*>§account\.data\.export\.title<\/h2>/);
    }
  });

  it("disables the button while the request runs, and says why", () => {
    const html = exportView({ status: "pending" });
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>§account\.data\.export\.pending</,
    );
  });

  it("tells the daily limit with the wait from Retry-After in the shopper's plural forms", () => {
    const real = createTranslator(en, "en");
    expect(
      exportFailureText(real, { kind: "rate_limited", wait: { unit: "hours", count: 3 } }),
    ).toBe("You have downloaded your data too often today. Try again in about 3 hours.");
    expect(waitText(real, { unit: "minutes", count: 1 })).toBe("Try again in about 1 minute.");
    expect(waitText(real, null)).toBe("Please try again later.");
    const ukrainian = createTranslator(uk, "uk");
    expect(waitText(ukrainian, { unit: "hours", count: 2 })).toContain("2 години");
    expect(waitText(ukrainian, { unit: "hours", count: 5 })).toContain("5 годин");
    expect(waitText(ukrainian, { unit: "minutes", count: 21 })).toContain("21 хвилину");
  });
});

describe("delete my account", () => {
  it("is a post form with a password field, a typed word and a danger button, without hardcoded text", () => {
    const html = renderToStaticMarkup(<DeleteSection {...deleteProps()} />);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html).toMatch(
      /type="password"[^>]*autoComplete="current-password"|autoComplete="current-password"[^>]*type="password"/,
    );
    expect(html).toContain('name="confirmWord"');
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(leftoverText(html)).toBe("");
    expect(textAttributes(html).filter((text) => !text.startsWith("§"))).toEqual([]);
  });

  it("explains what is deleted, what the shop keeps and what it cannot reach, before the form", () => {
    const html = renderToStaticMarkup(<DeleteSection {...deleteProps()} />);
    const explanation = html.indexOf("§account.data.delete.keeps");
    for (const key of ["deletesAccount", "deletesCart", "deletesMail", "keeps", "limits"]) {
      expect(html).toContain(`§account.data.delete.${key}`);
    }
    expect(explanation).toBeGreaterThan(-1);
    expect(explanation).toBeLessThan(html.indexOf('name="password"'));
  });

  it("marks a wrong password on the password field, and lists a field error in the summary", () => {
    const wrong = mapDeleteFailure({
      ok: false,
      status: 400,
      retryAfter: null,
      problem: {
        type: "about:blank",
        title: "t",
        status: 400,
        code: "validation_failed",
        detail: "x",
        errors: [{ path: "password", code: "incorrect" }],
      },
    });
    expect(wrong.kind).toBe("other");
    const failure: Failure = wrong.kind === "other" ? wrong.failure : clientFailure("x");
    const html = renderToStaticMarkup(<DeleteSection {...deleteProps({ failure })} />);
    expect(html).toContain("§account.data.delete.wrongPassword");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('href="#delete-password"');
  });

  it("shows the blockers in words instead of the error summary, and nothing was changed", () => {
    const html = renderToStaticMarkup(
      <DeleteSection {...deleteProps({ blocked: ["open_order", "active_shipment"] })} />,
    );
    expect(html).toContain("§account.data.blocked.title");
    expect(html).toContain("§account.data.blocked.open_order");
    expect(html).toContain("§account.data.blocked.active_shipment");
    expect(html).not.toContain("§account.form.errorTitle");
  });

  it("words a refusal with no readable reason, and an unknown reason, without inventing one", () => {
    const empty = renderToStaticMarkup(<BlockedView t={t} reasons={[]} innerRef={null} />);
    expect(empty).toContain("§account.data.blocked.intro");
    expect(empty).not.toContain("<li");
    const unknown = renderToStaticMarkup(
      <BlockedView t={t} reasons={["new_one"]} innerRef={null} />,
    );
    expect(unknown).toContain("§account.data.blocked.unknown");
  });

  it("says when the daily or hourly limit was reached, with the wait", () => {
    const html = renderToStaticMarkup(
      <DeleteSection {...deleteProps({ limited: { unit: "minutes", count: 30 } })} />,
    );
    expect(html).toContain("§account.data.delete.limited");
    expect(html).toContain("§account.data.limit.minutes:30");
  });

  it("disables the button while the request runs", () => {
    const html = renderToStaticMarkup(<DeleteSection {...deleteProps({ pending: true })} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>§account\.data\.delete\.submitting</);
    expect(html).toContain('aria-busy="true"');
  });
});

describe("the confirmation page", () => {
  it("says the account was deleted, that the shopper is signed out and what stays, and links back to the shop", () => {
    const html = renderToStaticMarkup(<AccountDeletedView t={t} locale="en" />);
    expect(html).toContain("§account.data.deleted.title");
    expect(html).toContain("§account.data.deleted.body");
    expect(html).toContain("§account.data.deleted.orders");
    expect(html).toContain('href="/en"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(leftoverText(html)).toBe("");
  });
});

describe("the information sentence", () => {
  it("links the Terms and the Privacy notice inside the translator's own sentence, in both languages", () => {
    for (const [locale, messages] of [
      ["en", en],
      ["uk", uk],
    ] as const) {
      const real = createTranslator(messages, locale);
      for (const kind of ["register", "checkout"] as const) {
        const html = renderToStaticMarkup(
          <LegalNotice t={real} kind={kind} links={noticeLinks(locale)} />,
        );
        expect(html, `${locale} ${kind}`).toContain(`href="/${locale}/legal/terms"`);
        expect(html).toContain(`href="/${locale}/legal/privacy"`);
        expect(html).not.toContain("{terms}");
        expect(html).not.toContain("{privacy}");
        // No checkbox: the sentence informs, nothing is stored.
        expect(html).not.toContain("<input");
      }
    }
  });

  it("renders without hardcoded text with the sentinel translator", () => {
    const html = renderToStaticMarkup(
      <LegalNotice t={t} kind="checkout" links={noticeLinks("uk")} />,
    );
    expect(leftoverText(html)).toBe("");
  });
});

describe("with the real messages", () => {
  it("renders the data page sections in uk and en with no raw key left", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const real = createTranslator(messages, locale);
      const parts = [
        renderToStaticMarkup(
          <ExportSection
            t={real}
            state={{ status: "idle" }}
            onDownload={vi.fn()}
            statusRef={null}
          />,
        ),
        renderToStaticMarkup(
          <DeleteSection {...deleteProps({ t: real, blocked: ["open_order", "mail_sending"] })} />,
        ),
        renderToStaticMarkup(<AccountDeletedView t={real} locale={locale} />),
      ];
      for (const html of parts) expect(html).not.toMatch(/account\.data\.[a-z]+\.[A-Za-z_]+/);
    }
  });

  it("asks the shopper to type the word of their own language", () => {
    expect(createTranslator(uk, "uk")("account.data.delete.word")).toBe("ВИДАЛИТИ");
    expect(createTranslator(en, "en")("account.data.delete.word")).toBe("DELETE");
  });
});
