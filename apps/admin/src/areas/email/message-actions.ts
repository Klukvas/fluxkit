import type { AdminEmailMessage } from "@fluxkit/api-client";

/** The two writes of the detail screen. */
export type MessageAction = "resend" | "cancel";

/**
 * Which buttons the detail offers: only to an admin who may manage email, and only what the API says the mail allows
 * (`canResend`: a final mail that is not a customer's account mail; `canCancel`: a pending mail). The API checks again.
 */
export function offeredActions(message: AdminEmailMessage, canManage: boolean): MessageAction[] {
  if (!canManage) return [];
  const actions: MessageAction[] = [];
  if (message.canResend) actions.push("resend");
  if (message.canCancel) actions.push("cancel");
  return actions;
}

/** What the status line says after an action. */
export type MessageNotice =
  | { kind: "resent"; messageId: string }
  | { kind: "cancelled" }
  /** No answer: the write may or may not have happened. The mail is read again; nothing is sent again. */
  | { kind: "lost"; action: MessageAction };
