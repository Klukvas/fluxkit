import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the users area's source for the rules a static-markup test cannot see (plan step 10: one send per write,
 * never auto-retried, a reload after every answer, confirmations where required, the password kept inside its form and
 * out of URLs, storage and logs, ids only in links, permissions from the session's list). They read the files as text, so
 * each rule is pinned to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */

const directory = import.meta.dirname;
const sources = readdirSync(directory)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(directory, name), "utf8") }));
const source = (name: string) => sources.find((file) => file.name === name)?.text ?? "";
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");
const between = (text: string, start: string, end: string) =>
  text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start) + start.length));

const WRITES = /adminClient\.(createUser|updateUser|resetUserPassword)\(/g;

describe("users area source guards", () => {
  it("finds the sources it guards", () => {
    expect(sources.length).toBeGreaterThanOrEqual(15);
    for (const name of ["user-create-page.tsx", "user-detail-page.tsx", "user-reset-form.tsx"]) {
      expect(source(name), name).not.toBe("");
    }
  });

  it("calls each write operation from one page only: create once, PATCH twice (role, activity), reset once", () => {
    const expected: Record<string, Record<string, number>> = {
      "user-create-page.tsx": { createUser: 1 },
      "user-detail-page.tsx": { updateUser: 2, resetUserPassword: 1 },
    };
    for (const file of sources) {
      const counts: Record<string, number> = {};
      for (const match of code(file.text).matchAll(WRITES)) {
        const name = match[1] as string;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      expect(counts, file.name).toEqual(expected[file.name] ?? {});
    }
  });

  it("sends every write once through the single flight and runWrite, never after a timer, in a loop or again", () => {
    const create = code(source("user-create-page.tsx"));
    expect(create).toContain("flight.run(() => runWrite(() => adminClient.createUser(body)))");
    const detail = code(source("user-detail-page.tsx"));
    expect(detail).toContain("flight.run(() => runWrite(write))");
    // Role, activity and reset: three calls of `send` (the declaration is `send<T>(`).
    expect(detail.match(/\bsend\(/g)?.length).toBe(3);
    for (const file of sources) {
      const text = code(file.text);
      expect(text, file.name).not.toMatch(/\bsetTimeout\b|\bsetInterval\b|\bretry\b|\.catch\(/i);
      // The only loops: the bounded list read after a lost create answer (reads only) and the password generator.
      if (file.name !== "user-lookup.ts" && file.name !== "password-generator.ts") {
        expect(text, file.name).not.toMatch(/\bwhile\s*\(|\bfor\s*\(/);
      }
    }
    expect(code(source("user-lookup.ts"))).not.toMatch(WRITES);
    expect(code(source("user-lookup.ts"))).not.toMatch(/adminClient/);
  });

  it("reads the user again after every answer of the detail (nothing optimistic)", () => {
    const page = code(source("user-detail-page.tsx"));
    const send = between(page, "async function send", "function perform");
    expect(send).toContain("resource.reload();");
    expect(send.indexOf("resource.reload();")).toBeGreaterThan(send.lastIndexOf("announce("));
    // Between the answer and the reload there is no way out except the caller's own abort.
    const aborted = 'if (outcome.kind === "aborted") return outcome;';
    const afterAnswer = send.slice(send.indexOf(aborted) + aborted.length);
    expect(afterAnswer.slice(0, afterAnswer.indexOf("resource.reload();"))).not.toMatch(/return\b/);
    expect(page).not.toMatch(/optimistic|setUser\(/i);
  });

  it("asks for a confirmation before a role change, a deactivation and a reset; acts at once only for activate", () => {
    const page = code(source("user-detail-page.tsx"));
    const onAction = between(page, "function onAction", "function closeDialog");
    expect(onAction).toMatch(/action === "changeRole"\) \{\s*setDialog\(/);
    expect(onAction).toMatch(/action === "deactivate"\) \{\s*setDialog\(/);
    expect(onAction).toMatch(/!confirmationOf\(action, self\)\.ask\) \{\s*perform\(action\);/);
    // `perform` is reached from a confirmed dialog, or from `onAction` for an action that needs no confirmation.
    expect(page.match(/\bperform\(/g)?.length).toBe(4);
    const confirm = between(page, "function confirmDialog", "const common");
    expect(confirm).toMatch(/selfCheck && !dialog\.selfTicked\) return;/);
    const reset = code(source("user-reset-form.tsx"));
    const submit = between(reset, "function onSubmit", "async function confirm");
    expect(submit).toContain("setConfirming(true);");
    expect(submit).not.toMatch(/\bsend\(/);
    expect(reset).toMatch(/onConfirm=\{\(\) => void confirm\(\)\}/);
    expect(reset.match(/\bsend\(/g)?.length).toBe(1);
  });

  it("checks the offered actions again before sending, so a stale click sends nothing else", () => {
    const page = code(source("user-detail-page.tsx"));
    expect(between(page, "function perform", "function onAction")).toMatch(
      /if \(!actions\.includes\(action\)\) return;/,
    );
    expect(page).toMatch(/actions\.includes\("resetPassword"\)\s*\?\s*send\("resetPassword"/);
  });

  it("keeps the typed password inside its form: not in the detail page's state, cleared after every answer", () => {
    const detail = code(source("user-detail-page.tsx"));
    expect(detail).not.toMatch(/useState[^;]*[Pp]assword/);
    expect(detail.match(/newPassword/g)?.length).toBe(2);
    expect(detail).toMatch(
      /\(newPassword\) =>[\s\S]{0,200}resetUserPassword\(current\.id, \{ newPassword \}\)/,
    );
    const create = code(source("user-create-page.tsx"));
    const afterAnswer = between(
      create,
      'if (outcome.kind === "aborted") return;',
      'if (outcome.kind === "ok")',
    );
    expect(afterAnswer).toContain("clearPassword();");
    const reset = code(source("user-reset-form.tsx"));
    const confirmBody = between(reset, "async function confirm", "return (");
    expect(confirmBody.indexOf("clear();")).toBeGreaterThan(
      confirmBody.indexOf("const outcome = await send(value);"),
    );
    expect(confirmBody.indexOf("clear();")).toBeLessThan(
      confirmBody.indexOf('if (outcome.kind === "problem")'),
    );
  });

  it("never puts a password into a URL, storage or a log", () => {
    for (const file of sources) {
      const text = code(file.text);
      expect(text, file.name).not.toMatch(
        /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|document\.cookie|\bconsole\./,
      );
      expect(text, file.name).not.toMatch(
        /setSearchParams|\bnavigate\(|history\.(push|replace)State/,
      );
      for (const line of text.split("\n")) {
        if (/[Pp]assword/.test(line)) {
          expect(line, `${file.name}: ${line.trim()}`).not.toMatch(
            /writeQuery|buildPath|URLSearchParams|\bto=|href|encodeURIComponent/,
          );
        }
      }
    }
  });

  it("generates passwords only from the cryptographic source", () => {
    for (const file of sources) expect(code(file.text), file.name).not.toMatch(/Math\.random/);
    expect(code(source("password-generator.ts"))).toContain("crypto.getRandomValues(");
  });

  it("puts only ids into links: never an email", () => {
    for (const file of sources) {
      for (const call of code(file.text).matchAll(/\buserHref\(([^)]*)\)/g)) {
        if (call[1] === "id: string") continue;
        expect(call[1], `${file.name}: ${call[0]}`).toMatch(
          /^(row|user|current|lookup\.user)\.id$/,
        );
      }
    }
    const links = code(source("user-view.ts"));
    expect(between(links, "export function userHref", "}")).not.toMatch(/email/);
  });

  it("decides what to offer from the session's permission list, never from a role name", () => {
    for (const file of sources) {
      expect(code(file.text), file.name).not.toMatch(
        /me\??\.user\.role|\.role === "owner"\s*\?\s*\[/,
      );
    }
    expect(code(source("user-actions.ts"))).toMatch(
      /canRun\(permissions, USER_ACTION_OPERATIONS\[action\]\)/,
    );
    expect(code(source("user-list-page.tsx"))).toContain('canRun(permissions, "createUser")');
  });

  it("never renders raw HTML", () => {
    for (const file of sources) {
      expect(file.text, file.name).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it("imports no other area except the account area's password limits (eager messages)", () => {
    for (const file of sources) {
      for (const match of file.text.matchAll(/from "\.\.\/([a-z-]+)\/([^"]+)"/g)) {
        expect(`${match[1] ?? ""}/${match[2] ?? ""}`, file.name).toBe("account/password-form");
      }
    }
  });
});
