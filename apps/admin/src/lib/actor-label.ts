/**
 * Who made a change in a journal (the stock journal, the order history), without an API change (owner answer 11). Shared
 * by the products area's Stock tab and the orders area; pure.
 */
export type ActorLabel =
  | { kind: "you" }
  | { kind: "email"; email: string }
  | { kind: "other"; shortId: string }
  | { kind: "system" };

/**
 * "You" for the signed-in admin; the email when the users list could be read (owners, `users.manage`; nobody else
 * makes that request); otherwise "another admin" with the first eight characters of the id; no actor is the system
 * (an order's sale, the demo seed, or an admin deleted since).
 */
export function actorLabel(
  actorId: string | null,
  meId: string,
  emails: ReadonlyMap<string, string> | null,
): ActorLabel {
  if (actorId === null) return { kind: "system" };
  if (actorId === meId) return { kind: "you" };
  const email = emails?.get(actorId);
  if (email !== undefined) return { kind: "email", email };
  return { kind: "other", shortId: actorId.slice(0, 8) };
}
