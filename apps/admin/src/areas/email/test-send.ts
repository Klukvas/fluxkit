import type { AdminEmailMessageId } from "@fluxkit/api-client";
import type { MessageDescriptor } from "../../lib/problem-messages";
import type { WriteOutcome } from "../../lib/run-write";
import { describeEmailProblem } from "./email-errors";

/** What the status page shows after the test send. */
export type TestSendView =
  | { kind: "idle" }
  | { kind: "queued"; messageId: string }
  | { kind: "refused"; descriptor: MessageDescriptor }
  /** No answer: the mail may have been queued. The list shows it; the screen never sends again by itself. */
  | { kind: "unknown" };

export function testSendViewFrom(outcome: WriteOutcome<AdminEmailMessageId>): TestSendView {
  switch (outcome.kind) {
    case "aborted":
      return { kind: "idle" };
    case "unknown":
      return { kind: "unknown" };
    case "problem":
      return {
        kind: "refused",
        descriptor: describeEmailProblem(outcome.status, outcome.problem, outcome.retryAfter),
      };
    case "ok":
      return { kind: "queued", messageId: outcome.data.messageId };
  }
}
