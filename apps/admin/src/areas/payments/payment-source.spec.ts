import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards over the payment section's wiring that a static-markup test cannot see (the decisions are tested in
 * `refund-form.spec.ts`, `payment-view.spec.ts` and `payment-outcome.spec.ts`). They read the files as text, so each rule is
 * pinned to the shape of the code that keeps it; a refactor that keeps the rule updates the pattern here.
 */
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, "$1");
const read = (name: string) => strip(readFileSync(join(import.meta.dirname, name), "utf8"));
const section = read("payment-section.tsx");

/** The source of one function of the section, from its declaration to the next top-level declaration of the component. */
function body(name: string): string {
  const start = section.search(new RegExp(`function ${name}[(<]`));
  if (start < 0) throw new Error(`No function ${name}`);
  const asyncStart = section.lastIndexOf("async ", start);
  const from = asyncStart >= 0 && start - asyncStart <= 6 ? asyncStart : start;
  const next = section
    .slice(start + 1)
    .search(/\n {2}(?:async )?function \w+\(|\n {2}const statusLine/);
  return section.slice(from, next < 0 ? undefined : start + 1 + next);
}

describe("payment section source guards", () => {
  it("sends every write through the single flight and runWrite, once", () => {
    expect(section).toContain("const running = flight.run(() => runWrite(write));");
    expect(section).toContain("if (running === null) return null;");
    const calls = [...section.matchAll(/adminClient\.(\w+)\(/g)].map((match) => match[1]);
    expect(calls.sort()).toEqual(["clearPaymentAttention", "refundPayment", "resyncPayment"]);
    for (const match of section.matchAll(/adminClient\.\w+\(/g)) {
      const before = section.slice(Math.max(0, match.index - 60), match.index);
      expect(before, match[0]).toMatch(/send\(\(\) =>\s*$|send\(\(\) =>$/);
    }
  });

  it("never retries or repeats a write: no timer, loop or second refund", () => {
    expect(section).not.toMatch(/setTimeout|setInterval|while \(|for \(|retry\(/);
    expect(section.match(/adminClient\.refundPayment\(/g)).toHaveLength(1);
  });

  it("asks for confirmation before a refund is sent: only the confirm step reaches the client", () => {
    expect(body("review")).not.toContain("adminClient");
    expect(body("review")).not.toContain("send(");
    expect(body("review")).not.toContain("confirmRefund");
    expect(body("review")).toContain('step: "confirm"');
    expect(body("openRefund")).not.toContain("adminClient");
    expect(body("onAction")).not.toContain("adminClient");
    expect(body("confirmRefund")).toContain("adminClient.refundPayment(");
    expect(section.match(/void confirmRefund\(\)/g)?.length).toBe(1);
    expect(section).toContain("onConfirm={() => void confirmRefund()}");
    expect(section).toContain("onReview={review}");
    // A refund is confirmed on the second step only: the form submit goes to the review.
    const dialogs = read("payment-dialogs.tsx");
    expect(dialogs).toContain("onReview();");
    expect(dialogs).not.toMatch(/onSubmit=\{[^}]*onConfirm/);
  });

  it("confirms closing an attention item before sending it", () => {
    expect(body("onAction")).toContain("setClearing(payment)");
    expect(body("confirmClear")).toContain("adminClient.clearPaymentAttention(payment.id)");
    expect(section).toContain("onConfirm={() => void confirmClear()}");
  });

  it("takes the Idempotency-Key from the dialog's draft: one key per confirmed refund, reused for the same request", () => {
    expect(section).toContain("crypto.randomUUID()");
    expect(section.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1);
    const confirm = body("confirmRefund");
    expect(confirm).toContain("resolveRefundKey(refund.draft, body, newKey)");
    expect(confirm).toContain("{ idempotencyKey: draft.key }");
    // No other place makes a key: not the send, not a retry path.
    expect(confirm.match(/newKey/g)).toHaveLength(1);
    expect(body("send")).not.toContain("newKey");
    // The key and values of a lost attempt come back when the dialog is opened again for the same payment.
    expect(confirm).toContain("setLost({ paymentId, values: refund.values, draft })");
    expect(body("openRefund")).toMatch(/openRefundDialog\(\s*lost,/);
  });

  it("states a lost refund answer as lost and keeps the request for the admin; nothing is sent by the screen", () => {
    const confirm = body("confirmRefund");
    expect(confirm).toContain('announce({ kind: "refundLost" })');
    expect(confirm.match(/adminClient\.refundPayment\(/g)).toHaveLength(1);
  });

  it("reads the order again after every answer of a write", () => {
    expect(section.match(/onChanged\(\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("focuses the field of the first issue in the commit that shows it, never in a later frame", () => {
    // A focus deferred to the next animation frame landed after the next field had been focused, so what was typed there
    // went into the amount (CI run of PR #191: the amount read "50.50Damaged in transit", the reason stayed empty).
    expect(section).not.toMatch(/requestAnimationFrame|setTimeout|queueMicrotask/);
    expect(body("focusFirstIssue")).toContain("setIssueFocus(");
    expect(body("focusFirstIssue")).not.toContain(".focus()");
    expect(section).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(issueFocus !== null\) document\.getElementById\(issueFocus\.id\)\?\.focus\(\);\s*\}, \[issueFocus\]\);/,
    );
    expect(body("review")).toContain("focusFirstIssue(plan.issues)");
    expect(body("confirmRefund")).toContain("focusFirstIssue(plan.issues)");
  });

  it("gates the actions by the permissions of their operations, not by role names", () => {
    expect(section).toContain("offeredPaymentActions(payment, permissions)");
    expect(section).not.toMatch(/owner|manager|viewer/);
  });
});

describe("attention list source guards", () => {
  const page = read("attention-page.tsx");
  it("only reads: no write, no timer, no loop, one request per click", () => {
    expect([...page.matchAll(/adminClient\.(\w+)\(/g)].map((match) => match[1])).toEqual([
      "listPayments",
      "listPayments",
    ]);
    expect(page).not.toMatch(/setTimeout|setInterval|while \(|for \(|runWrite/);
    expect(page).toContain("if (running.current || list.nextCursor === null) return;");
  });

  it("passes the cursor back exactly as the API sent it", () => {
    expect(page).toContain("cursor: list.nextCursor");
    expect(page).toContain("needsAttention: true");
  });
});
