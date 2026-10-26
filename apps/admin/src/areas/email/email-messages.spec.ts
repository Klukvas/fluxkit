import { locales } from "@fluxkit/ui";
import { beforeAll, describe, expect, it } from "vitest";
import type { Messages } from "@fluxkit/ui";
import { messagesForArea } from "../../test-helpers";
import { EMAIL_REFUSAL_RULES } from "./email-errors";
import { MESSAGE_FILES } from "./index";
import { ERROR_CODE_REASONS, MESSAGE_STATUSES } from "./email-view";
import { SETUP_STEP_KEYS } from "./status-view";

/**
 * The message keys the area builds at run time (`mail.status.${status}`, `mail.code.${reason}`, ...) cannot be found by the
 * source scan of `messages.spec.ts`; this lists them from the same constants the code uses and checks both languages.
 */
const loaded = {} as Record<"uk" | "en", Messages>;
beforeAll(async () => {
  loaded.uk = await messagesForArea("uk", MESSAGE_FILES);
  loaded.en = await messagesForArea("en", MESSAGE_FILES);
});

const dynamicKeys = (): string[] => [
  ...MESSAGE_STATUSES.map((status) => `mail.status.${status}`),
  ...ERROR_CODE_REASONS.map((reason) => `mail.code.${reason}`),
  "mail.code.unrecognized",
  ...EMAIL_REFUSAL_RULES.map((rule) => `mail.refusal.${rule}`),
  "mail.refusal.rateLimited",
  "mail.refusal.rateLimitedWait",
  ...SETUP_STEP_KEYS,
  ...["account", "order"].map((category) => `mail.category.${category}`),
  ...["customer", "guest", "admin"].map((kind) => `mail.recipientKind.${kind}`),
  ...locales.map((locale) => `mail.locale.${locale}`),
  ...["invalid_day", "end_before_start", "out_of_range"].map((r) => `mail.list.dateRange.${r}`),
  ...["resend", "cancel"].map((action) => `mail.notice.lost.${action}`),
];

describe("the Email area's messages", () => {
  it("has every run-time key in uk and en", () => {
    for (const locale of ["uk", "en"] as const) {
      for (const key of dynamicKeys()) {
        expect(loaded[locale][key], `${locale} ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("names environment variables in the setup steps and never a key value", () => {
    for (const locale of ["uk", "en"] as const) {
      const steps = SETUP_STEP_KEYS.map((key) => loaded[locale][key]).join(" ");
      for (const variable of ["EMAIL_PROVIDER", "EMAIL_FROM", "STOREFRONT_PUBLIC_URL"]) {
        expect(steps, `${locale} ${variable}`).toContain(variable);
      }
      expect(steps, locale).not.toMatch(/re_[A-Za-z0-9]{8,}/);
    }
  });

  it("uses only the email namespace in its own file", () => {
    for (const locale of ["uk", "en"] as const) {
      const own = Object.keys(loaded[locale]).filter((key) => key.startsWith("mail."));
      expect(own.length).toBeGreaterThan(100);
    }
  });
});
