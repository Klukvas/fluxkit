import type { Translator } from "@fluxkit/ui";
import { focusRing } from "./styles";
import type { ListView } from "./product-grid";

/** `href` with `view=list` added (or nothing for the grid, the default). */
export function withListView(href: string, view: ListView): string {
  if (view === "grid") return href;
  return `${href}${href.includes("?") ? "&" : "?"}view=list`;
}

const option = `inline-flex min-h-11 items-center rounded-md border px-3 text-sm ${focusRing}`;
const optionIdle = "border-border text-foreground hover:bg-muted";
const optionCurrent = "border-primary bg-primary font-semibold text-primary-foreground";

/**
 * Reshape experiment (client request 2): Grid / List as two plain links (works without a script), the current one marked
 * with `aria-current`. `href` is the current list's address without `view`.
 */
export function ListViewToggle({ t, view, href }: { t: Translator; view: ListView; href: string }) {
  return (
    <nav aria-label={t("catalog.view.label")} className="flex gap-1">
      {(["grid", "list"] as const).map((target) => (
        <a
          key={target}
          href={withListView(href, target)}
          aria-current={view === target ? "true" : undefined}
          className={`${option} ${view === target ? optionCurrent : optionIdle}`}
        >
          {t(`catalog.view.${target}`)}
        </a>
      ))}
    </nav>
  );
}
