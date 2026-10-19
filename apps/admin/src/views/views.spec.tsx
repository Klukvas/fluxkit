import { describe, expect, it } from "vitest";
import { AccountDetailsView, PasswordFormView } from "../areas/account/account-page";
import { LoginFrame } from "../areas/auth/login-page";
import { SignInFormView, signInMessage, type SignInMessage } from "../areas/auth/sign-in-form";
import { HomeView } from "../areas/home/home-page";
import { LanguageSwitchView } from "../layout/language-switch";
import { ShellFrame } from "../layout/shell";
import { UserMenuView } from "../layout/user-menu";
import { leftoverText, renderInRouter, sentinelTranslator, textAttributes } from "../test-helpers";
import {
  ErrorView,
  FailureMessage,
  LoadingView,
  NotAllowedView,
  NotBuiltView,
  NotFoundView,
  ResourceFallback,
} from "./status-views";

const t = sentinelTranslator();
const noop = () => undefined;

function expectNoHardcodedText(html: string) {
  expect(leftoverText(html)).toBe("");
  for (const value of textAttributes(html)) expect(value.startsWith("§"), value).toBe(true);
}

function h1Count(html: string): number {
  return html.match(/<h1[ >]/g)?.length ?? 0;
}

describe("status views", () => {
  it("render one h1 each, a way back home, and only translated text", () => {
    const views = {
      notFound: renderInRouter(<NotFoundView t={t} />),
      notAllowed: renderInRouter(<NotAllowedView t={t} />),
      notBuilt: renderInRouter(<NotBuiltView t={t} titleKey="page.orders.title" />),
      error: renderInRouter(<ErrorView t={t} onReload={noop} />),
      home: renderInRouter(<HomeView t={t} />),
    };
    for (const [name, html] of Object.entries(views)) {
      expect(h1Count(html), name).toBe(1);
      expectNoHardcodedText(html);
    }
    // The router writes the start page as the bare base path; the edge proxy serves `/admin-ui` and `/admin-ui/*`.
    expect(views.notFound).toContain('href="/admin-ui"');
    expect(views.notAllowed).toContain("§notAllowed.title");
    expect(views.notBuilt).toContain("§page.orders.title");
    expect(views.notBuilt).toContain("§notBuilt.body");
    expect(views.error).toContain('<button type="button"');
  });

  it("renders loading as a busy status with a label", () => {
    const html = renderInRouter(<LoadingView t={t} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain("§status.loading");
    expectNoHardcodedText(html);
  });

  it("shows a failure's message, the unknown code in small print and an optional retry", () => {
    const known = renderInRouter(
      <FailureMessage t={t} descriptor={{ key: "errors.code.in_use" }} />,
    );
    expect(known).toContain('role="alert"');
    expect(known).toContain("§errors.code.in_use");
    expect(known).not.toContain("<small>");
    expect(known).not.toContain("<button");
    const unknown = renderInRouter(
      <FailureMessage
        t={t}
        descriptor={{ key: "errors.generic", code: "brand_new" }}
        onRetry={noop}
      />,
    );
    expect(unknown).toContain("<small>§errors.reference</small>");
    expect(unknown).toContain("§action.retry");
    expectNoHardcodedText(unknown);
  });
});

describe("ResourceFallback", () => {
  it("shows loading, error with retry, not allowed and not found, and nothing when ready", () => {
    const render = (state: Parameters<typeof ResourceFallback>[0]["state"]) =>
      renderInRouter(<ResourceFallback t={t} state={state} onRetry={noop} />);
    expect(render({ status: "ready" })).toBe("");
    expect(render({ status: "loading" })).toContain("§status.loading");
    const error = render({ status: "error", failure: { kind: "network" } });
    expect(error).toContain("§errors.network");
    expect(error).toContain("§action.retry");
    expect(render({ status: "forbidden" })).toContain("§error.forbiddenData");
    expect(render({ status: "notFound" })).toContain("§error.notFoundData");
    for (const status of ["loading", "forbidden", "notFound"] as const) {
      expectNoHardcodedText(render({ status }));
    }
  });
});

describe("shell frame", () => {
  const html = renderInRouter(
    <ShellFrame
      t={t}
      navigation={[
        {
          id: "catalog",
          heading: "§nav.group.catalog",
          items: [{ id: "p", label: "§p", href: "/products", current: true }],
        },
      ]}
      languageSwitch={<LanguageSwitchView t={t} locale="uk" onChange={noop} />}
      userMenu={
        <UserMenuView
          t={t}
          email="admin@example.com"
          signingOut={false}
          failure={null}
          onSignOut={noop}
        />
      }
      navigating={false}
    >
      <p>§page</p>
    </ShellFrame>,
    "/products",
  );

  it("has a skip link to main, a header, the navigation landmark and main", () => {
    expect(html.indexOf('href="#main"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("<header"));
    expect(html).toContain('<main id="main" tabindex="-1"');
    expect(html).toContain('<nav aria-label="§shell.navLabel"');
    expect(html).toContain('href="/admin-ui/products"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-live="polite"');
  });

  it("links the own account and offers sign-out", () => {
    expect(html).toContain('href="/admin-ui/account"');
    expect(html).toContain("§shell.signOut");
    expect(html).toContain("§shell.signedInAs");
  });

  it("marks the current language and names each language in its own language", () => {
    expect(html).toMatch(/lang="uk"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*lang="uk"/);
    expect(html).toMatch(/lang="en"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*lang="en"/);
    expect(html).toContain('role="group" aria-label="§language.label"');
  });

  it("contains no hardcoded text", () => {
    // The email is data, not UI text.
    expectNoHardcodedText(html.replace("admin@example.com", ""));
  });
});

describe("sign-in form", () => {
  const render = (message: SignInMessage | null, busy = false) =>
    renderInRouter(
      <LoginFrame t={t} languageSwitch={null}>
        <SignInFormView
          t={t}
          idPrefix="login"
          email="a@example.com"
          password=""
          busy={busy}
          message={message}
          onEmail={noop}
          onPassword={noop}
          onSubmit={noop}
        />
      </LoginFrame>,
      "/login",
    );

  it("posts without an action, with labelled email and password fields", () => {
    const html = render(null);
    expect(html).toMatch(/<form(?![^>]*action=)[^>]*method="post"/);
    expect(html).toContain('for="login-email"');
    expect(html).toContain('for="login-password"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    expect(h1Count(html)).toBe(1);
    expectNoHardcodedText(html.replace("a@example.com", ""));
  });

  it("shows the one identical message for every refused sign-in, and the wait of a 429", () => {
    expect(render({ kind: "rejected" })).toContain("§auth.login.failed");
    expect(render({ kind: "throttled", minutes: 7 })).toContain("§auth.login.tooManyWait:7");
    expect(render({ kind: "throttled", minutes: null })).toContain("§auth.login.tooMany");
  });

  it("maps outcomes to messages, and never names which part was wrong", () => {
    expect(signInMessage({ status: "signedIn" })).toBeNull();
    expect(signInMessage({ status: "rejected" })).toEqual({ kind: "rejected" });
    expect(signInMessage({ status: "failed", failure: { kind: "timeout" } })).toEqual({
      kind: "failure",
      descriptor: { key: "errors.timeout" },
    });
  });

  it("disables the button while signing in", () => {
    const html = render(null, true);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toContain("§auth.login.submitting");
  });
});

describe("account page views", () => {
  it("shows the own user's details with translated role", () => {
    const html = renderInRouter(
      <AccountDetailsView
        t={t}
        locale="en"
        user={{
          id: "u1",
          email: "o@example.com",
          role: "owner",
          isActive: true,
          lastLoginAt: null,
        }}
      />,
    );
    expect(html).toContain("§role.owner");
    expect(html).toContain("§account.lastLoginNever");
    expectNoHardcodedText(html.replace("o@example.com", ""));
  });

  it("renders the password form as a post form with field errors linked and a summary with codes", () => {
    const html = renderInRouter(
      <PasswordFormView
        t={t}
        values={{ currentPassword: "", newPassword: "", repeatPassword: "" }}
        fieldErrors={{ newPassword: { key: "errors.reason.too_short" } }}
        summary={[{ key: "errors.generic", code: "brand_new" }]}
        busy={false}
        done={false}
        onChange={noop}
        onSubmit={noop}
      />,
    );
    expect(html).toMatch(/<form(?![^>]*action=)[^>]*method="post"/);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="account-newPassword-error"');
    expect(html).toContain("§errors.reason.too_short");
    expect(html).toContain("§errors.reference");
    expect(html).toContain('minLength="12"');
    expectNoHardcodedText(html);
  });
});
