import type { Page } from "@playwright/test";

/**
 * TEST-ONLY emulation of a loaded machine (a CI runner) whose next animation frame comes late: every animation frame
 * callback of the page runs `delayMs` later. A focus moved from such a callback lands after the test has moved on to the
 * next field and steals the typed text (regression of the CI run of PR #191: "50.50Damaged in transit" in the amount).
 * Call it before the first `page.goto`. The admin moves the focus with `useFocusAfterCommit` (in the commit that shows the
 * target), so the scenarios that use this helper pass with any delay; `src/focus-guards.spec.ts` keeps frames out of it.
 */
export async function delayAnimationFrames(page: Page, delayMs = 300): Promise<void> {
  await page.addInitScript((delay) => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(performance.now()), delay);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  }, delayMs);
}
