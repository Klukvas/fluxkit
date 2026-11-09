import type { Page } from "@playwright/test";

/**
 * Cumulative layout shift as the browser reports it (`layout-shift` entries without recent input), split at the moment the
 * page's own content is on screen: `beforeReady` covers a loading view being replaced, `afterReady` everything after (late
 * sections, fonts, islands). `sources` names the moved nodes of the shifts after it, for the failure message.
 * Moved here from `design-b.e2e.ts` (ADR 0048) so every page can be measured the same way.
 */
export interface LayoutShifts {
  beforeReady: number;
  afterReady: number;
  sources: string[];
  readyAt: number | null;
}

interface ShiftRecord extends LayoutShifts {
  readonly selector: string;
}

const KEY = "__fluxkitLayoutShifts";

/** Starts recording before the first byte of every document of `page`; `readySelector` marks the page's own content. */
export async function watchLayoutShifts(page: Page, readySelector: string): Promise<void> {
  await page.addInitScript(
    ({ key, selector }) => {
      const record: ShiftRecord = {
        selector,
        beforeReady: 0,
        afterReady: 0,
        sources: [],
        readyAt: null,
      };
      (window as unknown as Record<string, ShiftRecord>)[key] = record;
      const watch = () => {
        const ready = document.querySelector(record.selector);
        if (ready !== null && ready.getBoundingClientRect().height > 0) {
          record.readyAt = performance.now();
          return;
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number;
          startTime: number;
          hadRecentInput: boolean;
          sources?: { node: Node | null }[];
        }[]) {
          if (entry.hadRecentInput) continue;
          if (record.readyAt === null || entry.startTime <= record.readyAt) {
            record.beforeReady += entry.value;
            continue;
          }
          record.afterReady += entry.value;
          for (const source of entry.sources ?? []) {
            const node = source.node;
            record.sources.push(
              `${entry.value.toFixed(3)} ${node instanceof Element ? `${node.tagName} ${node.className}`.slice(0, 80) : String(node?.nodeName)}`,
            );
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    },
    { key: KEY, selector: readySelector },
  );
}

/** What `watchLayoutShifts` recorded on the current document so far. */
export async function readLayoutShifts(page: Page): Promise<LayoutShifts> {
  return page.evaluate((key) => {
    const record = (window as unknown as Record<string, LayoutShifts | undefined>)[key];
    if (record === undefined) throw new Error("watchLayoutShifts was not installed on this page");
    return {
      beforeReady: record.beforeReady,
      afterReady: record.afterReady,
      sources: [...record.sources],
      readyAt: record.readyAt,
    };
  }, KEY);
}
