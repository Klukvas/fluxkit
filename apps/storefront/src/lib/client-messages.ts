import type { Messages } from "@fluxkit/ui";

/**
 * Namespaces of message keys that client components use. Only these are serialized into the page for the browser, so the
 * client payload stays small as server-only namespaces (home sections, footer) grow. Add a prefix here when a client
 * component starts using a new namespace (README, "How to add a message").
 */
export const CLIENT_MESSAGE_PREFIXES = [
  "nav.",
  "site.",
  "seo.",
  "locale.",
  "error.",
  "errors.",
  "notFound.",
  "loading.",
  "product.",
  "availability.",
  "cart.",
  "account.",
  "checkout.",
  "order.",
  "payment.",
  "notice.",
] as const;

export function pickClientMessages(messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).filter(([key]) =>
      CLIENT_MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}
