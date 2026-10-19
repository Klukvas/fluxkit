import { Button, createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatDate } from "../lib/date";
import { clientFailure, failureFromResult, missingRequired, type Failure } from "../lib/failure";
import { customer } from "../lib/test-fixtures";
import en from "../messages/en.json";
import uk from "../messages/uk.json";
import { AccountGateView } from "./account-gate";
import { AccountOverviewView } from "./account-overview";
import { AlreadySignedInView, LoginFormView, type LoginFormViewProps } from "./login-form";
import { PasswordFormView, ProfileFormView } from "./profile-forms";
import { RegisterFormView, type RegisterFormViewProps } from "./register-form";
import { CartNoticesView } from "./session-notices";
import {
  findElements,
  leftoverText,
  sentinelTranslator,
  textAttributes,
  textOf,
} from "./test-helpers";

const t = sentinelTranslator();

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

const loginProps = (overrides: Partial<LoginFormViewProps> = {}): LoginFormViewProps => ({
  t,
  values: { email: "", password: "" },
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  summaryRef: null,
  registerHref: "/uk/account/register?next=%2Fuk%2Fcart",
  ...overrides,
});

const registerProps = (overrides: Partial<RegisterFormViewProps> = {}): RegisterFormViewProps => ({
  t,
  values: { email: "", password: "", firstName: "", lastName: "", phone: "" },
  onValueChange: vi.fn(),
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  summaryRef: null,
  loginHref: "/uk/account/login",
  ...overrides,
});

const formBase = {
  t,
  onSubmit: vi.fn(),
  pending: false,
  failure: null,
  saved: false,
  summaryRef: null,
};

/** The `<input ...>` tag of the control with this id. */
function inputOf(html: string, id: string): string {
  const match = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  expect(match, `input #${id}`).not.toBeNull();
  return (match as RegExpMatchArray)[0];
}

describe("LoginFormView", () => {
  const html = renderToStaticMarkup(<LoginFormView {...loginProps()} />);

  it("labels both inputs and gives each the autocomplete value password managers expect", () => {
    expect(html).toContain('<label for="login-email"');
    expect(html).toContain('<label for="login-password"');
    const email = inputOf(html, "login-email");
    expect(email).toContain('type="email"');
    expect(email).toContain('autoComplete="email"');
    expect(email).toContain("required");
    const password = inputOf(html, "login-password");
    expect(password).toContain('type="password"');
    expect(password).toContain('autoComplete="current-password"');
    expect(password).toContain("required");
  });

  it("has one h1, a submit button and a link to registration that keeps next", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('type="submit"');
    expect(html).toContain('href="/uk/account/register?next=%2Fuk%2Fcart"');
    expect(html).not.toContain('role="alert"');
  });

  it("disables the button and announces busy while a request is pending (no double submit)", () => {
    const pending = renderToStaticMarkup(<LoginFormView {...loginProps({ pending: true })} />);
    expect(pending).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/,
    );
    expect(pending).toContain('aria-busy="true"');
    expect(pending).toContain("§account.login.submitting");
    expect(html).not.toContain('aria-busy="true"');
  });

  it("shows a refused sign-in as ONE message that marks neither field", () => {
    const failure = failed(401, "unauthorized");
    const refused: Failure = { ...failure, messageKey: "account.login.invalid", fieldErrors: [] };
    const markup = renderToStaticMarkup(<LoginFormView {...loginProps({ failure: refused })} />);
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("§account.login.invalid");
    expect(markup).not.toContain('aria-invalid="true"');
    expect(markup).not.toContain("aria-describedby");
  });

  it("marks the invalid field, links its error and lists it in the summary with a link to the field", () => {
    const failure = missingRequired({ email: "", password: "x" }, ["email", "password"]) as Failure;
    const markup = renderToStaticMarkup(<LoginFormView {...loginProps({ failure })} />);
    const email = inputOf(markup, "login-email");
    expect(email).toContain('aria-invalid="true"');
    expect(email).toContain('aria-describedby="login-email-error"');
    expect(markup).toContain('id="login-email-error"');
    expect(markup).toContain('href="#login-email"');
    expect(inputOf(markup, "login-password")).not.toContain('aria-invalid="true"');
    // The summary wrapper can take the focus.
    expect(markup).toMatch(/<div tabindex="-1"[^>]*>|<div[^>]*tabindex="-1"/i);
  });
});

describe("RegisterFormView", () => {
  const html = renderToStaticMarkup(<RegisterFormView {...registerProps()} />);

  it("gives every input its autocomplete token", () => {
    expect(inputOf(html, "register-email")).toContain('autoComplete="email"');
    expect(inputOf(html, "register-password")).toContain('autoComplete="new-password"');
    expect(inputOf(html, "register-first-name")).toContain('autoComplete="given-name"');
    expect(inputOf(html, "register-last-name")).toContain('autoComplete="family-name"');
    expect(inputOf(html, "register-phone")).toContain('autoComplete="tel"');
    expect(inputOf(html, "register-phone")).toContain('type="tel"');
    expect(inputOf(html, "register-password")).toContain('type="password"');
  });

  it("states the password rules as a hint linked to the field, and marks the phone optional", () => {
    expect(html).toContain("§account.password.rules");
    expect(inputOf(html, "register-password")).toContain(
      'aria-describedby="register-password-hint"',
    );
    expect(html).toContain('id="register-password-hint"');
    expect(html).toContain("§account.field.phoneOptional");
    expect(inputOf(html, "register-phone")).not.toContain("required");
    expect(inputOf(html, "register-first-name")).toContain("required");
  });

  it("shows the API's password and email errors from errors.field.* and a taken email in plain words", () => {
    const failure = {
      ...failed(400, "validation_failed", {
        errors: [
          { path: "password", code: "too_short" },
          { path: "email", code: "conflict" },
        ],
      }),
    };
    failure.fieldErrors[1] = {
      path: "email",
      code: "conflict",
      messageKey: "account.register.emailTaken",
    };
    const markup = renderToStaticMarkup(<RegisterFormView {...registerProps({ failure })} />);
    expect(markup).toContain("§errors.field.too_short");
    expect(markup).toContain("§account.register.emailTaken");
    expect(inputOf(markup, "register-password")).toContain('aria-invalid="true"');
    expect(inputOf(markup, "register-password")).toContain(
      "register-password-hint register-password-error",
    );
    expect(markup).not.toContain("English detail");
  });
});

describe("ProfileFormView and PasswordFormView", () => {
  it("edit the profile with the names and phone autocomplete tokens", () => {
    const html = renderToStaticMarkup(
      <ProfileFormView
        {...formBase}
        values={{ firstName: "Ada", lastName: "S", phone: "" }}
        onValueChange={vi.fn()}
      />,
    );
    expect(inputOf(html, "profile-first-name")).toContain('autoComplete="given-name"');
    expect(inputOf(html, "profile-first-name")).toContain('value="Ada"');
    expect(inputOf(html, "profile-last-name")).toContain('autoComplete="family-name"');
    expect(inputOf(html, "profile-phone")).toContain('autoComplete="tel"');
    expect(html).not.toContain("§account.profile.saved");
    const saved = renderToStaticMarkup(
      <ProfileFormView
        {...formBase}
        saved
        values={{ firstName: "A", lastName: "S", phone: "" }}
        onValueChange={vi.fn()}
      />,
    );
    expect(saved).toContain("§account.profile.saved");
    expect(saved).toContain('<div role="status">');
  });

  it("change the password with current-password and new-password, empty and never echoed", () => {
    const html = renderToStaticMarkup(
      <PasswordFormView
        {...formBase}
        values={{ currentPassword: "", newPassword: "" }}
        onValueChange={vi.fn()}
      />,
    );
    const current = inputOf(html, "password-current");
    expect(current).toContain('autoComplete="current-password"');
    expect(current).toContain('type="password"');
    const next = inputOf(html, "password-new");
    expect(next).toContain('autoComplete="new-password"');
    expect(next).toContain('type="password"');
    expect(next).toContain('aria-describedby="password-new-hint"');
    expect(html).toContain("§account.password.rules");
  });

  it("map the API's wrong-current-password error to the current password field", () => {
    const failure = failed(400, "validation_failed", {
      errors: [{ path: "currentPassword", code: "incorrect" }],
    });
    const html = renderToStaticMarkup(
      <PasswordFormView
        {...formBase}
        failure={failure}
        values={{ currentPassword: "", newPassword: "" }}
        onValueChange={vi.fn()}
      />,
    );
    expect(inputOf(html, "password-current")).toContain('aria-invalid="true"');
    expect(html).toContain("§errors.field.incorrect");
  });
});

describe("AccountGateView", () => {
  const gate = (state: Parameters<typeof AccountGateView>[0]["state"]) =>
    renderToStaticMarkup(
      <AccountGateView
        state={state}
        t={t}
        title="§title"
        signInHref="/uk/account/login?next=%2Fuk%2Faccount"
        onRetry={vi.fn()}
      >
        {(who) => <p>§inside {who.id}</p>}
      </AccountGateView>,
    );

  it("shows the page only to a signed-in customer", () => {
    expect(gate({ status: "signedIn", customer: customer() })).toContain("§inside customer-1");
    for (const status of ["loading", "guest", "error"] as const) {
      expect(gate({ status })).not.toContain("§inside");
    }
  });

  it("sends a guest to the login page with the page they wanted as next", () => {
    const html = gate({ status: "guest" });
    expect(html).toContain('href="/uk/account/login?next=%2Fuk%2Faccount"');
    expect(html).toContain("§account.gate.redirecting");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("offers a retry when the session cannot be read, and a busy skeleton while it loads", () => {
    expect(gate({ status: "error" })).toContain("§account.gate.retry");
    const loading = gate({ status: "loading" });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("§account.loading");
    // Every state of the route has one heading, the server-rendered one too.
    for (const status of ["loading", "guest", "error"] as const) {
      expect(gate({ status }).match(/<h1[^>]*>§title<\/h1>/g), status).toHaveLength(1);
    }
    expect(gate({ status: "signedIn", customer: customer() })).not.toContain("§title");
  });
});

describe("AccountOverviewView", () => {
  it("shows the customer's details as text, never as markup", () => {
    const real = createTranslator(en, "en");
    const hostile = customer({
      firstName: "<script>alert(1)</script>",
      lastName: '"><img src=x onerror=alert(2)>',
      email: "x@example.test",
    });
    const html = renderToStaticMarkup(
      <AccountOverviewView
        customer={hostile}
        t={real}
        locale="en"
        pending={false}
        failure={null}
        onLogout={vi.fn()}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("x@example.test");
    expect(html).toContain("Not set");
    expect(html).toContain("October 1, 2026");
  });

  it("signs out through the logout button and links to the profile page", () => {
    const onLogout = vi.fn();
    const view = (
      <AccountOverviewView
        customer={customer()}
        t={t}
        locale="uk"
        pending={false}
        failure={null}
        onLogout={onLogout}
      />
    );
    const element = AccountOverviewView({
      customer: customer(),
      t,
      locale: "uk",
      pending: false,
      failure: null,
      onLogout,
    });
    const [logout] = findElements(
      element,
      (candidate) =>
        candidate.type === Button &&
        textOf(candidate.props.children as never) === "§account.logout",
    );
    expect(logout).toBeDefined();
    (logout?.props.onClick as () => void)();
    expect(onLogout).toHaveBeenCalledTimes(1);
    const html = renderToStaticMarkup(view);
    expect(html).toContain('href="/uk/account/profile"');
    expect(html).toContain('href="/uk/account/orders"');
    expect(html).toContain("§account.overview.orders");
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("disables sign-out while it runs and shows a failed one in an alert", () => {
    const html = renderToStaticMarkup(
      <AccountOverviewView
        customer={customer()}
        t={t}
        locale="uk"
        pending
        failure={clientFailure("errors.network")}
        onLogout={vi.fn()}
      />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("§account.logout.pending");
    expect(html).toContain('role="alert"');
    expect(html).toContain("§errors.network");
  });
});

describe("CartNoticesView", () => {
  it("renders nothing without notices", () => {
    expect(renderToStaticMarkup(<CartNoticesView notices={[]} t={t} onDismiss={vi.fn()} />)).toBe(
      "",
    );
  });

  it("lists each notice of a sign-in exactly once, with a dismiss button wired to onDismiss", () => {
    const onDismiss = vi.fn();
    const notices = [{ code: "quantity_capped" }, { code: "lines_dropped" }] as const;
    const element = CartNoticesView({ notices, t, onDismiss });
    const html = renderToStaticMarkup(
      <CartNoticesView notices={notices} t={t} onDismiss={onDismiss} />,
    );
    expect(html.match(/§account\.cartNotice\.quantity_capped/g)).toHaveLength(1);
    expect(html.match(/§account\.cartNotice\.lines_dropped/g)).toHaveLength(1);
    expect(html.match(/§account\.cartNotice\.dismiss/g)).toHaveLength(1);
    expect(html).toContain('role="status"');
    const [dismiss] = findElements(element, (candidate) => candidate.type === Button);
    (dismiss?.props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("words a notice code from the future generically instead of failing", () => {
    const html = renderToStaticMarkup(
      <CartNoticesView notices={[{ code: "something_new" } as never]} t={t} onDismiss={vi.fn()} />,
    );
    expect(html).toContain("§account.cartNotice.generic");
  });
});

describe("account views: language and text", () => {
  const createdAt = "2026-10-01T10:00:00.000Z";
  const signedIn = {
    status: "signedIn",
    customer: customer({ firstName: "§n", lastName: "§l", email: "§e", phone: "§p" }),
  } as const;
  const views = (translator: typeof t, locale: "uk" | "en") => ({
    login: <LoginFormView {...loginProps({ t: translator })} />,
    loginFailed: (
      <LoginFormView
        {...loginProps({ t: translator, failure: clientFailure("account.login.invalid") })}
      />
    ),
    register: <RegisterFormView {...registerProps({ t: translator })} />,
    profile: (
      <ProfileFormView
        {...formBase}
        t={translator}
        saved
        values={{ firstName: "", lastName: "", phone: "" }}
        onValueChange={vi.fn()}
      />
    ),
    password: (
      <PasswordFormView
        {...formBase}
        t={translator}
        saved
        values={{ currentPassword: "", newPassword: "" }}
        onValueChange={vi.fn()}
      />
    ),
    overview: (
      <AccountOverviewView
        customer={signedIn.customer}
        t={translator}
        locale={locale}
        pending={false}
        failure={null}
        onLogout={vi.fn()}
      />
    ),
    already: <AlreadySignedInView t={translator} locale={locale} session={signedIn} />,
    notices: (
      <CartNoticesView notices={[{ code: "lines_dropped" }]} t={translator} onDismiss={vi.fn()} />
    ),
  });

  it("has no hardcoded text and no untranslated label", () => {
    for (const [name, element] of Object.entries(views(t, "uk"))) {
      // The member-since date is formatted data, like a price.
      const html = renderToStaticMarkup(element).replaceAll(formatDate(createdAt, "uk"), "");
      expect(leftoverText(html), name).toBe("");
      for (const value of textAttributes(html))
        expect(value.startsWith("§"), `${name}: ${value}`).toBe(true);
    }
  });

  it("renders with the real Ukrainian and English messages (a missing key would throw)", () => {
    for (const [messages, locale] of [
      [uk, "uk"],
      [en, "en"],
    ] as const) {
      for (const element of Object.values(views(createTranslator(messages, locale), locale))) {
        expect(() => renderToStaticMarkup(element)).not.toThrow();
      }
    }
  });
});
