import { browserStorage } from "../i18n/i18n-context";
import { BROWSER_PREFERENCE_KEYS, type StorageLike } from "../i18n/locale-preference";

export const SIDEBAR_STORAGE_KEY = BROWSER_PREFERENCE_KEYS.sidebar;

export function readSidebarCollapsed(getStorage: () => StorageLike = browserStorage): boolean {
  try {
    return getStorage().getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    // Blocked storage must leave the full navigation available.
    return false;
  }
}

export function storeSidebarCollapsed(
  collapsed: boolean,
  getStorage: () => StorageLike = browserStorage,
): boolean {
  try {
    getStorage().setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    return true;
  } catch {
    // A failed preference write explicitly restores the expanded form.
    return false;
  }
}
