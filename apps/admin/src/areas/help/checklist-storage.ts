import { useCallback, useState } from "react";
import { browserStorage } from "../../i18n/i18n-context";
import type { StorageLike } from "../../i18n/locale-preference";
import {
  NO_PREFERENCES,
  parsePreferences,
  preferencesKey,
  serializePreferences,
  type ChecklistPreferences,
} from "./checklist-model";

/**
 * The checklist's preferences in the browser's storage, through the SPA's one storage accessor (`browserStorage` of
 * `i18n-context.tsx`). Storage can be missing or throw (private mode, blocked site data): then nothing is remembered,
 * the screen says so, and it still works for the page's lifetime. Never an email or a name: the key holds the opaque
 * admin id, the value step ids and a flag.
 */
export function readPreferences(
  getStorage: () => StorageLike,
  adminUserId: string,
): ChecklistPreferences {
  try {
    return parsePreferences(getStorage().getItem(preferencesKey(adminUserId)));
  } catch {
    // Blocked storage: nothing remembered, the checklist starts empty (the write path tells the admin).
    return NO_PREFERENCES;
  }
}

/** `false` when the browser refused to store it. */
export function storePreferences(
  getStorage: () => StorageLike,
  adminUserId: string,
  preferences: ChecklistPreferences,
): boolean {
  try {
    getStorage().setItem(preferencesKey(adminUserId), serializePreferences(preferences));
    return true;
  } catch {
    return false;
  }
}

export interface PreferencesState {
  preferences: ChecklistPreferences;
  /** The last change could not be stored (it lasts until the page is left). */
  storageFailed: boolean;
  update: (next: ChecklistPreferences) => void;
}

/** The preferences of one admin user, read once per mount and written on every change. */
export function useChecklistPreferences(
  adminUserId: string,
  getStorage: () => StorageLike = browserStorage,
): PreferencesState {
  const [preferences, setPreferences] = useState(() => readPreferences(getStorage, adminUserId));
  const [storageFailed, setStorageFailed] = useState(false);
  const update = useCallback(
    (next: ChecklistPreferences) => {
      setPreferences(next);
      setStorageFailed(!storePreferences(getStorage, adminUserId, next));
    },
    [getStorage, adminUserId],
  );
  return { preferences, storageFailed, update };
}
