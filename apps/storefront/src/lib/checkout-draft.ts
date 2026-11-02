/**
 * The checkout form's draft in this tab's `sessionStorage` (review SQ-05, 2026-11-02): the language switch is a full page
 * load on purpose (`locale-switcher.tsx`), which used to wipe the phone, the city and the street the shopper had typed.
 *
 * What is kept, and for how long (privacy, AGENTS.md section 11 and `docs/privacy/README.md` section 5):
 * - exactly the values of the checkout form (contact, address, the chosen delivery method and pickup point), nothing else:
 *   no token, password, card data, order or cart data;
 * - in `sessionStorage` only (this tab; gone when the tab closes), never `localStorage`, a cookie, a URL or a log;
 * - removed when the order is placed and on sign-out, and ignored (and removed) when older than one hour.
 * Pure: storage and clock are injected; every storage access may throw (blocked site data) and is then treated as "none".
 */

export const CHECKOUT_DRAFT_KEY = "fluxkit.checkoutDraft";
export const CHECKOUT_DRAFT_TTL_MS = 60 * 60 * 1000;
/** Bounds that keep a draft small and a tampered entry harmless. */
const MAX_FIELDS = 40;
const MAX_VALUE_LENGTH = 1000;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CheckoutDraft {
  values: Readonly<Record<string, string>>;
  methodCode: string;
}

interface StoredDraft {
  savedAt: number;
  values: Record<string, string>;
  methodCode: string;
}

/** `window.sessionStorage`, or `null` when the browser does not let the page use it. */
export function sessionDraftStorage(get: () => DraftStorage): DraftStorage | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/**
 * The browser's draft storage: the ONE place outside the payment and checkout-attempt islands that names `sessionStorage`
 * (`source-guards.spec.ts`), so the sign-out and account deletion can clear the draft without touching storage themselves.
 * `null` on the server and where the browser refuses the storage.
 */
export function browserCheckoutDraftStorage(): DraftStorage | null {
  return typeof window === "undefined" ? null : sessionDraftStorage(() => window.sessionStorage);
}

function cleanValues(values: unknown): Record<string, string> | null {
  if (values === null || typeof values !== "object" || Array.isArray(values)) return null;
  const entries = Object.entries(values as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      FIELD_NAME.test(entry[0]) &&
      typeof entry[1] === "string" &&
      entry[1].length <= MAX_VALUE_LENGTH,
  );
  return entries.length > MAX_FIELDS ? null : Object.fromEntries(entries);
}

export function saveCheckoutDraft(
  storage: DraftStorage | null,
  draft: CheckoutDraft,
  now: number,
): void {
  if (storage === null) return;
  const values = cleanValues(draft.values);
  if (values === null) return;
  const stored: StoredDraft = { savedAt: now, values, methodCode: draft.methodCode };
  try {
    storage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(stored));
  } catch {
    // A full or blocked storage: the draft is a convenience, the form itself keeps working.
  }
}

export function clearCheckoutDraft(storage: DraftStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    // Blocked site data: nothing could have been stored either.
  }
}

/** The draft saved in this tab within the last hour, or `null`; an expired or unreadable entry is removed. */
export function loadCheckoutDraft(storage: DraftStorage | null, now: number): CheckoutDraft | null {
  if (storage === null) return null;
  let text: string | null;
  try {
    text = storage.getItem(CHECKOUT_DRAFT_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    clearCheckoutDraft(storage);
    return null;
  }
  const stored = parsed as Partial<StoredDraft> | null;
  const values = cleanValues(stored?.values);
  const fresh =
    typeof stored?.savedAt === "number" &&
    now - stored.savedAt >= 0 &&
    now - stored.savedAt <= CHECKOUT_DRAFT_TTL_MS;
  if (values === null || !fresh || typeof stored?.methodCode !== "string") {
    clearCheckoutDraft(storage);
    return null;
  }
  return { values, methodCode: stored.methodCode };
}
