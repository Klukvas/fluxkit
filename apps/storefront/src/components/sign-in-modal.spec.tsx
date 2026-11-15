import { createTranslator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { messagesByLocale } from "../messages";
import { LoginFormView } from "./login-form";
import { createSignInHeadingBinding, SignInModalView } from "./sign-in-modal";

describe("modal heading binding", () => {
  it("focuses initially, then preserves the error summary's focus even if the heading is replaced", () => {
    const initial = { id: "", tabIndex: 0, focus: vi.fn() };
    let heading = initial;
    const bind = createSignInHeadingBinding(
      () => heading,
      "modal-title",
      () => true,
    );
    bind(true);
    expect(initial.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    bind();
    expect(initial.focus).toHaveBeenCalledTimes(1);
    heading = { id: "", tabIndex: 0, focus: vi.fn() };
    bind();
    expect(heading.id).toBe("modal-title");
    expect(heading.tabIndex).toBe(-1);
    expect(heading.focus).not.toHaveBeenCalled();
  });

  it("focuses a replacement signed-in heading when the previous view lost focus", () => {
    let heading = { id: "", tabIndex: 0, focus: vi.fn() };
    const bind = createSignInHeadingBinding(
      () => heading,
      "modal-title",
      () => false,
    );
    bind(true);
    heading = { id: "", tabIndex: 0, focus: vi.fn() };
    bind();
    expect(heading.id).toBe("modal-title");
    expect(heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
});

it("renders a closed native dialog with a named close button and no extra heading", () => {
  for (const locale of ["uk", "en"] as const) {
    const t = createTranslator(messagesByLocale[locale], locale);
    const html = renderToStaticMarkup(
      <SignInModalView
        titleId="form-title"
        closeLabel={t("account.modal.close")}
        onDismiss={vi.fn()}
        onNativeClose={vi.fn()}
      >
        <h1 id="form-title">{t("account.login.title")}</h1>
      </SignInModalView>,
    );
    expect(html).toContain('<dialog aria-labelledby="form-title"');
    expect(html).toContain('<h1 id="form-title">');
    expect(html.match(/<h[12]\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    expect(html).toContain(t("account.modal.close"));
    expect(html).not.toMatch(/<dialog[^>]*\bopen[=> ]/);
  }
});

describe("existing login form inside the modal shell", () => {
  it("reuses its single h1, native POST and labelled fields", () => {
    const t = createTranslator(messagesByLocale.en, "en");
    const html = renderToStaticMarkup(
      <SignInModalView
        titleId="form-title"
        closeLabel="Close"
        onDismiss={vi.fn()}
        onNativeClose={vi.fn()}
      >
        <LoginFormView
          t={t}
          values={{ email: "", password: "" }}
          onValueChange={vi.fn()}
          onSubmit={vi.fn()}
          pending={false}
          failure={null}
          summaryRef={null}
          registerHref="/en/account/register"
        />
      </SignInModalView>,
    );
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('method="post"');
    expect(html).toContain('for="login-email"');
    // The live wrapper binds aria-labelledby to this existing h1 before showModal (Chromium coverage).
    expect(html).not.toContain("<h2");
  });
});
