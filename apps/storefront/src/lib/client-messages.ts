import type { Messages } from "@fluxkit/ui";
import { MESSAGE_NAMESPACES } from "../messages/areas";

/**
 * Namespaces of message keys that client components use. Only these are serialized into the page for the browser, so the
 * client payload stays small as server-only namespaces (home sections, footer) grow. Derived from the one namespace map,
 * `MESSAGE_NAMESPACES` in `messages/areas.ts`: set `client: true` there when a client component starts using a namespace
 * (README, "i18n").
 */
export const CLIENT_MESSAGE_PREFIXES: readonly string[] = Object.entries(MESSAGE_NAMESPACES)
  .filter(([, namespace]) => namespace.client)
  .map(([name]) => `${name}.`);

export function pickClientMessages(messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) =>
      CLIENT_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}
