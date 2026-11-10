import type { Messages } from "@fluxkit/ui";

/**
 * A client fork's text overrides (`src/messages-overrides/<locale>.json`: fork-owned, upstream ships `{}` and never edits
 * them), merged LAST over the message files, with the storefront's rules (`apps/storefront/src/messages/index.ts`): a key no
 * message file has, or a value that is not a non-empty string, is an error naming the key and the file. Pure: no file access,
 * so the SPA (`index.ts`) and the build (`brand-html.ts`, Node) share it.
 */

function overridesFile(locale: string): string {
  return `src/messages-overrides/${locale}.json`;
}

function valueProblem(key: string, value: unknown, locale: string): string | null {
  return typeof value === "string" && value.trim() !== ""
    ? null
    : `Message override "${key}" in ${overridesFile(locale)} must be a non-empty string.`;
}

/**
 * `messages` with the overrides of the keys it has. The SPA loads an area's files lazily, so a key of a file that is not
 * loaded yet is applied when it is; that every key exists in some file is checked by the build and the specs
 * (`overrideProblems`). Throws on a value that is not a non-empty string.
 */
export function applyOverrides(
  messages: Readonly<Messages>,
  overrides: Readonly<Record<string, unknown>>,
  locale: string,
): Messages {
  const merged: Messages = { ...messages };
  for (const [key, value] of Object.entries(overrides)) {
    const problem = valueProblem(key, value, locale);
    if (problem !== null) throw new Error(problem);
    if (Object.hasOwn(messages, key)) merged[key] = value as string;
  }
  return merged;
}

/** The problems of a locale's overrides against ALL its message files (eager and lazy) merged: unknown keys, bad values. */
export function overrideProblems(
  allMessages: Readonly<Messages>,
  overrides: Readonly<Record<string, unknown>>,
  locale: string,
): string[] {
  const problems: string[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(allMessages, key)) {
      problems.push(
        `Message override "${key}" in ${overridesFile(locale)} has no base message (a typo, or a key upstream renamed or removed).`,
      );
      continue;
    }
    const problem = valueProblem(key, value, locale);
    if (problem !== null) problems.push(problem);
  }
  return problems;
}
