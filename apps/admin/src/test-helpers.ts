import type { AdminPayment, AdminPaymentRefund } from "@fluxkit/api-client";
import type { Locale, Messages, Translator } from "@fluxkit/ui";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import type { UploadControls } from "./areas/catalog-dictionaries/upload-panel";
import { loadMessageFile, messagesWith, type LazyFile } from "./messages";

/**
 * Test-only helpers (imported by spec files, never by the app). A translator that returns `§key` (`§key:count` for
 * plurals), so a test can tell translated text from hardcoded text: after removing the sentinels no word may be left.
 */
export function sentinelTranslator(): Translator {
  const t = ((key: string) => `§${key}`) as Translator;
  t.plural = (key: string, count: number) => `§${key}:${count}`;
  return t;
}

/** Visible text of server markup with the sentinels, tags, entities, digits and dashes removed. */
export function leftoverText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/§[A-Za-z0-9_.:-]+/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[\d\s\u00a0\u2014\u2013-]+/g, " ")
    .trim();
}

/** Attribute values that carry words for people (not ids, hrefs or classes). */
export function textAttributes(html: string): string[] {
  return [
    ...html.matchAll(/\s(?:aria-label|alt|title|placeholder|aria-description)="([^"]*)"/g),
  ].map((match) => match[1] as string);
}

/** Static markup of an element inside a memory router mounted at the SPA's base path (links need a router). */
export function renderInRouter(element: ReactElement, path = "/"): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { basename: "/admin-ui", initialEntries: [`/admin-ui${path}`] },
      element,
    ),
  );
}

/**
 * The messages a screen of an area sees in the app: the eager files plus the area's lazy files, loaded through the real
 * loaders (`messages/index.ts`). A screen test that renders with them proves the area's `MESSAGE_FILES` are enough.
 */
export async function messagesForArea(
  locale: Locale,
  files: readonly LazyFile[],
): Promise<Messages> {
  const loaded: Partial<Record<LazyFile, Messages>> = {};
  for (const file of files) loaded[file] = await loadMessageFile(file, locale);
  return messagesWith(locale, loaded);
}

/** The server's upload limits as the screens get them from `GET /admin/config` (`media`). */
export const TEST_UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  contentTypes: ["image/jpeg", "image/png", "image/webp"],
};

/** An idle upload queue (nothing selected, nothing running) for the screens' props; `overrides` set the state a test needs. */
export function uploadControls(overrides: Partial<UploadControls> = {}): UploadControls {
  const nothing = () => undefined;
  return {
    items: [],
    running: false,
    notice: null,
    selectFiles: nothing,
    dropFiles: nothing,
    cancelQueued: nothing,
    dismiss: nothing,
    limits: TEST_UPLOAD_LIMITS,
    maxFiles: 20,
    ...overrides,
  };
}

/** A succeeded 189.00 UAH payment with nothing refunded (the admin payment view); `overrides` set what a test needs. */
export function paymentFixture(overrides: Partial<AdminPayment> = {}): AdminPayment {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    providerCode: "fake",
    providerPaymentId: "fake-invoice-1",
    status: "succeeded",
    amount: { amount: 18900, currency: "UAH" },
    finalAmount: { amount: 18900, currency: "UAH" },
    refundedAmount: { amount: 0, currency: "UAH" },
    refundableAmount: { amount: 18900, currency: "UAH" },
    providerStatus: "success",
    providerModifiedAt: "2026-10-29T10:01:00.000Z",
    failureCode: null,
    orderOutcome: "applied",
    needsAttention: false,
    attentionCode: null,
    card: { system: "visa", last4: "4242" },
    createdBy: "guest",
    expiresAt: "2026-10-29T10:30:00.000Z",
    createdAt: "2026-10-29T10:00:00.000Z",
    updatedAt: "2026-10-29T10:01:00.000Z",
    nextCheckAt: null,
    refunds: [],
    history: [],
    ...overrides,
  };
}

export function refundFixture(overrides: Partial<AdminPaymentRefund> = {}): AdminPaymentRefund {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    amount: { amount: 5000, currency: "UAH" },
    status: "succeeded",
    reason: "admin",
    note: "Damaged item",
    actorAdminId: "11111111-1111-4111-8111-111111111111",
    failureCode: null,
    createdAt: "2026-10-29T11:00:00.000Z",
    updatedAt: "2026-10-29T11:00:05.000Z",
    ...overrides,
  };
}
