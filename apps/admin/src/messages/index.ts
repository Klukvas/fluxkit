import type { Locale, Messages } from "@fluxkit/ui";
import enAccount from "./en/account.json";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enErrors from "./en/errors.json";
import enNavigation from "./en/navigation.json";
import enShell from "./en/shell.json";
import enStatus from "./en/status.json";
import ukAccount from "./uk/account.json";
import ukAuth from "./uk/auth.json";
import ukCommon from "./uk/common.json";
import ukErrors from "./uk/errors.json";
import ukNavigation from "./uk/navigation.json";
import ukShell from "./uk/shell.json";
import ukStatus from "./uk/status.json";

/**
 * UI strings, one file per area and locale (`messages/{uk,en}/<area>.json`), so parallel steps touch disjoint files
 * (plan, "i18n"). A later area adds its two files and one line per locale below. `messages.spec.ts` checks that both
 * locales have the same files, keys and placeholders.
 */
export const AREA_FILES: Record<Locale, Record<string, Messages>> = {
  uk: {
    account: ukAccount,
    auth: ukAuth,
    common: ukCommon,
    errors: ukErrors,
    navigation: ukNavigation,
    shell: ukShell,
    status: ukStatus,
  },
  en: {
    account: enAccount,
    auth: enAuth,
    common: enCommon,
    errors: enErrors,
    navigation: enNavigation,
    shell: enShell,
    status: enStatus,
  },
};

/** Merges the area files of one locale; a key defined in two files is a bug and throws (no silent override). */
export function mergeAreas(areas: Record<string, Messages>): Messages {
  const merged: Messages = {};
  const origin: Record<string, string> = {};
  for (const [area, messages] of Object.entries(areas)) {
    for (const [key, message] of Object.entries(messages)) {
      if (key in merged) {
        throw new Error(`Message key "${key}" is defined in both ${origin[key]} and ${area}.`);
      }
      merged[key] = message;
      origin[key] = area;
    }
  }
  return merged;
}

export const messagesByLocale: Record<Locale, Messages> = {
  uk: mergeAreas(AREA_FILES.uk),
  en: mergeAreas(AREA_FILES.en),
};
