import { createTranslator, type Messages } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createAccountStore } from "../lib/account-store";
import { clientFailure, failureFromResult, type Failure } from "../lib/failure";
import { checkNewPasswords } from "../lib/reset-password-form";
import { immediateClient, json } from "../lib/test-fetch";
import { customer } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { EmailUnavailableView } from "./account-email-parts";
import {
  FORGOT_IDS,
  ForgotPasswordFormView,
  ForgotPasswordSentView,
  type ForgotPasswordFormViewProps,
} from "./account-forgot-password";
import {
  RESET_IDS,
  ResetPasswordDoneView,
  ResetPasswordFormView,
  ResetPasswordInvalidView,
  type ResetPasswordFormViewProps,
} from "./account-reset-password";
import {
  VerifyEmailDoneView,
  VerifyEmailErrorView,
  VerifyEmailInvalidView,
} from "./account-verify-email";
import {
  ResendVerificationView,
  VerifyEmailNotice,
  VerifyEmailNoticeView,
  type ResendState,
} from "./account-verify-notice";
import { ForgotPasswordPage } from "./account-forgot-password";
import { ResetPasswordPage } from "./account-reset-password";
import { VerifyEmailPage } from "./account-verify-email";
import { AccountOverviewView } from "./account-overview";
import { I18nProvider } from "./i18n-provider";
import { LoginFormView, type LoginFormViewProps } from "./login-form";
import { AccountStoreContext, StoreClientContext } from "./session-provider";
import { leftoverText, sentinelTranslator, textAttributes } from "./test-helpers";

const t = sentinelTranslator();
/** Every message key a rendered page names (`§key`), to compare with the message files. */
const usedKeys = new Set<string>();

function render(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  const html = renderToStaticMarkup(node);
  for (const match of html.matchAll(/§([A-Za-z0-9_.]+)/g)) usedKeys.add(match[1] as string);
  return html;
}

function inputOf(html: string, id: string): string {
  const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  expect(match, `input #${id}`).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

const forgotProps = (
  overrides: Partial<ForgotPasswordFormViewProps> = {},
): ForgotPasswordFormViewProps => ({
  t,
  values: { email: "" },
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  summaryRef: null,
  signInHref: "/uk/account/login",
  ...overrides,
});

const resetProps = (
  overrides: Partial<ResetPasswordFormViewProps> = {},
): ResetPasswordFormViewProps => ({
  t,
  values: { newPassword: "", confirmPassword: "" },
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  summaryRef: null,
  ...overrides,
});

const loginProps = (overrides: Partial<LoginFormViewProps> = {}): LoginFormViewProps => ({
  t,
  values: { email: "", password: "" },
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  summaryRef: null,
  registerHref: "/uk/account/register",
  ...overrides,
});

function failed(status: number, code: string, extra: Record<string, unknown> = {}): Failure {
  return failureFromResult({
    ok: false,
    status,
    retryAfter: null,
    problem: {
      type: "about:blank",
      title: "t",
      status,
      code,
      detail: "English detail",
      ...extra,
    } as never,
  });
}

describe("ForgotPasswordFormView", () => {
  const html = render(<ForgotPasswordFormView {...forgotProps()} />);

  it("is a post form with one h1 that can take the focus, a labelled email input and a submit button", () => {
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(html).toContain(`<label for="${FORGOT_IDS.email}"`);
    const email = inputOf(html, FORGOT_IDS.email);
    expect(email).toContain('type="email"');
    expect(email).toContain('autoComplete="email"');
    expect(email).toContain("required");
    expect(html).toContain('type="submit"');
    expect(html).toContain('href="/uk/account/login"');
  });

  it("disables the button and says busy while the request is pending", () => {
    const pending = render(<ForgotPasswordFormView {...forgotProps({ pending: true })} />);
    expect(pending).toMatch(/<button[^>]*disabled=""/);
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain("§account.forgot.submitting");
  });

  it("shows a 429 as one alert with the wait and a malformed address on the field, nothing about accounts", () => {
    const limited = { ...failed(429, "too_many_requests"), retryAfterSeconds: 30 };
    const markup = renderToStaticMarkup(
      <ForgotPasswordFormView {...forgotProps({ failure: limited, t: tWithPlural() })} />,
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("§errors.too_many_requests");
    expect(markup).toContain("§errors.retryAfter:30");
    const invalid = failed(400, "validation_failed", {
      errors: [{ path: "email", code: "invalid_format" }],
    });
    const fieldMarkup = render(<ForgotPasswordFormView {...forgotProps({ failure: invalid })} />);
    expect(inputOf(fieldMarkup, FORGOT_IDS.email)).toContain('aria-invalid="true"');
    expect(fieldMarkup).toContain("§errors.field.invalid_format");
  });
});

function tWithPlural() {
  return sentinelTranslator();
}

describe("ForgotPasswordSentView", () => {
  it("is the ONE neutral answer: no address, no 'account found' or 'not found' wording, a polite status message, a heading for the focus", () => {
    const html = render(
      <ForgotPasswordSentView t={t} onAnother={vi.fn()} signInHref="/en/account/login" />,
    );
    expect(html).toMatch(/<h1[^>]*tabindex="-1"[^>]*>§account\.forgot\.sent\.title<\/h1>/);
    expect(html).toMatch(/<p[^>]*role="status"[^>]*>§account\.forgot\.sent\.description<\/p>/);
    expect(html).toContain('href="/en/account/login"');
    expect(html).not.toContain("@");
  });

  it("says the same words in both locales for any input (the message keys are fixed)", () => {
    expect(en["account.forgot.sent.description"]).toMatch(/^If an account exists/);
    expect(uk["account.forgot.sent.description"]).toMatch(/^Якщо .* існує обліковий запис/);
    for (const messages of [en, uk] as Record<string, string>[]) {
      expect(messages["account.forgot.sent.description"]).not.toMatch(/\{/);
      expect(messages["account.forgot.sent.title"]).not.toMatch(/\{/);
    }
  });
});

describe("ResetPasswordFormView", () => {
  const html = render(<ResetPasswordFormView {...resetProps()} />);

  it("has two labelled new-password fields with the password-manager token, the policy hint and a post form", () => {
    expect(html).toMatch(/<form[^>]*method="post"/);
    for (const id of [RESET_IDS.newPassword, RESET_IDS.confirmPassword]) {
      expect(html).toContain(`<label for="${id}"`);
      const input = inputOf(html, id);
      expect(input).toContain('type="password"');
      expect(input).toContain('autoComplete="new-password"');
      expect(input).toContain("required");
    }
    expect(html).toContain("§account.password.rules");
    expect(inputOf(html, RESET_IDS.newPassword)).toContain(
      `aria-describedby="${RESET_IDS.newPassword}-hint"`,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("shows the API's policy answer on the new password and a mismatch on the repeat field, with summary links to both", () => {
    const policy = failed(400, "validation_failed", {
      errors: [{ path: "newPassword", code: "equals_email" }],
    });
    const markup = render(<ResetPasswordFormView {...resetProps({ failure: policy })} />);
    expect(markup).toContain("§errors.field.equals_email");
    expect(inputOf(markup, RESET_IDS.newPassword)).toContain('aria-invalid="true"');
    expect(markup).toContain(`href="#${RESET_IDS.newPassword}"`);

    const mismatch = checkNewPasswords({
      newPassword: "aaaaaaaaaaaa",
      confirmPassword: "bbbbbbbbbbbb",
    });
    const mismatchMarkup = render(
      <ResetPasswordFormView {...resetProps({ failure: mismatch as Failure })} />,
    );
    expect(mismatchMarkup).toContain("§account.reset.mismatch");
    expect(inputOf(mismatchMarkup, RESET_IDS.confirmPassword)).toContain('aria-invalid="true"');
    expect(inputOf(mismatchMarkup, RESET_IDS.newPassword)).not.toContain('aria-invalid="true"');
    expect(mismatchMarkup).toContain(`href="#${RESET_IDS.confirmPassword}"`);
  });

  it("never renders what was typed into a URL or text outside the inputs (values only in `value`)", () => {
    const markup = render(
      <ResetPasswordFormView
        {...resetProps({
          values: { newPassword: "Sup3r-secret-pass", confirmPassword: "Sup3r-secret-pass" },
        })}
      />,
    );
    expect(markup.replace(/value="[^"]*"/g, "")).not.toContain("Sup3r-secret-pass");
  });
});

describe("the outcome states of the reset page", () => {
  it("done: a heading for the focus, a status message and a link to sign in (no automatic sign-in, no form)", () => {
    const html = render(<ResetPasswordDoneView t={t} signInHref="/uk/account/login" />);
    expect(html).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/uk/account/login"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });

  it("invalid: one state with a link to request a new link and no form", () => {
    const html = render(
      <ResetPasswordInvalidView t={t} requestHref="/uk/account/forgot-password" />,
    );
    expect(html).toContain("§account.reset.invalid.title");
    expect(html).toContain('href="/uk/account/forgot-password"');
    expect(html).toContain("§account.reset.requestNew");
    expect(html).not.toContain("<form");
  });
});

describe("the states of the verify page", () => {
  it("verified: heading, status message, link to the account", () => {
    const html = render(<VerifyEmailDoneView t={t} accountHref="/en/account" />);
    expect(html).toMatch(/<h1[^>]*tabindex="-1"[^>]*>§account\.verify\.done\.title/);
    expect(html).toContain('href="/en/account"');
  });

  it("invalid: one heading, one message, and whatever the caller adds for this visitor", () => {
    const html = render(
      <VerifyEmailInvalidView t={t}>
        <a href="/uk/account/login">go</a>
      </VerifyEmailInvalidView>,
    );
    expect(html).toContain("§account.verify.invalid.title");
    expect(html).toContain("§account.verify.invalid.description");
    expect(html).toContain('href="/uk/account/login"');
  });

  it("error: the failure as an alert and a retry button", () => {
    const html = render(
      <VerifyEmailErrorView t={t} failure={clientFailure("errors.network")} onRetry={vi.fn()} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("§errors.network");
    expect(html).toContain("§account.verify.retry");
  });
});

describe("EmailUnavailableView", () => {
  it("is a friendly 'not available' state with a link to sign in and no form", () => {
    const html = render(<EmailUnavailableView t={t} signInHref="/uk/account/login" />);
    expect(html).toContain("§account.emailPage.unavailable.title");
    expect(html).toContain('href="/uk/account/login"');
    expect(html).not.toContain("<form");
  });
});

describe("ResendVerificationView", () => {
  const view = (state: ResendState) =>
    render(<ResendVerificationView t={t} state={state} onSend={vi.fn()} />);

  it("always has its polite live region, so an announcement has an element to appear in", () => {
    for (const status of ["idle", "sending", "sent", "alreadyVerified", "unavailable"] as const) {
      expect(view({ status }), status).toMatch(/<p[^>]*role="status"[^>]*aria-live="polite"/);
    }
  });

  it("disables the button while sending and words each outcome", () => {
    expect(view({ status: "sending" })).toMatch(/<button[^>]*disabled=""/);
    expect(view({ status: "sent" })).toContain("§account.verifyNotice.sent");
    expect(view({ status: "alreadyVerified" })).toContain("§account.verifyNotice.alreadyVerified");
    expect(view({ status: "unavailable" })).toContain("§account.verifyNotice.unavailable");
    expect(view({ status: "failed", failure: clientFailure("errors.network") })).toContain(
      'role="alert"',
    );
  });
});

describe("the sign-in page link and the account notice depend on emailDelivery", () => {
  it("shows 'Forgot password?' on the sign-in form only with a forgot link", () => {
    const withLink = render(
      <LoginFormView {...loginProps({ forgotHref: "/uk/account/forgot-password" })} />,
    );
    expect(withLink).toContain('href="/uk/account/forgot-password"');
    expect(withLink).toContain("§account.login.forgot");
    const without = render(<LoginFormView {...loginProps()} />);
    expect(without).not.toContain("forgot");
  });

  const messages = en as Messages;
  function inShell(node: React.ReactNode, client = immediateClient(() => json({})).client) {
    const store = createAccountStore({ client });
    return renderToStaticMarkup(
      <I18nProvider locale="en" messages={messages}>
        <StoreClientContext.Provider value={client}>
          <AccountStoreContext.Provider value={store}>{node}</AccountStoreContext.Provider>
        </StoreClientContext.Provider>
      </I18nProvider>,
    );
  }

  it("hides the notice with emailDelivery false and for a verified customer; shows it with a send-again button otherwise", () => {
    const unverified = customer({ emailVerified: false, email: "ada@example.test" });
    expect(inShell(<VerifyEmailNotice customer={unverified} emailDelivery={false} />)).toBe("");
    expect(
      inShell(<VerifyEmailNotice customer={customer({ emailVerified: true })} emailDelivery />),
    ).toBe("");
    const shown = inShell(<VerifyEmailNotice customer={unverified} emailDelivery />);
    expect(shown).toContain("Confirm your email address");
    expect(shown).toContain("ada@example.test");
    expect(shown).toContain("Send the link again");
  });

  it("the three pages show the friendly 'not available' state, no form and no input, when the shop sends no email", () => {
    for (const page of [
      <ForgotPasswordPage key="1" emailDelivery={false} />,
      <ResetPasswordPage key="2" emailDelivery={false} />,
      <VerifyEmailPage key="3" emailDelivery={false} />,
    ]) {
      const html = inShell(page);
      expect(html).toContain("Not available");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<input");
    }
  });

  it("with email the forgot page shows its form, and the token pages check their link first (the fragment is read in the browser)", () => {
    const forgot = inShell(<ForgotPasswordPage emailDelivery />);
    expect(forgot).toContain("<form");
    expect(forgot).not.toContain("Not available");
    for (const page of [
      <ResetPasswordPage key="1" emailDelivery />,
      <VerifyEmailPage key="2" emailDelivery />,
    ]) {
      const html = inShell(page);
      expect(html).toContain("Checking the link");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("Not available");
    }
  });

  it("the overview shows the 'confirmed' state only with a mail provider", () => {
    const verified = customer({ emailVerified: true });
    const base = {
      customer: verified,
      t,
      locale: "en" as const,
      pending: false,
      failure: null,
      onLogout: vi.fn(),
    };
    expect(render(<AccountOverviewView {...base} emailDelivery />)).toContain(
      "§account.verifyNotice.verified",
    );
    expect(render(<AccountOverviewView {...base} />)).not.toContain("verifyNotice");
    expect(render(<AccountOverviewView {...base} emailDelivery={false} />)).not.toContain(
      "verifyNotice",
    );
  });

  it("the notice's wrapper is a warning region with the address", () => {
    const html = render(
      <VerifyEmailNoticeView t={t} email="ada@example.test">
        <span>child</span>
      </VerifyEmailNoticeView>,
    );
    expect(html).toContain("§account.verifyNotice.title");
    expect(html).toContain("child");
  });
});

describe("translation and theming of the emailed-link views", () => {
  const views = [
    <ForgotPasswordFormView key="1" {...forgotProps()} />,
    <ForgotPasswordSentView key="2" t={t} onAnother={vi.fn()} signInHref="/uk" />,
    <ResetPasswordFormView key="3" {...resetProps()} />,
    <ResetPasswordDoneView key="4" t={t} signInHref="/uk" />,
    <ResetPasswordInvalidView key="5" t={t} requestHref="/uk" />,
    <VerifyEmailDoneView key="6" t={t} accountHref="/uk" />,
    <VerifyEmailInvalidView key="7" t={t} />,
    <VerifyEmailErrorView
      key="8"
      t={t}
      failure={clientFailure("errors.generic")}
      onRetry={vi.fn()}
    />,
    <EmailUnavailableView key="9" t={t} signInHref="/uk" />,
    <ResendVerificationView key="10" t={t} state={{ status: "sent" }} onSend={vi.fn()} />,
  ];

  it("hardcodes no words: after removing the sentinels no text or text attribute is left", () => {
    for (const view of views) {
      const html = renderToStaticMarkup(view);
      expect(leftoverText(html), html).toBe("");
      expect(
        textAttributes(html).filter((text) => !text.startsWith("§")),
        html,
      ).toEqual([]);
    }
  });

  it("uses only message keys that exist in uk and en, and never a literal colour or pixel size", () => {
    expect(usedKeys.size).toBeGreaterThan(20);
    for (const key of usedKeys) {
      if (key.endsWith(":30")) continue;
      expect(Object.keys(en), key).toContain(key);
      expect(Object.keys(uk), key).toContain(key);
    }
    for (const view of views) {
      const html = renderToStaticMarkup(view);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\d+px|rgb\(|style="/);
    }
  });

  it("translates through real catalogs in both locales", () => {
    for (const [locale, messages] of [
      ["uk", uk],
      ["en", en],
    ] as const) {
      const real = createTranslator(messages as Messages, locale);
      const html = renderToStaticMarkup(<ForgotPasswordFormView {...forgotProps({ t: real })} />);
      expect(html).toContain(real("account.forgot.title"));
      expect(html).not.toContain("account.forgot");
    }
  });
});
