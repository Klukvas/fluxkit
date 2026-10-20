import type { MessageDescriptor } from "../../lib/problem-messages";

/**
 * Early-feedback rules shared by the dictionary forms. They repeat what the API accepts (core `CODE_PATTERN`,
 * `VALUE_CODE_PATTERN`, `SLUG_PATTERN`, `TEXT_LIMITS`; compared with core in `form-rules.spec.ts`, because importing core
 * would pull zod into the bundle). The server decides; a refusal is shown on the field it names.
 */
export const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const VALUE_CODE_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 160;
export const URL_MAX_LENGTH = 2048;
export const POSITION_MAX = 1_000_000;

/** The same patterns as source strings for the native `pattern` attribute (an HTML pattern is anchored by the browser). */
export const CODE_PATTERN_SOURCE = "[a-z][a-z0-9_]{0,63}";
export const VALUE_CODE_PATTERN_SOURCE = "[a-z0-9][a-z0-9_]{0,63}";
export const SLUG_PATTERN_SOURCE = "[a-z0-9]+(-[a-z0-9]+)*";

/** Local issues by field name (the API's `errors[].path`): the first message of each field. */
export type FormIssues = Record<string, MessageDescriptor>;

export function issue(key: string, values?: MessageDescriptor["values"]): MessageDescriptor {
  return values === undefined ? { key } : { key, values };
}

export function hasText(value: string): boolean {
  return value.trim() !== "";
}

/** A position typed by the admin: empty (the API picks the place) or a whole number from 0 to 1 000 000. */
export function parsePosition(
  text: string,
): { ok: true; value: number | undefined } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: undefined };
  if (!/^\d{1,7}$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  return value <= POSITION_MAX ? { ok: true, value } : { ok: false };
}
