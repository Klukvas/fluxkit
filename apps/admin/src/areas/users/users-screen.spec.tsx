import type { AdminUser } from "@fluxkit/api-client";
import { ROLE_PERMISSIONS } from "@fluxkit/core";
import { Button, createTranslator, type Translator } from "@fluxkit/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "../../lib/format";
import {
  leftoverText,
  messagesForArea,
  renderInRouter,
  sentinelTranslator,
} from "../../test-helpers";
import { MESSAGE_FILES } from "./index";
import { offeredUserActions } from "./user-actions";
import { CreateUnknownView, CreateUserFormView, CreatedPanel } from "./user-create-view";
import { UserNoticeView, type UserNotice } from "./user-detail-page";
import { UserDetailView } from "./user-detail-view";
import { DeactivateDialog, ResetPasswordDialog, RoleChangeDialog } from "./user-dialogs";
import { EMPTY_CREATE_VALUES, type CreateUserValues } from "./user-form";
import { UserListView, UserResultsView, type UserListState } from "./user-list-view";
import { StatusLine } from "./user-parts";
import { ResetPasswordFormView } from "./user-reset-form";

const noop = () => undefined;
const sentinel = sentinelTranslator();
const ID = "44444444-4444-4444-8444-444444444444";
const ME = "55555555-5555-4555-8555-555555555555";
const owner = [...ROLE_PERMISSIONS.owner];
const manager = [...ROLE_PERMISSIONS.manager];
const viewer = [...ROLE_PERMISSIONS.viewer];
const SECRET = "correct-horse-battery";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function withoutData(html: string, data: readonly string[]): string {
  return data.reduce((rest, text) => rest.split(escapeHtml(text)).join(" "), html);
}

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: ID,
    email: "anna@example.com",
    role: "manager",
    isActive: true,
    lastLoginAt: "2026-10-20T10:00:00.000Z",
    createdAt: "2026-10-01T08:30:00.000Z",
    updatedAt: "2026-10-19T09:00:00.000Z",
    ...overrides,
  };
}

function results(t: Translator, state: UserListState, offset = 0, meId: string | null = ME) {
  return renderInRouter(
    <UserResultsView
      t={t}
      uiLocale="en"
      meId={meId}
      query={{ limit: 50, offset }}
      state={state}
      onRetry={noop}
      hrefForOffset={(next) => `/users?offset=${String(next)}`}
    />,
    "/users",
  );
}

function createForm(
  t: Translator,
  values: CreateUserValues = EMPTY_CREATE_VALUES,
  options: { visible?: boolean; generated?: boolean; busy?: boolean } = {},
  fieldErrors = {},
) {
  return renderInRouter(
    <CreateUserFormView
      t={t}
      values={values}
      fieldErrors={fieldErrors}
      summary={[]}
      busy={options.busy ?? false}
      passwordVisible={options.visible ?? false}
      passwordGenerated={options.generated ?? false}
      onEmailChange={noop}
      onRoleChange={noop}
      onPasswordChange={noop}
      onTogglePassword={noop}
      onGeneratePassword={noop}
      onSubmit={noop}
    />,
    "/users/new",
  );
}

function detail(
  t: Translator,
  value: AdminUser,
  permissions: readonly string[] | null,
  options: { self?: boolean; busy?: boolean; selectedRole?: AdminUser["role"] } = {},
) {
  return renderInRouter(
    <UserDetailView
      t={t}
      uiLocale="en"
      user={value}
      self={options.self ?? false}
      actions={offeredUserActions(value, permissions)}
      selectedRole={options.selectedRole ?? value.role}
      onSelectRole={noop}
      onAction={noop}
      busy={options.busy ?? false}
      statusLine={<StatusLine />}
      resetForm={<p>reset-slot</p>}
    />,
    `/users/${value.id}`,
  );
}

const dialogProps = {
  open: true,
  busy: false,
  email: "anna@example.com",
  selfTicked: false,
  refusal: null,
  onSelfTick: noop,
  onConfirm: noop,
  onClose: noop,
};

/** The `disabled` attribute itself (the class list always holds `disabled:opacity-50`, which proves nothing). */
function isDisabled(button: string | undefined): boolean {
  return /<button[^>]*\sdisabled=""/.test(button ?? "");
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]);
}

describe("users list screen", () => {
  const ready = (items: AdminUser[], total = items.length): UserListState => ({
    status: "ready",
    data: { items, total, limit: 50, offset: 0 },
  });

  it("renders every state without hardcoded text", () => {
    const row = user();
    const data = [
      row.email,
      formatDateTime(row.lastLoginAt ?? "", "en"),
      formatDate(row.createdAt, "en"),
    ];
    const states: UserListState[] = [
      { status: "loading" },
      ready([row], 120),
      ready([]),
      { status: "forbidden" },
      { status: "notFound" },
      { status: "error", failure: { kind: "network" } },
    ];
    for (const state of states) {
      expect(leftoverText(withoutData(results(sentinel, state), data)), state.status).toBe("");
    }
    expect(
      leftoverText(renderInRouter(<UserListView t={sentinel} canCreate results={<p>x</p>} />)),
    ).toBe("x");
  });

  it("links each row by id, says role and status in words, and marks only the own row as you", () => {
    const html = results(
      sentinel,
      ready([user(), user({ id: ME, email: "me@example.com", role: "owner" })]),
    );
    expect(html).toContain(`href="/admin-ui/users/${ID}"`);
    expect(html).toContain(`href="/admin-ui/users/${ME}"`);
    expect(html).toContain("§role.manager");
    expect(html).toContain("§role.owner");
    expect(html).toContain("§user.status.active");
    expect(html).toContain('<th scope="row"');
    expect(html.match(/§user\.you/g)).toHaveLength(1);
    const ownRow = html.slice(html.indexOf("me@example.com"));
    expect(ownRow.indexOf("§user.you")).toBeLessThan(ownRow.indexOf("</tr>"));
    for (const href of html.matchAll(/href="([^"]*)"/g)) expect(href[1]).not.toContain("@");
  });

  it("marks no row as you without a session, and decides by id, not by email", () => {
    expect(results(sentinel, ready([user()]), 0, null)).not.toContain("§user.you");
    expect(results(sentinel, ready([user({ email: "me@example.com" })]))).not.toContain(
      "§user.you",
    );
  });

  it("shows a deactivated user and one who never signed in, in words", () => {
    const html = results(sentinel, ready([user({ isActive: false, lastLoginAt: null })]));
    expect(html).toContain("§user.status.deactivated");
    expect(html).toContain("§user.neverSignedIn");
  });

  it("pages with links, and handles a page past the end", () => {
    const html = results(
      sentinel,
      {
        status: "ready",
        data: { items: [user()], total: 120, limit: 50, offset: 50 },
      },
      50,
    );
    expect(html).toContain("§user.list.pageRange");
    expect(html).toContain('href="/admin-ui/users?offset=0"');
    expect(html).toContain('href="/admin-ui/users?offset=100"');
    const past = results(
      sentinel,
      { status: "ready", data: { items: [], total: 3, limit: 50, offset: 50 } },
      50,
    );
    expect(past).toContain("§user.list.pastEnd");
  });

  it("explains forbidden and failed reads, with a retry for a failure", () => {
    expect(results(sentinel, { status: "forbidden" })).toContain("§error.forbiddenData");
    const failed = results(sentinel, { status: "error", failure: { kind: "network" } });
    expect(failed).toContain("§errors.network");
    expect(failed).toContain("§action.retry");
  });

  it("offers the create link only when the session may create users", () => {
    const withLink = renderInRouter(<UserListView t={sentinel} canCreate results={null} />);
    expect(withLink).toContain('href="/admin-ui/users/new"');
    const without = renderInRouter(<UserListView t={sentinel} canCreate={false} results={null} />);
    expect(without).not.toContain("/users/new");
  });
});

describe("create user form", () => {
  it("renders without hardcoded text and posts to nowhere", () => {
    const html = createForm(sentinel);
    expect(leftoverText(html)).toBe("");
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
  });

  it("has an email field that the browser does not fill from other accounts", () => {
    const html = createForm(sentinel);
    const email = /<input[^>]*name="email"[^>]*>/.exec(html)?.[0] ?? "";
    expect(email).toContain('type="email"');
    expect(email).toContain('autoComplete="off"');
    expect(email).toContain('maxLength="254"');
  });

  it("has a password field of type password with autocomplete new-password, text only when shown on purpose", () => {
    const hidden = /<input[^>]*name="password"[^>]*>/.exec(createForm(sentinel))?.[0] ?? "";
    expect(hidden).toContain('type="password"');
    expect(hidden).toContain('autoComplete="new-password"');
    expect(hidden).toContain('spellCheck="false"');
    const shown =
      /<input[^>]*name="password"[^>]*>/.exec(
        createForm(sentinel, EMPTY_CREATE_VALUES, { visible: true }),
      )?.[0] ?? "";
    expect(shown).toContain('type="text"');
    expect(createForm(sentinel)).toContain('aria-pressed="false"');
    expect(createForm(sentinel, EMPTY_CREATE_VALUES, { visible: true })).toContain(
      'aria-pressed="true"',
    );
    expect(createForm(sentinel)).toContain("§user.password.show");
    expect(createForm(sentinel, EMPTY_CREATE_VALUES, { visible: true })).toContain(
      "§user.password.hide",
    );
  });

  it("offers the three roles, each with exactly its permissions, the viewer preselected", () => {
    const html = createForm(sentinel);
    for (const role of ["owner", "manager", "viewer"] as const) {
      expect(html).toContain(`value="${role}"`);
      expect(html).toContain(`§role.${role}`);
    }
    expect(/<input[^>]*value="viewer"[^>]*>/.exec(html)?.[0]).toContain("checked");
    expect(html.match(/§user\.permission\.users\.manage/g)).toHaveLength(1);
    expect(html.match(/§user\.permission\.catalog\.read/g)).toHaveLength(3);
    expect(html.match(/§user\.permission\.orders\.read/g)).toHaveLength(2);
  });

  it("gives live policy feedback in words, and says a generated password is shown once", () => {
    const short = createForm(sentinel, { ...EMPTY_CREATE_VALUES, password: "abc" });
    expect(short).toContain("§user.password.notMet");
    expect(short).toContain("§user.password.ruleLength");
    const good = createForm(sentinel, {
      email: "anna@example.com",
      role: "viewer",
      password: "a".repeat(12),
    });
    expect(good).not.toContain("§user.password.notMet");
    expect(createForm(sentinel, EMPTY_CREATE_VALUES, { generated: true })).toContain(
      "§user.password.generatedNote",
    );
    expect(createForm(sentinel)).toContain("§user.create.handoverHint");
  });

  it("puts a duplicate email on the email field", () => {
    const html = createForm(
      sentinel,
      EMPTY_CREATE_VALUES,
      {},
      {
        email: { key: "user.create.emailTaken" },
      },
    );
    const email = /<input[^>]*name="email"[^>]*>/.exec(html)?.[0] ?? "";
    expect(email).toContain('aria-invalid="true"');
    expect(email).toContain("user-email-error");
    expect(html).toContain('id="user-email-error"');
    expect(html).toContain("§user.create.emailTaken");
  });

  it("turns the controls off while sending", () => {
    const html = createForm(sentinel, EMPTY_CREATE_VALUES, { busy: true });
    expect(html).toContain("§user.create.submitting");
    for (const button of buttons(html)) expect(isDisabled(button)).toBe(true);
  });
});

describe("after a create", () => {
  it("shows the stored user in a focusable panel, never a password, and says how to hand it over", () => {
    const html = renderInRouter(
      <CreatedPanel t={sentinel} user={user({ role: "viewer" })} onCreateAnother={noop} />,
    );
    expect(leftoverText(withoutData(html, ["anna@example.com"]))).toBe("");
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("§user.created.passwordNotShown");
    expect(html).toContain("§user.created.handover");
    expect(html).toContain("§user.created.changeIt");
    expect(html).toContain(`href="/admin-ui/users/${ID}"`);
    expect(html).not.toContain(SECRET);
    expect(html).not.toMatch(/type="password"|name="password"/);
  });

  it("after a lost answer says what the list shows, never that the create landed", () => {
    expect(renderInRouter(<CreateUnknownView t={sentinel} lookup={null} />)).toContain(
      "§user.create.unknownReading",
    );
    for (const kind of ["absent", "notChecked", "unreadable"] as const) {
      const html = renderInRouter(<CreateUnknownView t={sentinel} lookup={{ kind }} />);
      expect(html).toContain(`§user.create.unknown.${kind}`);
      expect(html).not.toContain("href=");
    }
    const found = renderInRouter(
      <CreateUnknownView t={sentinel} lookup={{ kind: "found", user: user() }} />,
    );
    expect(found).toContain("§user.create.unknown.found");
    expect(found).toContain(`href="/admin-ui/users/${ID}"`);
  });
});

describe("user detail screen", () => {
  it("renders without hardcoded text", () => {
    const value = user();
    const data = [
      value.email,
      formatDateTime(value.lastLoginAt ?? "", "en"),
      formatDateTime(value.createdAt, "en"),
      formatDateTime(value.updatedAt, "en"),
    ];
    expect(leftoverText(withoutData(detail(sentinel, value, owner), data))).toBe("reset slot");
    expect(leftoverText(withoutData(detail(sentinel, value, owner, { self: true }), data))).toBe(
      "reset slot",
    );
  });

  it("offers the owner role change, deactivate and the reset; the manager and the viewer nothing", () => {
    const html = detail(sentinel, user(), owner);
    expect(html).toContain("§user.role.submit");
    expect(html).toContain("§user.action.deactivate");
    expect(html).not.toContain("§user.action.activate<");
    expect(html).toContain("reset-slot");
    for (const permissions of [manager, viewer, [], null]) {
      const other = detail(sentinel, user(), permissions);
      expect(other).not.toContain("<button");
      expect(other).not.toContain("reset-slot");
      expect(other).not.toContain('type="radio"');
    }
  });

  it("offers activate for a deactivated user", () => {
    const html = detail(sentinel, user({ isActive: false }), owner);
    expect(html).toContain("§user.action.activate<");
    expect(html).not.toContain("§user.action.deactivate<");
    expect(html).toContain("§user.activity.activateHint");
  });

  it("disables the role change until another role is chosen", () => {
    const same = buttons(detail(sentinel, user(), owner)).find((button) =>
      button.includes("§user.role.submit"),
    );
    expect(isDisabled(same)).toBe(true);
    const other = buttons(detail(sentinel, user(), owner, { selectedRole: "viewer" })).find(
      (button) => button.includes("§user.role.submit"),
    );
    expect(isDisabled(other)).toBe(false);
  });

  it("warns on the own account and marks it as you", () => {
    const html = detail(sentinel, user({ id: ME }), owner, { self: true });
    expect(html).toContain("§user.detail.selfTitle");
    expect(html).toContain("§user.you");
    expect(detail(sentinel, user(), owner)).not.toContain("§user.detail.selfTitle");
  });

  it("turns every button off while a write runs or the user reloads", () => {
    const html = detail(sentinel, user(), owner, { busy: true, selectedRole: "viewer" });
    for (const button of buttons(html)) expect(isDisabled(button)).toBe(true);
  });
});

describe("the confirmations", () => {
  it("role change: an alert dialog, cancel first, says it applies to the next request", () => {
    const html = renderInRouter(
      <RoleChangeDialog t={sentinel} {...dialogProps} self={false} from="manager" to="viewer" />,
    );
    expect(leftoverText(html)).toBe("");
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("§user.roleDialog.nextRequest");
    expect(html).toContain("§user.roleDialog.lastOwner");
    expect(html.indexOf("§user.dialog.cancel")).toBeLessThan(
      html.indexOf("§user.roleDialog.submit"),
    );
    expect(html).toContain('data-autofocus=""');
    expect(html).not.toMatch(/type="checkbox"/);
  });

  it("own role: an explicit tick is required before the confirm button works", () => {
    const unticked = renderInRouter(
      <RoleChangeDialog t={sentinel} {...dialogProps} self from="owner" to="manager" />,
    );
    expect(unticked).toMatch(/<input[^>]*type="checkbox"/);
    expect(unticked).toContain("§user.self.losesUsersArea");
    const confirm = (html: string) =>
      buttons(html).find((button) => button.includes("§user.roleDialog.submit")) ?? "";
    expect(isDisabled(confirm(unticked))).toBe(true);
    const ticked = renderInRouter(
      <RoleChangeDialog t={sentinel} {...dialogProps} selfTicked self from="owner" to="manager" />,
    );
    expect(isDisabled(confirm(ticked))).toBe(false);
  });

  it("gives each dialog's tick its own id, so its label works while the other dialogs stay in the page", () => {
    const html = renderInRouter(
      <>
        <RoleChangeDialog t={sentinel} {...dialogProps} self from="owner" to="manager" />
        <DeactivateDialog t={sentinel} {...dialogProps} self />
      </>,
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const checkboxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)];
    expect(checkboxes).toHaveLength(2);
    for (const box of checkboxes) {
      const id = /\sid="([^"]+)"/.exec(box[0])?.[1] ?? "missing";
      expect(html).toContain(`for="${id}"`);
    }
  });

  it("deactivation: danger look, says the sessions end; own account needs the tick and says it locks you out", () => {
    const dangerClass = /class="([^"]*)"/.exec(
      renderToStaticMarkup(<Button variant="danger">x</Button>),
    )?.[1];
    const html = renderInRouter(<DeactivateDialog t={sentinel} {...dialogProps} self={false} />);
    expect(html).toContain("§user.deactivateDialog.sessions");
    expect(html).toContain(`class="${dangerClass ?? "missing"}"`);
    expect(html).not.toMatch(/type="checkbox"/);
    const own = renderInRouter(<DeactivateDialog t={sentinel} {...dialogProps} self />);
    expect(own).toMatch(/<input[^>]*type="checkbox"/);
    expect(own).toContain("§user.self.signedOutCannotSignIn");
  });

  it("password reset: says ALL sessions end and the lock clears; for the own account that this session ends too", () => {
    const other = renderInRouter(
      <ResetPasswordDialog t={sentinel} {...dialogProps} self={false} />,
    );
    expect(other).toContain("§user.resetDialog.sessions");
    expect(other).toContain("§user.resetDialog.handover");
    expect(other).not.toContain("§user.self.");
    const own = renderInRouter(<ResetPasswordDialog t={sentinel} {...dialogProps} self />);
    expect(own).toContain("§user.resetDialog.sessions");
    expect(own).toContain("§user.self.signedOutSignInAgain");
  });

  it("explains a refusal inside the dialog and turns both buttons off while sending", () => {
    const refused = renderInRouter(
      <RoleChangeDialog
        t={sentinel}
        {...dialogProps}
        refusal={{ key: "user.refusal.last_owner_cannot_be_demoted" }}
        self={false}
        from="owner"
        to="viewer"
      />,
    );
    expect(refused).toContain("§user.refusal.last_owner_cannot_be_demoted");
    const sending = renderInRouter(
      <DeactivateDialog t={sentinel} {...dialogProps} busy self={false} />,
    );
    expect(sending).toContain("§user.dialog.sending");
    for (const button of buttons(sending)) expect(isDisabled(button)).toBe(true);
  });
});

describe("the password reset form", () => {
  function form(self: boolean, value = "") {
    return renderInRouter(
      <ResetPasswordFormView
        t={sentinel}
        email="anna@example.com"
        self={self}
        value={value}
        visible={false}
        generated={false}
        summary={[]}
        busy={false}
        onChange={noop}
        onToggleVisible={noop}
        onGenerate={noop}
        onSubmit={noop}
      />,
    );
  }

  it("posts to nowhere with one new-password field and no other field to autofill", () => {
    const html = form(false);
    expect(leftoverText(html)).toBe("");
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).not.toMatch(/<form[^>]*action=/);
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('type="password"');
    expect(inputs[0]).toContain('name="newPassword"');
    expect(inputs[0]).toContain('autoComplete="new-password"');
  });

  it("says before sending what a reset does, for another user and for the own account", () => {
    expect(form(false)).toContain("§user.reset.hint<");
    expect(form(true)).toContain("§user.reset.hintSelf");
  });

  it("checks the policy against the target's email while typing", () => {
    expect(form(false, "ANNA@example.com")).toContain("§user.password.notMet");
  });
});

describe("the status line after an answer", () => {
  const stored = user();
  function notice(
    value: UserNotice | null,
    current: AdminUser | null = stored,
    refreshing = false,
  ) {
    return renderInRouter(
      <UserNoticeView t={sentinel} notice={value} user={current} refreshing={refreshing} />,
    );
  }

  it("says nothing before any action, and confirms every action the server did", () => {
    expect(notice(null)).toBe("");
    for (const action of ["changeRole", "deactivate", "activate", "resetPassword"] as const) {
      expect(notice({ kind: "done", action, self: false })).toContain(
        `§user.notice.done.${action}`,
      );
    }
    expect(notice({ kind: "done", action: "resetPassword", self: true })).toContain(
      "§user.notice.done.resetPasswordSelf",
    );
  });

  it("explains a refusal through the area's or the shell's messages", () => {
    const html = notice({
      kind: "refused",
      action: "deactivate",
      descriptor: { key: "user.refusal.last_owner_cannot_be_deactivated" },
    });
    expect(html).toContain("§user.notice.refused.deactivate");
    expect(html).toContain("§user.refusal.last_owner_cannot_be_deactivated");
  });

  it("after a lost answer says it is reading, then what is stored, never that the write landed", () => {
    const before = user();
    expect(notice({ kind: "unknown", action: "deactivate", before }, before)).toContain(
      "§user.notice.unknownReading",
    );
    expect(
      notice({ kind: "unknown", action: "deactivate", before }, user({ isActive: false }), true),
    ).toContain("§user.notice.unknownReading");
    expect(
      notice({ kind: "unknown", action: "deactivate", before }, user({ isActive: false })),
    ).toContain("§user.notice.unknown.now_deactivated");
    expect(
      notice(
        { kind: "unknown", action: "changeRole", before, sentRole: "viewer" },
        user({ role: "viewer", updatedAt: "2026-10-20T00:00:00.000Z" }),
      ),
    ).toContain("§user.notice.unknown.roleChanged");
    expect(
      notice({ kind: "unknown", action: "resetPassword", before }, user({ updatedAt: "x" })),
    ).toContain("§user.notice.unknown.password_unknown");
    expect(notice({ kind: "unknown", action: "activate", before }, null)).toContain(
      "§user.notice.unknown.unreadable",
    );
  });
});

describe("with the real messages", () => {
  it("renders the list, the form, the detail, the dialogs and the notices in uk and en", async () => {
    for (const locale of ["uk", "en"] as const) {
      const t = createTranslator(await messagesForArea(locale, MESSAGE_FILES), locale);
      expect(
        results(t, { status: "ready", data: { items: [user()], total: 1, limit: 50, offset: 0 } }),
      ).toContain(escapeHtml(t("user.status.active")));
      expect(createForm(t)).toContain(escapeHtml(t("user.permission.users.manage")));
      expect(detail(t, user(), owner, { self: true })).toContain(
        escapeHtml(t("user.detail.selfBody")),
      );
      expect(renderInRouter(<ResetPasswordDialog t={t} {...dialogProps} self />)).toContain(
        escapeHtml(t("user.self.signedOutSignInAgain")),
      );
      expect(
        renderInRouter(
          <RoleChangeDialog t={t} {...dialogProps} self={false} from="manager" to="viewer" />,
        ),
      ).toContain(escapeHtml(t("user.roleDialog.nextRequest")));
      for (const kind of ["found", "absent", "notChecked", "unreadable"] as const) {
        renderInRouter(
          <CreateUnknownView t={t} lookup={kind === "found" ? { kind, user: user() } : { kind }} />,
        );
      }
      const before = user();
      for (const action of ["changeRole", "deactivate", "activate", "resetPassword"] as const) {
        renderInRouter(
          <UserNoticeView
            t={t}
            notice={{ kind: "unknown", action, before, sentRole: "viewer" }}
            user={user({ isActive: false, role: "viewer" })}
            refreshing={false}
          />,
        );
        renderInRouter(
          <UserNoticeView
            t={t}
            notice={{ kind: "refused", action, descriptor: { key: "errors.code.forbidden" } }}
            user={before}
            refreshing={false}
          />,
        );
      }
    }
  });
});
